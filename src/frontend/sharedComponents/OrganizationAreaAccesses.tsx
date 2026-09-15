import * as React from 'react';
import {StyleSheet, TouchableOpacity, View} from 'react-native';
import {defineMessages, useIntl} from 'react-intl';

import {useCoiabOrganizationsState} from '../contexts/CoiabOrganizationsStoreContext';
import {useOrganizationActivationContext} from '../contexts/OrganizationActivationContext';
import {useNavigationFromRoot} from '../hooks/useNavigationWithTypes';
import {
  derivarProjectIdAtivo,
  type Area,
} from '../lib/organization/coiabOrganizations';
import {NEW_DARK_GREY} from '../lib/styles';
import {HeaderText} from './Text/HeaderText';
import {BodyText} from './Text/BodyText';

// The two area rows reuse the canonical §4.4 glossary strings the
// provisioning screen already ships ("Monitoramento"/"Alertas"); identical
// duplicates of the same id are harmless to the extraction gate.
const m = defineMessages({
  monitoringRow: {
    id: '$1screens.OrganizationSetup.monitoringRow',
    defaultMessage: 'Monitoring',
  },
  alertsRow: {
    id: '$1screens.OrganizationSetup.alertsRow',
    defaultMessage: 'Alerts',
  },
  currentArea: {
    id: '$1sharedComponents.OrganizationAreaAccesses.currentArea',
    defaultMessage: 'Current',
    description: 'Badge naming the work area the device operates right now',
  },
  pendingWork: {
    id: '$1sharedComponents.OrganizationAreaAccesses.pendingWork',
    defaultMessage:
      'Finish or discard the record before switching organization',
    description:
      'Blocked area switch (SPEC A §4.4:149 canonical pending-work string)',
  },
});

const LINHAS: ReadonlyArray<{
  area: Area;
  testID: string;
  rotulo: {id: string; defaultMessage: string};
}> = [
  {
    area: 'monitoramento',
    testID: 'MENU.area-monitoramento',
    rotulo: m.monitoringRow,
  },
  {area: 'alertas', testID: 'MENU.area-alertas', rotulo: m.alertsRow},
];

/**
 * The organization's two fixed area accesses in the drawer (SPEC A §6.1):
 * the full organization name plus one row per area, the current one marked
 * (accessibilityState.selected + visible "Current"). Tapping the current
 * area only closes the menu; tapping the other one runs the activation
 * engine's guard and, on success, resets the stack to a clean `Home/Map` on
 * the new area (§5.2:168).
 *
 * Renders `null` unless the persisted document derives an operational
 * project (SPEC A §4.2 rule 5) — without a usable organization the drawer
 * keeps its legacy content.
 */
export function OrganizationAreaAccesses({
  closeMenu,
}: {
  closeMenu: () => void;
}): React.JSX.Element | null {
  const {formatMessage} = useIntl();
  const navigation = useNavigationFromRoot();
  const activation = useOrganizationActivationContext();
  const estado = useCoiabOrganizationsState();
  // Synchronous guard against a double tap: the second press must see the
  // flag BEFORE any await, so a queued second activation never starts (the
  // engine's own lock would only JOIN the same intent and replay its result).
  const trocaEmAndamento = React.useRef(false);

  const derivado = derivarProjectIdAtivo(estado);

  if (derivado === null) return null;

  const organizacao = estado.organizacoes.find(
    item => item.id === estado.ativa?.organizacaoId,
  );
  // The derivation guarantees the referenced organization exists.
  const organizacaoId = organizacao?.id ?? '';
  const areaAtual = estado.ativa?.area ?? 'monitoramento';

  const trocarArea = (area: Area) => {
    if (area === areaAtual) {
      // Tapping the current area never reactivates (§5.2:163): close only.
      closeMenu();
      return;
    }
    if (trocaEmAndamento.current) return;
    trocaEmAndamento.current = true;
    void (async () => {
      try {
        const ok = await activation.activate(organizacaoId, {area});
        closeMenu();
        if (ok) {
          navigation.reset({
            index: 0,
            routes: [{name: 'Home', params: {screen: 'Map'}}],
          });
        }
      } finally {
        trocaEmAndamento.current = false;
      }
    })();
  };

  return (
    <View style={styles.container}>
      {/* Full name, also for assistive reading (SPEC A §6.1:195): no
          truncation prop, the card text wraps. */}
      <HeaderText
        variant="header4"
        accessibilityLabel={organizacao?.nome}
        style={styles.organizationName}>
        {organizacao?.nome}
      </HeaderText>
      {LINHAS.map(({area, testID, rotulo}) => {
        const corrente = area === areaAtual;
        return (
          <TouchableOpacity
            key={area}
            testID={testID}
            style={styles.areaRow}
            accessibilityState={{selected: corrente}}
            onPress={() => trocarArea(area)}>
            <BodyText variant="medium">{formatMessage(rotulo)}</BodyText>
            {corrente && (
              <BodyText variant="tinyMeta" style={styles.currentArea}>
                {formatMessage(m.currentArea)}
              </BodyText>
            )}
          </TouchableOpacity>
        );
      })}
      {activation.error === 'pending-work' && (
        <BodyText style={styles.pendingWork}>
          {formatMessage(m.pendingWork)}
        </BodyText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  organizationName: {
    flexShrink: 1,
  },
  areaRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  currentArea: {
    color: NEW_DARK_GREY,
  },
  pendingWork: {
    color: NEW_DARK_GREY,
  },
});
