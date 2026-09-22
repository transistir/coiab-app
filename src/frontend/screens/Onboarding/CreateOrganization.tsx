import * as React from 'react';
import {
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
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
import {BLACK, LIGHT_GREY} from '../../lib/styles';
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

const m = defineMessages({
  // SPEC B :54/:55: both stages share the title and the submit button
  // "Criar organização" — one descriptor. Success's primary button uses
  // the SAME id with the SAME defaultMessage (identical duplicates are
  // allowed by the extraction gate).
  createOrganization: {
    id: '$1screens.OrganizationSetup.createOrganization',
    defaultMessage: 'Create Organization',
  },
  createIntroBody: {
    id: '$1screens.OrganizationSetup.createIntroBody',
    // SPEC B :54 — verbatim.
    defaultMessage:
      'Your Organization will have Monitoramento and Alertas, with categories ready to use. You can create it without internet.',
  },
  continueButton: {
    id: '$1screens.OrganizationSetup.continueButton',
    // SPEC B :54.
    defaultMessage: 'Continue',
  },
  nameLabel: {
    id: '$1screens.OrganizationSetup.nameLabel',
    // SPEC B :55 (also the :94 table) — the field label.
    defaultMessage: 'Organization name',
  },
  nameGuidance: {
    id: '$1screens.OrganizationSetup.nameGuidance',
    // SPEC B :55 — verbatim.
    defaultMessage: 'Choose a name for your Organization.',
  },
  nameNotIdentity: {
    id: '$1screens.OrganizationSetup.nameNotIdentity',
    // SPEC B :55 — verbatim.
    defaultMessage:
      'Using the same name as another Organization does not connect the devices. To join an existing Organization, wait for an invitation.',
  },
  emptyName: {
    id: '$1screens.OrganizationSetup.emptyName',
    // SPEC B :252 — verbatim.
    defaultMessage: 'Enter the Organization name.',
  },
  creating: {
    id: '$1screens.Onboarding.CreateOrganization.creating',
    defaultMessage: 'Creating Organization…',
  },
  // ⚑ SPEC (A4): there is no canonical copy for the materializer's typed
  // refusal (SPEC B §5.5 guard) — this minimal factual descriptor fills
  // the gap. COPY PENDING A SPEC DECISION.
  creationInProgress: {
    id: '$1screens.Onboarding.CreateOrganization.creationInProgress',
    defaultMessage: 'An Organization creation is already in progress.',
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
    defaultMessage: 'Organization name is too long',
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

export const CreateOrganization = ({
  navigation,
}: NativeStackScreenProps<AppStackParamsList, 'CreateOrganization'>) => {
  // SPEC B §3.1/D13: the journey is ONE screen with two local stages —
  // the intro (B :54) and the name form (B :55) — never routes.
  const [etapa, setEtapa] = React.useState<'introducao' | 'nome'>('introducao');
  const [name, setName] = React.useState('');
  const {formatMessage: t} = useIntl();
  // The root-owned materialization engine (SPEC B §5.4): the screen only
  // starts it and hands the journey over to the document — the promise
  // keeps running at the root, surviving this screen's unmount.
  const {instance} = useCoiabOrganizationsStoreContext();
  const estado = useCoiabOrganizationsState();
  const materializador = useOrganizationMaterializer();
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
  const [emptyNameError, setEmptyNameError] = React.useState(false);
  // A synchronous re-entry guard: a state check alone would let a second
  // press slip through before the rerender publishes the loading UI.
  const iniciandoRef = React.useRef(false);
  const [iniciando, setIniciando] = React.useState(false);
  // The layer's typed refusal (SPEC B §5.5) surfaces as a blocked state:
  // the form stays, explains, and re-arms — never crash, never silence.
  const [bloqueado, setBloqueado] = React.useState(false);

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
  // deferred dispatch): a settled document that no selection resolves is
  // the provisioning surface's business, and a start that RESOLVED while
  // the document still resolves a selection is the screen's own job —
  // both replace as soon as the flight ends and the hold is down. Both
  // inputs are render-pure: the document read is external-store state,
  // and `startResolvido` is only ever set from the start's own `.then`
  // (an interaction event, never an effect).
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
    (documentoAssentadoSemSelecao || startResolvido) && !iniciando;

  // The deferred handover dispatch (estado → effect → replace): it fires
  // only when `deveTrocar` is true — by then `iniciando` is false, the
  // hold's listener is unsubscribed, and beforeRemove passes the replace
  // untouched. No setState in the body: the predicate is derived above,
  // and navigation is the external system.
  React.useEffect(() => {
    if (!deveTrocar) return;
    navigation.replace('OrganizationProvisioning');
  }, [deveTrocar, navigation]);

  const trimmedName = name.trim();
  const tooLong = isNameTooLong(name);

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

  function handleNameChange(value: string) {
    setName(value);
    setEmptyNameError(false);
  }

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
    if (trimmedName.length === 0) {
      // SPEC B :252: an empty (or whitespace-only) name is rejected BEFORE
      // persisting the intent — the message explains; the core is never
      // called. (B :253's over-long bound keeps the button disabled.)
      setEmptyNameError(true);
      return;
    }
    if (tooLong) {
      return;
    }
    if (!materializador) {
      // Absent capability is fail-closed feedback, not a silent no-op.
      setErro(new Error('materialization-unavailable'));
      return;
    }
    iniciandoRef.current = true;
    // The blocked state re-arms HERE, at the start of a new attempt (the
    // state's own contract): a message that survived into a fresh press
    // would falsify "creation in progress" once the previous flight ended.
    // A refusal re-sets it in the catch below; success (or a race swallow)
    // leaves it cleared.
    setBloqueado(false);
    setIniciando(true);
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
        if (organizacaoEmPreparo(instance.getState())) {
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
              <TextInput
                testID="ORG.create-name-inp"
                style={styles.textInput}
                value={name}
                onChangeText={handleNameChange}
                maxLength={MARKER_MAX_LENGTH}
                placeholderTextColor={LIGHT_GREY}
                placeholder={t(m.nameLabel)}
                autoCapitalize="none"
              />
              {emptyNameError && (
                <BodyText variant="smallMeta" testID="ORG.create-name-empty">
                  {t(m.emptyName)}
                </BodyText>
              )}
              {tooLong && (
                <BodyText variant="smallMeta" testID="ORG.create-name-too-long">
                  {t(m.tooLong)}
                </BodyText>
              )}
              <BodyText variant="smallMeta" style={styles.counterText}>
                {`${encodedNameLength(name)}/${MAX_ENCODED_NAME_LENGTH}`}
              </BodyText>
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
                disabled={tooLong}
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
  counterText: {
    alignSelf: 'flex-end',
  },
  buttonContainer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
});
