import * as React from 'react';
import {StyleSheet, View} from 'react-native';
import {defineMessages, useIntl} from 'react-intl';
import {NativeStackScreenProps} from '@react-navigation/native-stack';

import {HeaderText} from '../../sharedComponents/Text/HeaderText';
import {BodyText} from '../../sharedComponents/Text/BodyText';
import {LoadingIndicator} from '../../sharedComponents/LoadingIndicator';
import {PrimaryButton} from '../../sharedComponents/Buttons';
import {AppStackParamsList} from '../../sharedTypes/navigation';
import {useCoiabOrganizationsState} from '../../contexts/CoiabOrganizationsStoreContext';
import {useOrganizationActivationContext} from '../../contexts/OrganizationActivationContext';
import {useActiveProjectId} from '../../contexts/ActiveProjectIdStoreContext';
import {
  AREAS,
  derivarProjectIdAtivo,
  type EstadoOrganizacoes,
  type EtapaArea,
  type OrganizacaoLocal,
} from '../../lib/organization/coiabOrganizations';
import {DARK_GREY, RED} from '../../lib/styles';

const m = defineMessages({
  // SPEC B §4.4: organization-owned concepts get their own descriptors — the
  // document-driven preparation view, its failure recovery, its confirmation
  // and the open/recovery states.
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
  unavailableTitle: {
    id: '$1screens.OrganizationSetup.unavailableTitle',
    defaultMessage: 'Could not open your organization',
    description:
      'A settled organization the engine could not open (SPEC B §4.4:120 / SPEC A §6.2:214, “Organização indisponível”)',
  },
  retryActivationButton: {
    id: '$1screens.OrganizationSetup.retryActivationButton',
    defaultMessage: 'Try again',
    description:
      'Reactivates the settled organization after a failed open (SPEC B §4.4:120, “Tentar novamente”)',
  },
  pendingWork: {
    id: '$1screens.OrganizationSetup.pendingWork',
    defaultMessage:
      'Finish or discard the record before switching organization',
    description:
      'Blocked boot with work in progress (SPEC A §4.4:149 canonical pending-work string, CA15)',
  },
});

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
 * recoverable-failure sentences, the confirmation, or the open/recovery
 * states published by the activation engine. Every exit from this screen is
 * the engine's: a preparation retry, an acknowledged activation, or a
 * pending-work recovery; the reconstruction is never consulted here.
 */
function DocumentDrivenProvisioning({
  organizacao,
  ativa,
}: {
  organizacao: OrganizacaoLocal;
  ativa: EstadoOrganizacoes['ativa'];
}) {
  const {formatMessage: t} = useIntl();
  const {status, error, activate, retryPreparation, recoverPendingWork} =
    useOrganizationActivationContext();
  const [ativando, setAtivando] = React.useState(false);
  // Synchronous guard: the disabled prop alone lets a double tap queue a
  // second activate before the rerender publishes it.
  const ativandoRef = React.useRef(false);

  // SPEC A §4.4:149 (CA15): a blocked boot with work in progress maps to the
  // single canonical pending-work string. Reopening the work's persisted
  // origin is what concludes the work, and recoverPendingWork() is the
  // engine's only path for it — the screen asks, the engine owns it.
  const trabalhoPendente = status === 'unavailable' && error === 'pending-work';
  React.useEffect(() => {
    if (trabalhoPendente) void recoverPendingWork();
  }, [trabalhoPendente, recoverPendingWork]);

  // SPEC B §4.4:120 ("Organização indisponível"): the document is settled and
  // acknowledged, but the engine refused to open it — recovery or
  // unavailable, and not the pending-work blocked boot above, which shows
  // its own string. The preparation rows stay: the data is all there; what
  // failed is opening it.
  const indisponivel =
    organizacao.estado === 'pronta' &&
    !organizacao.confirmacaoPendente &&
    !trabalhoPendente &&
    (status === 'recovery' || status === 'unavailable');

  const abrirOrganizacao = async () => {
    if (ativandoRef.current) return;
    ativandoRef.current = true;
    setAtivando(true);
    try {
      // SPEC A §4.2 regra 9: the activation engine acknowledged and selected
      // in one write. Routing to Home is the navigator's generation rule,
      // never this screen's.
      await activate(organizacao.id, {acknowledge: true});
    } finally {
      ativandoRef.current = false;
      setAtivando(false);
    }
  };

  const tentarNovamente = async () => {
    if (ativandoRef.current || !ativa) return;
    ativandoRef.current = true;
    setAtivando(true);
    try {
      await activate(ativa.organizacaoId, {area: ativa.area});
    } finally {
      ativandoRef.current = false;
      setAtivando(false);
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
        <>
          <HeaderText variant="header2" style={styles.title}>
            {t(m.createdTitle)}
          </HeaderText>
          <BodyText style={styles.bodyText}>
            {t(m.createdBody, {organizationName: organizacao.nome})}
          </BodyText>
        </>
      )}
      {indisponivel && (
        <HeaderText variant="header2" style={styles.title}>
          {t(m.unavailableTitle)}
        </HeaderText>
      )}
      {trabalhoPendente && (
        <BodyText style={styles.bodyText}>{t(m.pendingWork)}</BodyText>
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
            void retryPreparation(organizacao.id);
          }}
        />
      )}
      {organizacao.estado === 'pronta' && organizacao.confirmacaoPendente && (
        <PrimaryButton
          testID="ORG.provisioning-open-organization-btn"
          fullSize
          text={t(m.openOrganizationButton)}
          disabled={ativando}
          onPress={() => {
            void abrirOrganizacao();
          }}
        />
      )}
      {indisponivel && (
        <PrimaryButton
          testID="ORG.provisioning-retry-activation-btn"
          fullSize
          text={t(m.retryActivationButton)}
          disabled={ativando || !ativa}
          onPress={() => {
            void tentarNovamente();
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
 * The persisted organization document (`estado.organizacoes[0]`) is the only
 * content authority: `preparando` shows the two area rows with no buttons;
 * `falha_recuperavel` offers Tentar novamente through the activation engine;
 * `pronta` with a pending confirmation offers Abrir organização and waits;
 * and a settled document the engine failed to open (`recovery` |
 * `unavailable`) says so and reactivates through the engine — blocked work
 * shows the §4.4 string and reopens its origin. Without a document the
 * startup gate routes elsewhere ('nenhum' → Success), so this surface stays
 * a bare, buttonless loader: nothing may act on a reconstruction's word.
 */
export const OrganizationProvisioning = ({
  navigation,
}: NativeStackScreenProps<AppStackParamsList, 'OrganizationProvisioning'>) => {
  const estado = useCoiabOrganizationsState();
  const organizacaoDocument = estado.organizacoes[0];
  const {status: activationStatus} = useOrganizationActivationContext();
  // The document's own operational id (SPEC A §4.2 regra 5): null while the
  // confirmation is pending or the document cannot be parsed.
  const derivado = derivarProjectIdAtivo(estado);
  const activeProjectId = useActiveProjectId();
  // SPEC B (5b): with a persisted organization document, the reconstruction
  // alone must never navigate — Home opens only through a validated
  // activation whose projected id matches the document's own derivation. The
  // generation gate's own reset races the screen-set flip at this exact
  // commit (the app screens' lazy mounts suspend the navigator away before
  // its reset is handled), so this effect is the surviving hop: it re-runs
  // after the Suspense remount and routes on the same validated condition.
  React.useEffect(() => {
    if (organizacaoDocument === undefined) return;
    if (activationStatus !== 'ready' || derivado !== activeProjectId) return;
    navigation.reset({index: 0, routes: [{name: 'Home'}]});
  }, [
    organizacaoDocument,
    activationStatus,
    derivado,
    activeProjectId,
    navigation,
  ]);

  if (organizacaoDocument === undefined) {
    return (
      <View style={styles.container}>
        <LoadingIndicator size="large" />
      </View>
    );
  }
  return (
    <DocumentDrivenProvisioning
      organizacao={organizacaoDocument}
      ativa={estado.ativa}
    />
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
