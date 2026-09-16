import * as React from 'react';
import {StyleSheet, TouchableOpacity, View} from 'react-native';
import {defineMessages, useIntl, type MessageDescriptor} from 'react-intl';

import {BottomSheetWrapper} from '../sharedComponents/BottomSheetWrapper';
import {HeaderText} from '../sharedComponents/Text/HeaderText';
import {BodyText} from '../sharedComponents/Text/BodyText';
import {LoadingIndicator} from '../sharedComponents/LoadingIndicator';
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
  // SPEC A §5.2:165 (step 3, "Preparar B"): while an activation is pending
  // the sheet shows “Abrindo organização…” alone — no mixed content from the
  // organizations the list shows, no change to the persisted selection.
  openingOrganization: {
    id: '$1screens.OrganizationSetup.openingOrganization',
    defaultMessage: 'Opening organization…',
    description:
      'The selector sheet while an activation is in flight (SPEC A §5.2:165, “Abrindo organização…”)',
  },
  // SPEC A §6.2:215 ("Troca bloqueada/falhou") asks for a specific
  // explanation and CA15 (§9:279) for exactly the §4.4 texts, so the selector
  // writes no copy of its own: both descriptors below are the SAME id,
  // defaultMessage and description OrganizationProvisioning ships (identical
  // duplicates are what the extraction gate requires).
  //
  // §4.4:148 / SPEC B §4.1:120 — “Não foi possível abrir sua organização”.
  unavailableTitle: {
    id: '$1screens.OrganizationSetup.unavailableTitle',
    defaultMessage: 'Could not open your organization',
    description:
      'A settled organization the engine could not open (SPEC B §4.4:120 / SPEC A §6.2:214, “Organização indisponível”)',
  },
  // §4.4:149 / §5.2:164 / SPEC B §4.1:121 — “Conclua ou descarte o registro
  // antes de trocar de organização”.
  pendingWork: {
    id: '$1screens.OrganizationSetup.pendingWork',
    defaultMessage:
      'Finish or discard the record before switching organization',
    description:
      'Blocked boot with work in progress (SPEC A §4.4:149 canonical pending-work string, CA15)',
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
 * The specific explanation (SPEC A §6.2:215) for the `error` code the
 * activation engine publishes when a switch does not go through — canonical
 * §4.4 copy only (CA15).
 */
function explicacaoDaTroca(erro: string | undefined): MessageDescriptor {
  switch (erro) {
    case 'pending-work':
      return m.pendingWork;
    case 'unavailable':
    case 'access-unavailable':
      return m.unavailableTitle;
    default:
      // 'sync-restart-required' and 'operation-in-progress' have no canonical
      // string — §5.2:167 describes the sync notice without quoting a text,
      // §5.2:163 quotes none for a concurrent activation — and a rejection
      // publishes no code at all: the §4.4:148 copy, never an invented one.
      return m.unavailableTitle;
  }
}

/**
 * The organization selector modal (SPEC A §6.1, consult Phase 13). The rows
 * ARE `ordenarOrganizacoes(estado)` — order, labels (including the duplicate
 * name's local identifier) and the atual/ativavel marks come from it; the
 * screen never reorders or recomputes a label. Tapping the current row only
 * closes the modal; tapping an activatable one runs the activation engine's
 * `activate(id)`, and while that attempt is pending the sheet shows only the
 * §5.2:165 opening state — never a still-pressable list. Only on success does
 * it reset the stack to a clean `Home/Map` — the same pattern the drawer area
 * switch uses (§5.2:168); a blocked or failed switch keeps the previous
 * organization/area and explains itself as visible text inside this same
 * sheet (§6.2:215) — no route, no sheet stacked on top. Other rows identify
 * their state and have no action (§6.1:201): no disabled control that could
 * still fire, no internal projects, no creation entry.
 */
export const Organizations = ({
  navigation,
}: NativeRootNavigationProps<'Organizations'>) => {
  const {formatMessage} = useIntl();
  const estado = useCoiabOrganizationsState();
  const {activate, error} = useOrganizationActivationContext();
  // Synchronous guard against a double tap (OrganizationAreaAccesses
  // precedent): the second press must see the flag BEFORE any await, so a
  // queued second activation never starts — the engine's own lock would only
  // JOIN the same intent and replay its result.
  const ativandoRef = React.useRef(false);
  // §5.2:165: the sheet's own pending flag — the re-render it publishes is
  // what retires the list, so the opening state is up before any await too.
  const [ativando, setAtivando] = React.useState(false);
  // §6.2:215: how THIS sheet's last switch attempt failed, if it did —
  // 'recusada' when the engine answered `false` (it published why as
  // `error`), 'rejeitada' when the call rejected (nothing published for it).
  // Only the sheet's own attempt is explained: a code an earlier attempt left
  // on the handle never shows up when the sheet opens.
  const [falhaDaTroca, setFalhaDaTroca] = React.useState<
    'recusada' | 'rejeitada' | null
  >(null);

  // §6.1 presentation read (CA05): pure, order included.
  const linhas = ordenarOrganizacoes(estado);
  const porId: Record<string, OrganizacaoLocal | undefined> =
    Object.fromEntries(estado.organizacoes.map(item => [item.id, item]));

  const trocar = (organizacaoId: string) => {
    if (ativandoRef.current) return;
    ativandoRef.current = true;
    setAtivando(true);
    setFalhaDaTroca(null);
    void (async () => {
      try {
        const ok = await activate(organizacaoId);
        if (ok) {
          // Success only (SPEC A §5.2:168): the reset replaces the whole
          // stack — the modal is removed with it.
          navigation.reset({
            index: 0,
            routes: [{name: 'Home', params: {screen: 'Map'}}],
          });
        } else {
          setFalhaDaTroca('recusada');
        }
      } catch {
        // A rejection must never escape as an unhandled promise: it takes
        // the same §6.2:215 failure road as a `false` answer.
        setFalhaDaTroca('rejeitada');
      } finally {
        ativandoRef.current = false;
        setAtivando(false);
      }
    })();
  };

  // §6.2:215 — the code is read HERE, at render, from the handle as it
  // stands now: the `error` the tapped row's closure captured predates the
  // engine's answer.
  const explicacao =
    falhaDaTroca &&
    explicacaoDaTroca(falhaDaTroca === 'recusada' ? error : undefined);

  return (
    <BottomSheetWrapper closeOnBackButtonPress>
      {ativando ? (
        // §5.2:165 — “Mostrar ‘Abrindo organização…’ sem conteúdo misturado”:
        // the opening state replaces the sheet's content entirely (the rows
        // ARE that content), and the persisted selection is only the
        // engine's to write, on success.
        <View style={styles.abrindo}>
          <LoadingIndicator size="large" style={styles.abrindoIndicator} />
          <HeaderText variant="header4" style={styles.title}>
            {formatMessage(m.openingOrganization)}
          </HeaderText>
        </View>
      ) : (
        <View style={styles.container}>
          <HeaderText variant="header4" style={styles.title}>
            {formatMessage(m.title)}
          </HeaderText>
          {/* §6.2:215: plain text in the sheet itself, nothing to expand (the
              OrganizationAreaAccesses precedent). It sits above the rows: the
              list has no scroll, so a long one grows below the explanation
              rather than pushing it down. The rows stay — tapping one again
              is a new attempt. */}
          {explicacao && (
            <BodyText style={styles.explicacao}>
              {formatMessage(explicacao)}
            </BodyText>
          )}
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
      )}
    </BottomSheetWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  abrindo: {
    gap: 12,
    alignItems: 'center',
    paddingVertical: 24,
  },
  abrindoIndicator: {
    flex: 0,
  },
  title: {
    flexShrink: 1,
  },
  explicacao: {
    color: NEW_DARK_GREY,
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
