import * as React from 'react';
import {
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {defineMessages, useIntl} from 'react-intl';
import {NativeStackScreenProps} from '@react-navigation/native-stack';

import {HeaderText} from '../../sharedComponents/Text/HeaderText';
import {BodyText} from '../../sharedComponents/Text/BodyText';
import {PrimaryButton} from '../../sharedComponents/Buttons';
import {LoadingIndicator} from '../../sharedComponents/LoadingIndicator';
import {BLACK, COMAPEO_BLUE, LIGHT_GREY} from '../../lib/styles';
import {useOrganizationMaterializer} from '../../contexts/OrganizationMaterializerContext';
import {
  useCoiabOrganizationsState,
  useCoiabOrganizationsStoreContext,
} from '../../contexts/CoiabOrganizationsStoreContext';
import {
  derivarProjectIdAtivo,
  organizacaoEmPreparo,
} from '../../lib/organization/coiabOrganizations';
import {markerFor} from '../../lib/organization/marker';
import {ErroPacote} from '../../lib/organization/pacotes';
import {OrganizationOperationError} from '../../lib/organization/fanout';
import {AppStackParamsList} from '../../sharedTypes/navigation';
import territoriesData from '../../lib/territories.json';
import {normalizeRemoteArchiveUrl} from '../../utils/normalizeRemoteArchiveUrl';
import {
  useUserProfileActions,
  useUserProfileState,
} from '../../contexts/UserProfileStoreContext';

const m = defineMessages({
  // SPEC B :54/:55: both stages share the title and the submit button
  // "Criar organização" — one descriptor. Success's primary button uses
  // the SAME id with the SAME defaultMessage (identical duplicates are
  // allowed by the extraction gate).
  createOrganization: {
    id: '$1screens.OrganizationSetup.createOrganization',
    defaultMessage: 'Create Territory',
  },
  createIntroBody: {
    id: '$1screens.OrganizationSetup.createIntroBody',
    // SPEC B :54 — verbatim.
    defaultMessage:
      'Your Territory will have Monitoramento and Alertas, with categories ready to use. You can create it without internet.',
  },
  continueButton: {
    id: '$1screens.OrganizationSetup.continueButton',
    // SPEC B :54.
    defaultMessage: 'Continue',
  },
  nameLabel: {
    id: '$1screens.OrganizationSetup.nameLabel',
    // SPEC B :55 (also the :94 table) — the field label.
    defaultMessage: 'Territory name',
  },
  nameGuidance: {
    id: '$1screens.OrganizationSetup.nameGuidance',
    // SPEC B :55 — verbatim.
    defaultMessage: 'Choose a name for your Territory.',
  },
  nameNotIdentity: {
    id: '$1screens.OrganizationSetup.nameNotIdentity',
    // SPEC B :55 — verbatim.
    defaultMessage:
      'Using the same name as another Territory does not connect the devices. To join an existing Territory, wait for an invitation.',
  },
  archiveUrlLabel: {
    id: '$1screens.Onboarding.CreateOrganization.archiveUrlLabel',
    defaultMessage: 'Remote archive URL',
  },
  archiveUrlPlaceholder: {
    id: '$1screens.Onboarding.CreateOrganization.archiveUrlPlaceholder',
    defaultMessage: 'https://…',
  },
  archiveUrlInvalid: {
    id: '$1screens.Onboarding.CreateOrganization.archiveUrlInvalid',
    defaultMessage: 'Enter a valid HTTPS URL',
  },
  creating: {
    id: '$1screens.Onboarding.CreateOrganization.creating',
    defaultMessage: 'Creating Territory…',
  },
  // ⚑ SPEC (A4): there is no canonical copy for the materializer's typed
  // refusal (SPEC B §5.5 guard) — this minimal factual descriptor fills
  // the gap. COPY PENDING A SPEC DECISION.
  creationInProgress: {
    id: '$1screens.Onboarding.CreateOrganization.creationInProgress',
    defaultMessage: 'A Territory creation is already in progress.',
  },
  // ⚑ SPEC (A4): there is no canonical string yet for a package failure
  // BEFORE any write — `$1screens.OrganizationSetup.failureBody`
  // ("…está salvo") would be false here, so this NEW minimal factual
  // descriptor fills the gap. COPY PENDING A SPEC DECISION.
  pacoteNaoAprovado: {
    id: '$1screens.OrganizationSetup.pacoteNaoAprovado',
    defaultMessage:
      'Could not prepare the necessary files on this device. Nothing was created.',
  },
  // ⚑ Flag #14 (SPEC B :253 vs marker pairing): the bound the guard enforces
  // is the MINTED MARKER's 60 chars, not the raw name — the canonical
  // "Use no máximo 60 caracteres." would mislead, so this marker-bound
  // message is preserved as-is until a marker v2 lands.
  tooLong: {
    id: '$1screens.Onboarding.CreateOrganization.tooLong',
    defaultMessage: 'Territory name is too long',
  },
});

// SPEC 4.1/E3: the name's real bound is the minted marker's, not the
// input's — `coiab-org:v1:<16-hex>:<slot>:<encoded-name>` must fit 60 chars,
// and the encoded name can be much longer than the raw one (accents, emoji),
// so the guard runs on `encodeURIComponent(name)`. The overhead is measured
// off the real format rather than counted by hand (a hand count missed the
// colon after the slot and let 61-char markers through), so a format change
// cannot desynchronize them again.
const MARKER_OVERHEAD = markerFor('0123456789abcdef', 'm', 'x').length - 1;
const MARKER_MAX_LENGTH = 60;
// The longest encoded name that still mints a 60-char marker.
const MAX_ENCODED_NAME_LENGTH = MARKER_MAX_LENGTH - MARKER_OVERHEAD;

function encodedNameLength(name: string): number {
  return encodeURIComponent(name.trim()).length;
}

function isNameTooLong(name: string): boolean {
  return encodedNameLength(name) > MAX_ENCODED_NAME_LENGTH;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * #129/P1-B: the intent identity. It scopes every later write, so a
 * completion can never touch an intent created by another attempt. Hermes has
 * no guaranteed `crypto.randomUUID`, hence the fallback.
 */
function novoIntentId(): string {
  const cripto = (globalThis as {crypto?: {randomUUID?: () => string}}).crypto;
  if (cripto?.randomUUID) return cripto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export const CreateOrganization = ({
  navigation,
}: NativeStackScreenProps<AppStackParamsList, 'CreateOrganization'>) => {
  // SPEC B §3.1/D13: the journey is ONE screen with two local stages —
  // the intro (B :54) and the name form (B :55) — never routes.
  const [etapa, setEtapa] = React.useState<'introducao' | 'nome'>('introducao');
  // #129: the name is picked from the predefined territory catalog — never
  // typed — and the remote archive URL is required to create.
  const [selectedTerritoryId, setSelectedTerritoryId] = React.useState<
    string | null
  >(null);
  const [archiveUrl, setArchiveUrl] = React.useState('');
  const {formatMessage: t} = useIntl();
  // The root-owned materialization engine (SPEC B §5.4): the screen only
  // starts it and hands the journey over to the document — the promise
  // keeps running at the root, surviving this screen's unmount.
  const {instance} = useCoiabOrganizationsStoreContext();
  const estado = useCoiabOrganizationsState();
  const materializador = useOrganizationMaterializer();
  // P1-1: creation belongs to coordinators. A participant reaching this route
  // (drawer, provisioning, direct navigation) is sent to the waiting screen.
  const {coordinationRole} = useUserProfileState();
  const {addPendingArchiveIntent} = useUserProfileActions();
  // The id of the intent created by THIS screen, handed to the provisioning
  // route so only that screen pins the target. It is set only once this
  // attempt PROVED the organization in the document belongs to it (the start
  // resolved, or it registered the organization before failing recoverably),
  // so a handover caused by another creation never carries it.
  const [intentIdConfirmado, setIntentIdConfirmado] = React.useState<
    string | null
  >(null);
  // One-shot guard: the redirect must land once even if the effect re-runs.
  const redirecionouParticipanteRef = React.useRef(false);
  // SPEC B §3.3 items 2-3 and §5.5: a document with a creation in flight
  // (or a pending confirmation) outranks the form — the provisioning
  // surface owns its recovery and its confirmation — and a settled
  // document NOT being operated (no resolvable active selection) is the
  // same handover: starting over it is never authorized. The ONE state
  // that leaves an explicitly opened form alone is the settled,
  // operating one (pronta, acknowledged, selection resolvable): there the
  // device already operates the organization, and a second creation is
  // the materializer's own guarded call.
  // The handover is the ONE replace that must land while a hold was set
  // (SPEC B §3.2). It is DERIVED (`deveTrocar` below): it fires only in a
  // commit where the flight has ended (`!iniciando`), so the hold's
  // listener below is already unsubscribed when the replace dispatches and
  // beforeRemove passes it untouched. Dispatching it under the hold and
  // re-dispatching a prevented action off the beforeRemove emission (the
  // `VISITED_ROUTE_KEYS` skip) committed it while the provider's
  // route-key registration still held this route:
  // PreventRemoveProvider refuses to register a hold for a route the
  // navigation state no longer contains (the mount crash this screen had).
  const [startResolvido, setStartResolvido] = React.useState(false);
  const [erro, setErro] = React.useState<Error | null>(null);
  // A synchronous re-entry guard: a state check alone would let a second
  // press slip through before the rerender publishes the loading UI.
  const iniciandoRef = React.useRef(false);
  const [iniciando, setIniciando] = React.useState(false);
  // The layer's typed refusal (SPEC B §5.5) surfaces as a blocked state:
  // the form stays, explains, and re-arms — never crash, never silence.
  const [bloqueado, setBloqueado] = React.useState(false);

  // P1-1: participants never see the form. The replace is guarded so a
  // re-render (or a redirect loop) cannot dispatch it twice.
  React.useEffect(() => {
    if (coordinationRole !== 'participant') return;
    if (redirecionouParticipanteRef.current) return;
    redirecionouParticipanteRef.current = true;
    navigation.replace('JoinOrganizationIntro');
  }, [coordinationRole, navigation]);

  // SPEC B §3.2:64/:68 (Fase 5, fix round 3): while a start is in flight,
  // Back cannot remove this screen — the one state §3.2 names ("durante
  // uma chamada de criação/importação"). The screen explains the hold in
  // BOTH of its stages: the name form renders the loading state
  // (`m.creating`), and the §3.1 listener below has already turned a first
  // back into the intro hop — where the SAME `m.creating` copy renders
  // while the flight is alive, so a dropped second back is never silent.
  // The typed refusal (SPEC B §5.5) is NOT a live operation of this
  // screen: a refused start never resolves, so it does not extend the
  // hold — §3.2's authorization stays narrow, and Back keeps working
  // after a refusal (`iniciando` alone is the predicate — never
  // `|| bloqueado`, B5-3).
  // Programmatic removals are not user exits, so they pass untouched:
  // `usePreventRemove` cannot serve this hold because it preventDefaults
  // EVERY removal (core's own beforeRemove listener) and a prevented RESET
  // is consumed-and-dropped — GenerationTransitionGate advances its
  // generation before dispatching and never retries. Same defect B5-4
  // fixed in OrganizationProvisioning: §5.5's recovery table makes the
  // system's routing mandatory. The header back and the JS-side gesture
  // both dispatch GO_BACK/POP, so the listener covers every exit §3.2
  // names; the Android hardware press is consumed first below.
  React.useEffect(() => {
    if (!iniciando) return;
    const unsubscribe = navigation.addListener('beforeRemove', e => {
      const type = e.data.action.type;
      // A USER back attempt is held (the removal stays dropped: a back at
      // the name stage was already turned into the screen's own intro hop
      // by the §3.1 listener below); a programmatic removal (the
      // generation gate's reset, the system's §5.5 reconciliation
      // routing) is mandatory and never prevented here.
      if (type !== 'GO_BACK' && type !== 'POP') return;
      e.preventDefault();
    });
    const hardware = BackHandler.addEventListener(
      'hardwareBackPress',
      () => true,
    );
    return () => {
      unsubscribe();
      hardware.remove();
    };
  }, [iniciando, navigation]);

  // The handover is DERIVED, not armed (the lint-clean form of the same
  // deferred dispatch): the provisioning surface owns a document with
  // organization work alive, and a start that RESOLVED while the document
  // still resolves a selection is the screen's own job — both replace as
  // soon as the flight ends and the hold is down. Both inputs are
  // render-pure: the document read is external-store state, and
  // `startResolvido` is only ever set from the start's own `.then`
  // (an interaction event, never an effect).
  // Plano §4 (Fase 4): the organization in preparation need not have been
  // started here — it may ride in the persisted document from another
  // origin (see the gate comment at the top of the component).
  const existeOrganizacaoEmPreparo = organizacaoEmPreparo(estado) !== undefined;
  const documentoAssentadoSemSelecao =
    estado.organizacoes.length > 0 && derivarProjectIdAtivo(estado) === null;

  // `bloqueado` does NOT gate the handover. A typed refusal means THIS
  // screen's start never resolved — the refusal is thrown before the
  // `.then`, so `startResolvido` stays false and the gate is naturally
  // false after a refusal. `bloqueado` itself is a terminal banner state
  // (cleared only by a fresh press), so reading it here would pin Back and
  // the handover shut until the user re-attempts; when the document later
  // settles without a resolvable selection — the other flight registering
  // its organization — the provisioning surface owns it (§3.3 item 2) and
  // the replace must land regardless of the stale banner.
  const deveTrocar =
    (existeOrganizacaoEmPreparo ||
      documentoAssentadoSemSelecao ||
      startResolvido) &&
    !iniciando;

  // The deferred handover dispatch (estado → effect → replace): it fires
  // only when `deveTrocar` is true — by then `iniciando` is false, the
  // hold's listener is unsubscribed, and beforeRemove passes the replace
  // untouched. No setState in the body: the predicate is derived above,
  // and navigation is the external system.
  React.useEffect(() => {
    if (!deveTrocar) return;
    // P1-1: a participant's destination is the waiting screen, never the
    // provisioning surface.
    if (coordinationRole === 'participant') return;
    // The intent of THIS creation travels with the route: the provisioning
    // surface pins only it, so a different territory can never inherit the
    // URL (P1-A). Only an attempt that PROVED the organization belongs to it
    // may carry the id; a handover caused by another creation's document
    // must not carry this screen's orphan id.
    if (intentIdConfirmado) {
      navigation.replace('OrganizationProvisioning', {
        intentId: intentIdConfirmado,
      });
    } else {
      navigation.replace('OrganizationProvisioning');
    }
  }, [deveTrocar, coordinationRole, intentIdConfirmado, navigation]);

  const territoryOptions = territoriesData.territories;
  const selectedTerritory = territoryOptions.find(
    territory => territory.id === selectedTerritoryId,
  );
  const trimmedName = selectedTerritory?.name.trim() ?? '';
  const tooLong = trimmedName.length > 0 && isNameTooLong(trimmedName);
  // The archive URL is validated on every change and only as FORMAT (no
  // reachability): a normalized URL is the sole valid state.
  const normalizedArchiveUrl = React.useMemo(() => {
    if (!archiveUrl.trim()) return null;
    try {
      return normalizeRemoteArchiveUrl(archiveUrl);
    } catch {
      return null;
    }
  }, [archiveUrl]);
  const archiveUrlInvalid =
    archiveUrl.trim().length > 0 && normalizedArchiveUrl === null;
  const canCreate =
    !!selectedTerritory && normalizedArchiveUrl !== null && !tooLong;

  // SPEC B :54/:55: Back from the name stage returns to the intro and
  // creates nothing; from the intro, Back pops to the choice (Success).
  // Only back-type removals are intercepted — the provisioning handover
  // (replace) and any other action must pass through untouched.
  React.useEffect(() => {
    if (etapa !== 'nome') return;
    const unsubscribe = navigation.addListener('beforeRemove', e => {
      const type = e.data.action.type;
      if (type !== 'GO_BACK' && type !== 'POP') return;
      e.preventDefault();
      setEtapa('introducao');
    });
    return unsubscribe;
  }, [etapa, navigation]);

  // Cold start: this route may be the initial one, so the hardware Back has
  // no history to pop and would exit the app. The intro stage is the choice
  // fork's child, so Back there still belongs to the role question. With
  // history the navigator's own handler owns the pop (this listener is not
  // registered), and during a live operation the hold below wins.
  React.useEffect(() => {
    if (etapa !== 'introducao' || iniciando) return;
    if (navigation.canGoBack()) return;
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => {
      navigation.replace('Success');
      return true;
    });
    return () => hardware.remove();
  }, [etapa, iniciando, navigation]);

  // A rejection means NOTHING was persisted (the materializer routes every
  // mid-materialization failure into the document as `falha_recuperavel`
  // instead of throwing): the form stays with its draft and explains the
  // error. A document that appeared during the attempt is the provisioning
  // surface's business, not an error sheet.
  React.useEffect(() => {
    // PRE-MERGE 4: the sheet gate is the SAME §4.2 predicate as the catch's
    // race swallow below (`organizacaoEmPreparo` on the document — defined
    // iff classificarDocumento ∈ {preparando, confirmacao}). The two gates
    // must evolve together; if one changes, change its twin.
    if (!erro || organizacaoEmPreparo(estado)) return;
    navigation.navigate('ErrorBottomSheet', {error: erro});
  }, [erro, estado, navigation]);

  function handleCreatePress() {
    if (iniciandoRef.current || deveTrocar) {
      return;
    }
    if (!selectedTerritory || !normalizedArchiveUrl || tooLong) {
      // The button is disabled in these states; the guard keeps a stale
      // press from calling the core anyway.
      return;
    }
    if (!materializador) {
      // Absent capability is fail-closed feedback, not a silent no-op.
      setErro(new Error('materialization-unavailable'));
      return;
    }
    // #129/P1-2: record the normalized URL + target BEFORE the start. The
    // global resume hook is the only owner of the network add. A failed
    // persistence must not arm the latch: the form stays usable and explains
    // the existing error path instead of trapping a press that was never
    // recorded.
    const intentId = novoIntentId();
    try {
      addPendingArchiveIntent({
        id: intentId,
        url: normalizedArchiveUrl,
        organizationId: null,
      });
    } catch (error) {
      setErro(toError(error));
      return;
    }
    setIntentIdConfirmado(null);
    iniciandoRef.current = true;
    // The blocked state re-arms HERE, at the start of a new attempt (the
    // state's own contract): a message that survived into a fresh press
    // would falsify "creation in progress" once the previous flight ended.
    // A refusal re-sets it in the catch below; success (or a race swallow)
    // leaves it cleared.
    setBloqueado(false);
    setIniciando(true);
    // Organization ids already in the document when THIS start began. A
    // rejection may then tell which un-settled entries are ours (new ids) and
    // which belong to another creation/pending work (pre-existing ids) —
    // only the former may receive this attempt's intent.
    const organizacoesAntes = new Set(
      instance.getState().organizacoes.map(organizacao => organizacao.id),
    );
    materializador
      .iniciar(trimmedName)
      .then(() => {
        // BLOCKER 2: a resolved start means the operation is alive and the
        // provisioning surface owns it (it renders `preparando`/
        // confirmation by id — Fase 3). When the document still resolves
        // an active selection (the second creation over a settled A), the
        // derived predicate above stays false — `derivarProjectIdAtivo`
        // never turns null — so the handover is the screen's own job:
        // `startResolvido` flips the `deveTrocar` gate and the effect
        // BELOW dispatches the replace once the flight ends. For a first
        // creation the predicate has already replaced this screen (no
        // selection ⇒ null ⇒ no spurious second replace). `.then` before
        // `.catch`: a refusal must never navigate.
        setIntentIdConfirmado(intentId);
        setStartResolvido(true);
      })
      .catch((error: unknown) => {
        // The layer's OWN refusal (SPEC B §5.5, now in the materializer
        // layer): the start was refused while another creation is in
        // flight — signal the blocked state; the document is the
        // provisioning surface's business, not an error sheet. Branch on
        // the typed code (fanout.ts), never the message.
        if (
          error instanceof OrganizationOperationError &&
          error.code === 'creation-in-progress'
        ) {
          setBloqueado(true);
          return;
        }
        // A rejection that raced against a creation in flight (or a
        // pending confirmation) is the provisioning surface's business —
        // the §4.2 predicate (`organizacaoEmPreparo`, not "any entry
        // exists") is what makes a document un-creatable-over. PRE-MERGE
        // 4: this is the SAME predicate as the error-sheet effect's gate
        // above — the twin gates must evolve together.
        const estadoAtual = instance.getState();
        const registradaAqui = estadoAtual.organizacoes.find(
          organizacao =>
            !organizacoesAntes.has(organizacao.id) &&
            (organizacao.estado !== 'pronta' ||
              organizacao.confirmacaoPendente),
        );
        if (registradaAqui) {
          // The start failed AFTER registering the organization: the document
          // entry is this attempt's, so the intent may be pinned to it by the
          // provisioning surface.
          setIntentIdConfirmado(intentId);
          return;
        }
        if (organizacaoEmPreparo(estadoAtual)) {
          // The un-settled organization predates this attempt (another
          // creation or pending work). Its surface owns the handover and this
          // attempt's intent must NOT travel with it.
          return;
        }
        const falha = toError(error);
        if (falha instanceof ErroPacote) {
          // Decisão A/A4: ErrorBottomSheet surfaces `error.code` in its
          // advanced section — the machine code rides through unchanged.
          (falha as ErroPacote & {code?: string}).code = falha.codigo;
          if (falha.codigo === 'pacote_nao_aprovado') {
            // ⚑ SPEC (A4): no canonical copy for a package failure before
            // any write — see the descriptor's comment. The message the
            // sheet receives is the minimal factual one, never a
            // "salvo/está salvo" claim.
            falha.message = t(m.pacoteNaoAprovado);
          }
        }
        setErro(falha);
      })
      .finally(() => {
        iniciandoRef.current = false;
        setIniciando(false);
      });
  }
  // P1-1: the form is never rendered for a participant — the effect above
  // replaces this route with the waiting screen.
  if (coordinationRole === 'participant') {
    return null;
  }
  if (etapa === 'introducao') {
    return (
      <KeyboardAvoidingView style={{width: '100%', height: '100%'}}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.container}>
            <View style={styles.headerArea}>
              <HeaderText variant="header2" style={styles.title}>
                {t(m.createOrganization)}
              </HeaderText>
              <BodyText style={styles.body}>{t(m.createIntroBody)}</BodyText>
              {/* B5-2 (fix round 2): a first back lands here (the §3.1
                  hop) while the start is still in flight — the creating
                  copy is what the user sees when a second back is dropped
                  by the hold above; without it the drop is silent. */}
              {iniciando && (
                <BodyText variant="smallMeta" testID="ORG.create-creating">
                  {t(m.creating)}
                </BodyText>
              )}
            </View>
            <View style={styles.buttonContainer}>
              <PrimaryButton
                testID="ORG.create-intro-continue-btn"
                fullSize
                text={t(m.continueButton)}
                onPress={() => setEtapa('nome')}
              />
            </View>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    );
  }
  return (
    <KeyboardAvoidingView style={{width: '100%', height: '100%'}}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.container}>
          <View style={styles.headerArea}>
            <HeaderText variant="header2" style={styles.title}>
              {t(m.createOrganization)}
            </HeaderText>
            <BodyText style={styles.body}>{t(m.nameGuidance)}</BodyText>
            <BodyText style={styles.body}>{t(m.nameNotIdentity)}</BodyText>
            <View style={styles.nameForm}>
              <BodyText variant="smallMeta">{t(m.nameLabel)}</BodyText>
              {/* #129: closed selector over the predefined territory list —
                  the name is never free text. */}
              <View testID="ORG.create-name-select" style={styles.nameSelect}>
                {territoryOptions.map(territory => {
                  const selected = territory.id === selectedTerritoryId;
                  return (
                    <Pressable
                      key={territory.id}
                      testID={`ORG.create-name-option-${territory.id}`}
                      accessibilityRole="button"
                      accessibilityState={{selected}}
                      style={[
                        styles.nameOption,
                        selected && styles.nameOptionSelected,
                      ]}
                      onPress={() => setSelectedTerritoryId(territory.id)}>
                      <BodyText>{territory.name}</BodyText>
                    </Pressable>
                  );
                })}
              </View>
              {tooLong && (
                <BodyText variant="smallMeta" testID="ORG.create-name-too-long">
                  {t(m.tooLong)}
                </BodyText>
              )}
              <BodyText variant="smallMeta">{t(m.archiveUrlLabel)}</BodyText>
              <TextInput
                testID="ORG.create-archive-url-inp"
                style={styles.textInput}
                value={archiveUrl}
                onChangeText={setArchiveUrl}
                placeholderTextColor={LIGHT_GREY}
                placeholder={t(m.archiveUrlPlaceholder)}
                autoCapitalize="none"
                keyboardType="url"
                autoCorrect={false}
              />
              {archiveUrlInvalid && (
                <BodyText
                  variant="smallMeta"
                  testID="ORG.create-archive-url-invalid">
                  {t(m.archiveUrlInvalid)}
                </BodyText>
              )}
            </View>
          </View>
          <View style={styles.buttonContainer}>
            {bloqueado && (
              <BodyText variant="smallMeta" testID="ORG.create-blocked">
                {t(m.creationInProgress)}
              </BodyText>
            )}
            {iniciando ? (
              <>
                <LoadingIndicator size="large" style={{flex: 0}} />
                <BodyText variant="smallMeta">{t(m.creating)}</BodyText>
              </>
            ) : (
              <PrimaryButton
                testID="ORG.create-btn"
                fullSize
                text={t(m.createOrganization)}
                disabled={!canCreate}
                onPress={handleCreatePress}
              />
            )}
          </View>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 20,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerArea: {
    alignItems: 'center',
    gap: 10,
    width: 280,
  },
  title: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
  },
  nameForm: {
    gap: 10,
    width: '100%',
  },
  textInput: {
    borderWidth: 1,
    borderColor: LIGHT_GREY,
    borderRadius: 4,
    color: BLACK,
    fontSize: 16,
    paddingHorizontal: 16,
  },
  nameSelect: {
    width: '100%',
    gap: 8,
  },
  nameOption: {
    borderWidth: 1,
    borderColor: LIGHT_GREY,
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  nameOptionSelected: {
    borderColor: COMAPEO_BLUE,
    borderWidth: 2,
  },
  buttonContainer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
});
