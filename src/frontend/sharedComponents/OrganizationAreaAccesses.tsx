import * as React from 'react';
import {StyleSheet, TouchableOpacity, View} from 'react-native';
import {defineMessages, useIntl} from 'react-intl';

import {useCoiabOrganizationsState} from '../contexts/CoiabOrganizationsStoreContext';
import {
  derivarProjectIdAtivo,
  type Area,
} from '../lib/organization/coiabOrganizations';
import {COIAB_ORANGE, COIAB_RED, WHITE} from '../lib/styles';
import {BodyText} from './Text/BodyText';
import {useTrocarArea} from '../hooks/useTrocarArea';
import type {MessageDescriptor} from 'react-intl';

// The card titles use the Página Entroncamento strings (Figma Kutary App
// V2, `2668:4539`); "Alertas" reuses the canonical §4.4 glossary family
// the provisioning screen already ships.
const m = defineMessages({
  cardMonitoramento: {
    id: '$1sharedComponents.OrganizationAreaAccesses.cardMonitoramento',
    defaultMessage: 'Monitoramento Territorial',
    description: 'Título do card Monitoramento (Figma 2668:4539)',
  },
  cardAlertas: {
    id: '$1sharedComponents.OrganizationAreaAccesses.cardAlertas',
    defaultMessage: 'Alertas',
    description: 'Título do card Alertas (Figma 2668:4539)',
  },
  maisDetalhes: {
    id: '$1sharedComponents.OrganizationAreaAccesses.maisDetalhes',
    defaultMessage: 'Mais detalhes',
    description: 'Chip de detalhes do card (Figma 2668:4539)',
  },
  pendingWork: {
    id: '$1sharedComponents.OrganizationAreaAccesses.pendingWork',
    defaultMessage:
      'Finish or discard the record before switching organization',
    description:
      'Blocked area switch (SPEC A §4.4:149 canonical pending-work string)',
  },
});

const CARDS: ReadonlyArray<{
  area: Area;
  testID: string;
  rotulo: MessageDescriptor;
  fundo: string;
}> = [
  {
    area: 'monitoramento',
    testID: 'MENU.area-monitoramento',
    rotulo: m.cardMonitoramento,
    fundo: COIAB_ORANGE,
  },
  {
    area: 'alertas',
    testID: 'MENU.area-alertas',
    rotulo: m.cardAlertas,
    fundo: COIAB_RED,
  },
];

/**
 * The organization's two fixed area accesses as the two click cards of the
 * Página Entroncamento (Figma `2668:4539`; SPEC A §6.1): Monitoramento
 * Territorial (#FF9500) and Alertas (#B90B0B). The current one is marked
 * (accessibilityState.selected); tapping it only returns to the map
 * (`popTo` `Home/Map`), tapping the other runs the activation engine's
 * guard and, on success, resets the stack to a clean `Home/Map` (§5.2:168)
 * — the switch logic lives in the shared `useTrocarArea` hook, called once
 * here so both cards share the same tap lock.
 *
 * A "pending-work" refusal message renders when the activation engine
 * blocks the switch; legible on the dark page background.
 *
 * Renders `null` unless the persisted document derives an operational
 * project (SPEC A §4.2 rule 5) — without a usable organization the page
 * keeps greeting + list only (no hidden or disabled card).
 */
export function OrganizationAreaAccesses(): React.JSX.Element | null {
  const {formatMessage} = useIntl();
  const estado = useCoiabOrganizationsState();

  // Um único hook: o mesmo `useRef` de trava é compartilhado pelos dois
  // cards.
  const {trocarArea, areaAtual, trocaRecusada} = useTrocarArea();

  if (derivarProjectIdAtivo(estado) === null) return null;

  return (
    <View style={styles.container}>
      {CARDS.map(({area, testID, rotulo, fundo}) => {
        const corrente = area === areaAtual;
        return (
          <TouchableOpacity
            key={area}
            testID={testID}
            style={[styles.card, {backgroundColor: fundo}]}
            accessibilityState={{selected: corrente}}
            onPress={() => trocarArea(area)}>
            <BodyText style={styles.cardTitle}>
              {formatMessage(rotulo)}
            </BodyText>
            <View style={styles.chip}>
              <BodyText style={styles.chipText}>
                {formatMessage(m.maisDetalhes)}
              </BodyText>
            </View>
          </TouchableOpacity>
        );
      })}
      {trocaRecusada && (
        <BodyText style={styles.pendingWork}>
          {formatMessage(m.pendingWork)}
        </BodyText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  card: {
    width: '100%',
    minHeight: 110,
    borderRadius: 8,
    padding: 16,
    gap: 12,
  },
  cardTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: WHITE,
  },
  chip: {
    // Chip "Mais detalhes" do Figma `2668:4539`: #1E1E1E, raio 16.
    backgroundColor: '#1E1E1E',
    borderRadius: 16,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '500',
    color: WHITE,
  },
  pendingWork: {
    color: WHITE,
  },
});
