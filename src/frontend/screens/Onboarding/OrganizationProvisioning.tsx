import * as React from 'react';
import {Alert, StyleSheet, View} from 'react-native';
import {defineMessages, useIntl} from 'react-intl';
import {useQueryClient} from '@tanstack/react-query';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {useManyInvites} from '@comapeo/core-react';

import {HeaderText} from '../../sharedComponents/Text/HeaderText';
import {BodyText} from '../../sharedComponents/Text/BodyText';
import {LoadingIndicator} from '../../sharedComponents/LoadingIndicator';
import {
  DestructiveButton,
  PrimaryButton,
  SecondaryButton,
} from '../../sharedComponents/Buttons';
import {AppStackParamsList} from '../../sharedTypes/navigation';
import {useOrganizations} from '../../hooks/organization/useOrganizations';
import {useCreateOrganization} from '../../hooks/organization/useCreateOrganization';
import {useDiscardIncompleteOrganization} from '../../hooks/organization/useDiscardIncompleteOrganization';
import {getOrganizationCreationCompletion} from '../../hooks/organization/useOrganizationCreationCompletion';
import {useCoiabOrganizationsState} from '../../contexts/CoiabOrganizationsStoreContext';
import {useOrganizationActivationContext} from '../../contexts/OrganizationActivationContext';
import {useActiveProjectId} from '../../contexts/ActiveProjectIdStoreContext';
import {groupPendingInvites} from '../../lib/organization/bundle';
import {useHasOrganizationCreationProvenance} from '../../lib/organization/creationProvenance';
import {
  AREAS,
  derivarProjectIdAtivo,
  type EtapaArea,
  type OrganizacaoLocal,
} from '../../lib/organization/coiabOrganizations';
import {SLOTS, SLOT_PROJECT_NAMES} from '../../lib/organization/marker';
import {DARK_GREY, RED} from '../../lib/styles';
import type {ReconstructedOrganization} from '../../lib/organization/reconstruct';

const m = defineMessages({
  settingUp: {
    id: '$1screens.OrganizationProvisioning.settingUp',
    defaultMessage: 'Setting up your Organization…',
  },
  invalid: {
    id: '$1screens.OrganizationProvisioning.invalid',
    defaultMessage:
      'Something is wrong with this Organization. Contact support.',
  },
  finishSetup: {
    id: '$1screens.OrganizationProvisioning.finishSetup',
    defaultMessage: 'Finish setting up',
  },
  discardSetup: {
    id: '$1screens.OrganizationProvisioning.discardSetup',
    defaultMessage: 'Discard and start over',
  },
  discardConfirmTitle: {
    id: '$1screens.OrganizationProvisioning.discardConfirmTitle',
    defaultMessage: 'Discard this Organization setup?',
  },
  discardConfirmBody: {
    id: '$1screens.OrganizationProvisioning.discardConfirmBody',
    defaultMessage:
      "This device will leave the projects in this setup. Other members will see this device leave the projects. If this device is a project's only coordinator, then no other device can add or remove devices, adjust project info, or update the categories set. Observations not yet synced from this device will no longer be available here, so export any important data first. Other members keep the projects and their copies.",
  },
  cancel: {
    id: '$1screens.OrganizationProvisioning.cancel',
    defaultMessage: 'Cancel',
  },
  discardFailed: {
    id: '$1screens.OrganizationProvisioning.discardFailed',
    defaultMessage:
      'Something went wrong while discarding this setup. It was not fully removed — you can try again.',
  },
  cannotFinish: {
    id: '$1screens.OrganizationProvisioning.cannotFinish',
    defaultMessage:
      'This Organization was not left half-created on this device, so its setup cannot be finished here.',
  },
  skippedStale: {
    id: '$1screens.OrganizationProvisioning.skippedStale',
    defaultMessage:
      '{projectName} changed while it was being discarded, so it was kept.',
  },
  skippedJoinPending: {
    id: '$1screens.OrganizationProvisioning.skippedJoinPending',
    defaultMessage:
      'An invitation for this organization is still syncing. Try again once it finishes.',
  },
  // SPEC B §4.4: organization-owned concepts get their own descriptors — the
  // document-driven preparation view, its failure recovery and its
  // confirmation.
  preparingTitle: {
    id: '$1screens.OrganizationSetup.preparingTitle',
    defaultMessage: 'Preparing your organization…',
  },
  preparingStepA11y: {
    id: '$1screens.OrganizationSetup.preparingStepA11y',
    defaultMessage: 'Preparing your organization',
  },
  monitoringRow: {
    id: '$1screens.OrganizationSetup.monitoringRow',
    defaultMessage: 'Monitoring',
  },
  alertsRow: {
    id: '$1screens.OrganizationSetup.alertsRow',
    defaultMessage: 'Alerts',
  },
  areaWaiting: {
    id: '$1screens.OrganizationSetup.areaWaiting',
    defaultMessage: 'Waiting',
  },
  areaPreparing: {
    id: '$1screens.OrganizationSetup.areaPreparing',
    defaultMessage: 'Preparing',
  },
  areaReady: {
    id: '$1screens.OrganizationSetup.areaReady',
    defaultMessage: 'Ready',
  },
  areaNotComplete: {
    id: '$1screens.OrganizationSetup.areaNotComplete',
    defaultMessage: 'Not completed',
  },
  failureTitle: {
    id: '$1screens.OrganizationSetup.failureTitle',
    defaultMessage: 'Could not finish creating the organization.',
  },
  failureBody: {
    id: '$1screens.OrganizationSetup.failureBody',
    defaultMessage: 'What was already prepared is saved. Try again to finish.',
  },
  retryPreparationButton: {
    id: '$1screens.OrganizationSetup.retryPreparationButton',
    defaultMessage: 'Try again',
  },
  createdTitle: {
    id: '$1screens.OrganizationSetup.createdTitle',
    defaultMessage: 'Organization created',
  },
  createdBody: {
    id: '$1screens.OrganizationSetup.createdBody',
    defaultMessage:
      '{organizationName} is ready. Monitoring and Alerts are already available.',
  },
  openOrganizationButton: {
    id: '$1screens.OrganizationSetup.openOrganizationButton',
    defaultMessage: 'Open organization',
  },
});

/** Why each kept project is still on the device, per skip reason. */
const SKIP_MESSAGES = {
  'no-longer-incomplete': m.skippedStale,
  'join-pending': m.skippedJoinPending,
} as const;

/** The row status an area's journal etapa displays (SPEC B §4.4). */
function statusMessageForEtapa(etapa: EtapaArea['etapa']) {
  switch (etapa) {
    case 'ausente':
      return m.areaWaiting;
    case 'verificado':
      return m.areaReady;
    default:
      return m.areaPreparing;
  }
}

/** One row per area, in the document's own preparation vocabulary. */
function AreaStepRows({organizacao}: {organizacao: OrganizacaoLocal}) {
  const {formatMessage: t} = useIntl();
  return (
    <View style={styles.rows}>
      {AREAS.map(area => {
        // Only a persisted failure names an area Não concluído; a stale
        // error left behind by a retry in flight is never displayed.
        const errored =
          organizacao.estado === 'falha_recuperavel' &&
          organizacao.ultimoErro?.area === area;
        const areaName = t(
          area === 'monitoramento' ? m.monitoringRow : m.alertsRow,
        );
        const status = t(
          errored
            ? m.areaNotComplete
            : statusMessageForEtapa(organizacao.materializacao[area].etapa),
        );
        return (
          <View key={area} style={styles.row}>
            <BodyText style={styles.rowArea}>{areaName}</BodyText>
            <BodyText
              style={errored ? styles.rowStatusError : styles.rowStatus}>
              {status}
            </BodyText>
          </View>
        );
      })}
    </View>
  );
}

/**
 * The document-driven view (SPEC B §4.4): the persisted organization document
 * exists, so the screen renders ITS state — preparation rows, the canonical
 * recoverable-failure sentences, or the confirmation — instead of the
 * reconstructed fan-out surface. The fanout retry/discard buttons have no
 * place here: the document owns recovery.
 */
function DocumentDrivenProvisioning({
  organizacao,
}: {
  organizacao: OrganizacaoLocal;
}) {
  const {formatMessage: t} = useIntl();
  const activation = useOrganizationActivationContext();
  const queryClient = useQueryClient();
  const [activating, setActivating] = React.useState(false);
  // Synchronous guard: the disabled prop alone lets a double tap queue a
  // second activate before the rerender publishes it.
  const activatingRef = React.useRef(false);

  const abrirOrganizacao = async () => {
    if (activatingRef.current) return;
    activatingRef.current = true;
    setActivating(true);
    try {
      if (await activation.activate(organizacao.id, {acknowledge: true})) {
        // SPEC A §4.2 regra 9: the activation engine acknowledged and
        // selected in one write; this hands the navigation completion the
        // project the document pinned for Monitoramento.
        const projectId = organizacao.materializacao.monitoramento.projectId;
        if (projectId) {
          getOrganizationCreationCompletion(queryClient).setState({projectId});
        }
      }
    } finally {
      activatingRef.current = false;
      setActivating(false);
    }
  };

  return (
    <View style={styles.container}>
      {organizacao.estado === 'preparando' && (
        <>
          <LoadingIndicator
            size="large"
            accessibilityLabel={t(m.preparingStepA11y)}
          />
          <HeaderText variant="header2" style={styles.title}>
            {t(m.preparingTitle)}
          </HeaderText>
        </>
      )}
      {organizacao.estado === 'falha_recuperavel' && (
        <>
          <HeaderText variant="header2" style={styles.title}>
            {t(m.failureTitle)}
          </HeaderText>
          <BodyText style={styles.bodyText}>{t(m.failureBody)}</BodyText>
        </>
      )}
      {organizacao.estado === 'pronta' && organizacao.confirmacaoPendente && (
        <HeaderText variant="header2" style={styles.title}>
          {t(m.createdTitle)}
        </HeaderText>
      )}
      {organizacao.estado === 'pronta' && organizacao.confirmacaoPendente && (
        <BodyText style={styles.bodyText}>
          {t(m.createdBody, {organizationName: organizacao.nome})}
        </BodyText>
      )}
      <AreaStepRows organizacao={organizacao} />
      {organizacao.estado === 'falha_recuperavel' && (
        <PrimaryButton
          testID="ORG.provisioning-retry-preparation-btn"
          fullSize
          text={t(m.retryPreparationButton)}
          onPress={() => {
            // The engine's own lock joins a same-key in-flight retry, so a
            // double tap cannot double-resume either.
            void activation.retryPreparation(organizacao.id);
          }}
        />
      )}
      {organizacao.estado === 'pronta' && organizacao.confirmacaoPendente && (
        <PrimaryButton
          testID="ORG.provisioning-open-organization-btn"
          fullSize
          text={t(m.openOrganizationButton)}
          disabled={activating}
          onPress={() => {
            void abrirOrganizacao();
          }}
        />
      )}
    </View>
  );
}

/**
 * Fail-closed screen for an Organization that is not an open, acknowledged
 * organization yet (SPEC 10.1 / SPEC B §3.3-§4.4).
 *
 * With a persisted organization document (`estado.organizacoes[0]`), the
 * document drives everything: `preparando` shows the two area rows with no
 * buttons; `falha_recuperavel` offers Tentar novamente through the activation
 * engine; `pronta` with a pending confirmation offers Abrir organização and
 * waits — it never resets to Home on the reconstruction's word. Without a
 * document (legacy data), the reconstructed fan-out surface keeps its
 * behavior: the resume offer gated on durable creation provenance and pending
 * invites, and the destructive-discard escape hatch.
 */
export const OrganizationProvisioning = ({
  navigation,
}: NativeStackScreenProps<AppStackParamsList, 'OrganizationProvisioning'>) => {
  const {formatMessage: t} = useIntl();
  const estado = useCoiabOrganizationsState();
  const organizacaoDocument = estado.organizacoes[0];
  const documentGuides = organizacaoDocument !== undefined;
  // The document's own operational id (SPEC A §4.2 regra 5): null while the
  // confirmation is pending or the document cannot be parsed.
  const derivado = derivarProjectIdAtivo(estado);
  const activeProjectId = useActiveProjectId();

  const organizations = useOrganizations();
  const {start, status} = useCreateOrganization();
  const {
    discard,
    reset: resetDiscard,
    status: discardStatus,
    result: discardResult,
    discardedOrganizationId,
  } = useDiscardIncompleteOrganization();

  const isReady = organizations.some(org => org.state === 'ready');
  const isInvalid = organizations.some(org => org.state === 'invalid');
  const isCreating = status === 'creating';
  const isDiscarding = discardStatus === 'discarding';

  const incompleteOrganization = organizations.find(
    (org): org is Extract<ReconstructedOrganization, {state: 'incomplete'}> =>
      org.state === 'incomplete',
  );
  // Durable creation provenance (Bug 46 follow-up): an organization degraded
  // by a leave or a remote removal reconstructs as `incomplete` with a name
  // too, so the local state alone cannot tell it from an interrupted create.
  // Resuming the wrong one creates an unrelated project in the missing slot
  // and calls the organization ready without the original slot's data or
  // members, so the offer fails CLOSED without proof that this device started
  // that create and never saw it finish.
  const hasCreationProvenance = useHasOrganizationCreationProvenance(
    incompleteOrganization?.organizationId,
  );
  const retryOrganization =
    hasCreationProvenance &&
    incompleteOrganization?.organizationName !== undefined &&
    incompleteOrganization.organizationName.length > 0
      ? {
          organizationId: incompleteOrganization.organizationId,
          organizationName: incompleteOrganization.organizationName,
        }
      : undefined;

  // Join-side recovery: when a pending invite covers one of the
  // organization's missing slots, the invite sheet completes the org —
  // fabricating the slot here would create a private project the invite
  // flow then has to route around, so the buttons stay hidden while the
  // invite is the expected completion path.
  const {data: invites} = useManyInvites();
  const {bundles} = groupPendingInvites(invites);
  const missingSlotCoveredByInvite =
    incompleteOrganization !== undefined &&
    bundles.some(
      bundle =>
        bundle.organizationId === incompleteOrganization.organizationId &&
        SLOTS.some(
          slot =>
            incompleteOrganization.slots[slot] === undefined &&
            bundle.invites[slot] !== undefined,
        ),
    );

  // Another organization being ready does not repair THIS one: in a mixed
  // state the screen is the degraded organization's only diagnosis and
  // recovery surface (reached from Home), so it stays until nothing on the
  // device is degraded. The common case — everything ready — advances.
  const hasDegradedOrganization = organizations.some(
    org => org.state !== 'ready',
  );
  const discardSucceeded = discardStatus === 'success' && !!discardResult?.ok;
  React.useEffect(() => {
    // Skip after an ok discard: the effect below routes to Success, and a
    // Home reset here would flash Home first (post-discard Home flash).
    if (discardSucceeded) return;
    if (!isReady || hasDegradedOrganization) return;
    // SPEC B (5b): with a persisted organization, the document itself decides
    // when Home opens — its derived active id must equal the projected one. A
    // pending confirmation or an in-flight preparation never satisfies it,
    // even when the reconstruction already calls the organization ready.
    if (!(!documentGuides || derivado === activeProjectId)) return;
    navigation.reset({index: 0, routes: [{name: 'Home'}]});
  }, [
    isReady,
    hasDegradedOrganization,
    discardSucceeded,
    documentGuides,
    derivado,
    activeProjectId,
    navigation,
  ]);

  // A settled discard either freed the device (`ok`) or refused to remove
  // something: then the setup is still here, the lines below say which
  // projects were kept and why, and the result stays published so those
  // lines remain on screen. A failure stays too, with its error line.
  // Neither resets the hook — the user can retry. A successful discard
  // hands the next decision to the start-over fork only when nothing on the
  // device is degraded anymore; while another organization still
  // needs repair, THIS screen is that organization's repair surface, so
  // it stays (the discarded setup itself is gone — it is filtered out of
  // the collection the check runs on).
  React.useEffect(() => {
    if (discardStatus !== 'success') return;
    if (discardResult?.ok) {
      const remainingDegraded = organizations.some(
        org =>
          org.state !== 'ready' &&
          org.organizationId !== discardedOrganizationId,
      );
      if (remainingDegraded) {
        resetDiscard();
      } else {
        navigation.reset({index: 0, routes: [{name: 'Success'}]});
        resetDiscard();
      }
    }
  }, [
    discardStatus,
    discardResult,
    discardedOrganizationId,
    organizations,
    resetDiscard,
    navigation,
  ]);

  // Say why the resume is not on offer — but not while an invite is the
  // expected completion path, where finishing was never the answer anyway.
  const cannotFinishSetup =
    incompleteOrganization !== undefined &&
    !hasCreationProvenance &&
    !missingSlotCoveredByInvite;

  const canDiscard =
    incompleteOrganization !== undefined &&
    !isCreating &&
    !isDiscarding &&
    !missingSlotCoveredByInvite;

  // The document exists: the reconstruction alone must never navigate this
  // device, and the fanout controls are hidden (SPEC B 5b).
  if (organizacaoDocument) {
    return <DocumentDrivenProvisioning organizacao={organizacaoDocument} />;
  }

  return (
    <View style={styles.container}>
      <LoadingIndicator size="large" />
      <HeaderText variant="header2" style={styles.title}>
        {t(m.settingUp)}
      </HeaderText>
      {isInvalid && (
        <BodyText style={styles.errorText}>{t(m.invalid)}</BodyText>
      )}
      {cannotFinishSetup && (
        <BodyText style={styles.errorText}>{t(m.cannotFinish)}</BodyText>
      )}
      {discardStatus === 'error' && (
        <BodyText style={styles.errorText}>{t(m.discardFailed)}</BodyText>
      )}
      {discardStatus === 'success' &&
        discardResult?.skipped.map(entry => (
          <BodyText key={entry.projectId} style={styles.errorText}>
            {t(SKIP_MESSAGES[entry.reason], {
              projectName: SLOT_PROJECT_NAMES[entry.slot],
            })}
          </BodyText>
        ))}
      {retryOrganization && !isCreating && !missingSlotCoveredByInvite && (
        <SecondaryButton
          testID="ORG.provisioning-retry-btn"
          fullSize
          text={t(m.finishSetup)}
          onPress={() => {
            start(
              retryOrganization.organizationName,
              retryOrganization.organizationId,
            );
          }}
        />
      )}
      {canDiscard && (
        <DestructiveButton
          testID="ORG.provisioning-discard-btn"
          fullSize
          text={t(m.discardSetup)}
          onPress={() => {
            if (incompleteOrganization === undefined) return;
            Alert.alert(t(m.discardConfirmTitle), t(m.discardConfirmBody), [
              {style: 'cancel', text: t(m.cancel)},
              {
                style: 'destructive',
                text: t(m.discardSetup),
                onPress: () => {
                  discard(incompleteOrganization.organizationId);
                },
              },
            ]);
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 20,
  },
  title: {
    textAlign: 'center',
  },
  bodyText: {
    textAlign: 'center',
  },
  errorText: {
    textAlign: 'center',
  },
  rows: {
    gap: 12,
    alignSelf: 'stretch',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  rowArea: {
    flexShrink: 1,
  },
  rowStatus: {
    color: DARK_GREY,
  },
  rowStatusError: {
    color: RED,
  },
});
