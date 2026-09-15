import * as React from 'react';
import {StyleSheet, TouchableOpacity, View} from 'react-native';
import {defineMessages, useIntl, type MessageDescriptor} from 'react-intl';

import {BottomSheetWrapper} from '../sharedComponents/BottomSheetWrapper';
import {HeaderText} from '../sharedComponents/Text/HeaderText';
import {BodyText} from '../sharedComponents/Text/BodyText';
import {useCoiabOrganizationsState} from '../contexts/CoiabOrganizationsStoreContext';
import {useOrganizationActivationContext} from '../contexts/OrganizationActivationContext';
import {
  ordenarOrganizacoes,
  type OrganizacaoLocal,
} from '../lib/organization/coiabOrganizations';
import {NEW_DARK_GREY} from '../lib/styles';
import {NativeRootNavigationProps} from '../sharedTypes/navigation';

const m = defineMessages({
  title: {
    id: '$1screens.Organizations.title',
    defaultMessage: 'Organizations',
    // SPEC A §6.1:201 — the modal selector opened by "Trocar de organização"
    // (the drawer entry is wired in the next delivery).
    description: 'Title of the organization selector modal',
  },
  currentOrganization: {
    id: '$1screens.Organizations.currentOrganization',
    defaultMessage: 'Current',
    // SPEC A §6.1:201 — the active organization carries "marca e texto
    // 'Atual'"; the badge text is the same concept the area menu already
    // ships, scoped here to the organization.
    description:
      'Badge naming the organization this device operates in right now',
  },
  // §6.1: incomplete/unavailable organizations are "aparecem identificadas".
  // The selector writes no copy of its own: each state reuses the canonical
  // descriptor OrganizationProvisioning already ships for it.
  preparingState: {
    id: '$1screens.OrganizationSetup.preparingTitle',
    defaultMessage: 'Preparing your organization…',
  },
  failureState: {
    id: '$1screens.OrganizationSetup.failureTitle',
    defaultMessage: 'Could not finish creating the organization.',
  },
  createdState: {
    id: '$1screens.OrganizationSetup.createdTitle',
    defaultMessage: 'Organization created',
  },
});

/**
 * The canonical descriptor for one non-activatable row's state — the same
 * strings the provisioning screen presents for that state, so the selector
 * identifies (SPEC A §6.1:201) without authoring a parallel vocabulary.
 */
function identificadorDeEstado(
  organizacao: OrganizacaoLocal | undefined,
): MessageDescriptor | null {
  if (!organizacao) return null;
  if (organizacao.estado === 'preparando') return m.preparingState;
  if (organizacao.estado === 'falha_recuperavel') return m.failureState;
  if (organizacao.confirmacaoPendente) return m.createdState;
  return null;
}

/**
 * The organization selector modal (SPEC A §6.1, consult Phase 13). The rows
 * ARE `ordenarOrganizacoes(estado)` — order, labels (including the duplicate
 * name's local identifier) and the atual/ativavel marks come from it; the
 * screen never reorders or recomputes a label. Tapping the current row only
 * closes the modal; tapping an activatable one runs the activation engine's
 * `activate(id)` and, only on success, resets the stack to a clean `Home/Map`
 * — the same pattern the drawer area switch uses (§5.2:168). Other rows
 * identify their state and have no action (§6.1:201): no disabled control
 * that could still fire, no internal projects, no creation entry.
 */
export const Organizations = ({
  navigation,
}: NativeRootNavigationProps<'Organizations'>) => {
  const {formatMessage} = useIntl();
  const estado = useCoiabOrganizationsState();
  const {activate} = useOrganizationActivationContext();
  // Synchronous guard against a double tap (OrganizationAreaAccesses
  // precedent): the second press must see the flag BEFORE any await, so a
  // queued second activation never starts — the engine's own lock would only
  // JOIN the same intent and replay its result.
  const ativando = React.useRef(false);

  // §6.1 presentation read (CA05): pure, order included.
  const linhas = ordenarOrganizacoes(estado);
  const porId: Record<string, OrganizacaoLocal | undefined> =
    Object.fromEntries(estado.organizacoes.map(item => [item.id, item]));

  const trocar = (organizacaoId: string) => {
    if (ativando.current) return;
    ativando.current = true;
    void (async () => {
      try {
        const ok = await activate(organizacaoId);
        if (ok) {
          // Success only (SPEC A §5.2:168): the reset replaces the whole
          // stack — the modal is removed with it. A `false` answer keeps the
          // selector open; the engine's feedback is published on its handle.
          navigation.reset({
            index: 0,
            routes: [{name: 'Home', params: {screen: 'Map'}}],
          });
        }
      } finally {
        ativando.current = false;
      }
    })();
  };

  return (
    <BottomSheetWrapper closeOnBackButtonPress>
      <View style={styles.container}>
        <HeaderText variant="header4" style={styles.title}>
          {formatMessage(m.title)}
        </HeaderText>
        <View style={styles.list} testID="ORGANIZATIONS.list">
          {linhas.map(linha => {
            const identificador = identificadorDeEstado(porId[linha.id]);
            // The current row only closes the modal; an activatable one
            // switches; anything else has NO action (§6.1:201) — a plain
            // view, not a disabled control that could still fire.
            const pressable = linha.atual || linha.ativavel;
            const RowView = pressable ? TouchableOpacity : View;
            return (
              <RowView
                key={linha.id}
                testID={`ORGANIZATIONS.row-${linha.id}`}
                style={[styles.row, pressable && styles.rowActionable]}
                accessibilityState={{selected: linha.atual}}
                {...(linha.atual
                  ? {onPress: () => navigation.goBack()}
                  : linha.ativavel
                    ? {onPress: () => trocar(linha.id)}
                    : {})}>
                <BodyText variant="medium" style={styles.rotulo}>
                  {linha.rotulo}
                </BodyText>
                {linha.atual && (
                  <BodyText variant="tinyMeta" style={styles.currentBadge}>
                    {formatMessage(m.currentOrganization)}
                  </BodyText>
                )}
                {identificador && (
                  <BodyText variant="tinyMeta" style={styles.estado}>
                    {formatMessage(identificador)}
                  </BodyText>
                )}
              </RowView>
            );
          })}
        </View>
      </View>
    </BottomSheetWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  title: {
    flexShrink: 1,
  },
  list: {
    gap: 4,
  },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowActionable: {
    justifyContent: 'flex-start',
  },
  rotulo: {
    flexShrink: 1,
  },
  currentBadge: {
    color: NEW_DARK_GREY,
  },
  estado: {
    color: NEW_DARK_GREY,
  },
});
