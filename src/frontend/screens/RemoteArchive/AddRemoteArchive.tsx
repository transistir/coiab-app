import * as React from 'react';
import {NativeNavigationComponent} from '../../sharedTypes/navigation';
import {defineMessages, useIntl} from 'react-intl';
import {StyleSheet, TouchableOpacity, View} from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import {
  COMAPEO_BLUE,
  BLUE_GREY,
  DARK_GREEN,
  RED,
  VERY_LIGHT_GREY,
} from '../../lib/styles';
import {HookFormTextInput} from '../../sharedComponents/HookFormTextInput';
import {Control, FieldErrors, useForm} from 'react-hook-form';
import {SaveButton} from '../../sharedComponents/SaveButton';
import {Bar} from 'react-native-progress';
import {ScreenContentWithDock} from '../../sharedComponents/ScreenContentWithDock';
import {Button} from '../../sharedComponents/Button';
import {useNavigationFromRoot} from '../../hooks/useNavigationWithTypes';
import {useValidarArquivoRemoto} from '../../hooks/server/useValidarArquivoRemoto';
import {LoadingIndicator} from '../../sharedComponents/LoadingIndicator';
import {HeaderText} from '../../sharedComponents/Text/HeaderText';
import {BodyText} from '../../sharedComponents/Text/BodyText';
import {useAddServerPeer} from '@comapeo/core-react';
import {useActiveProject} from '../../contexts/ActiveProjectContext';
import {useActiveProjectId} from '../../contexts/ActiveProjectIdStoreContext';
import {useOrganizations} from '../../hooks/organization/useOrganizations';
import {useAddRemoteArchiveToOrganization} from '../../hooks/organization/useAddRemoteArchiveToOrganization';
import {useOrganizationMaterializer} from '../../contexts/OrganizationMaterializerContext';
import {useCoiabOrganizationsState} from '../../contexts/CoiabOrganizationsStoreContext';
import type {ReconstructedOrganization} from '../../lib/organization/reconstruct';
import * as Sentry from '@sentry/react-native';

const m = defineMessages({
  navTitle: {
    id: '$1ProjectSettings.RemoteArchive.AddRemoteArchive.navTitle',
    defaultMessage: 'Add Remote Archive',
  },
  url: {
    id: 'ProjectSettings.RemoteArchive.AddRemoteArchive.url',
    defaultMessage: 'Url',
  },
  invalidUrl: {
    id: 'ProjectSettings.RemoteArchive.AddRemoteArchive.invalidUrl',
    defaultMessage: 'Invalid URL',
  },
  // #142: inline live feedback while the user types, mirroring the create
  // flow — the explicit search button still drives the actual add.
  checkingUrl: {
    id: '$1ProjectSettings.RemoteArchive.AddRemoteArchive.checkingUrl',
    defaultMessage: 'Checking remote archive…',
  },
  validUrl: {
    id: '$1ProjectSettings.RemoteArchive.AddRemoteArchive.validUrl',
    defaultMessage: 'Remote archive found',
  },
  // #142 P3: a network failure (offline, timeout, abort) is NOT a malformed
  // URL. It gets its own message and a retry affordance instead of "Invalid
  // URL", which would send the user hunting for a typo that isn't there.
  urlUnreachable: {
    id: '$1ProjectSettings.RemoteArchive.AddRemoteArchive.urlUnreachable',
    defaultMessage:
      'Could not reach the remote archive. Check the connection and try again.',
  },
  urlRetry: {
    id: '$1ProjectSettings.RemoteArchive.AddRemoteArchive.urlRetry',
    defaultMessage: 'Try again',
  },
  looking: {
    id: '$1ProjectSettings.RemoteArchive.AddRemoteArchive.looking',
    defaultMessage: 'Looking for Remote Archive...',
  },
  youAreAdding: {
    id: '$1ProjectSettings.RemoteArchive.AddRemoteArchive.youAreAdding',
    defaultMessage: 'You are adding:',
  },
  archiveInfo: {
    id: 'ProjectSettings.RemoteArchive.AddRemoteArchive.archiveInfo',
    defaultMessage:
      'When project participants exchange their data, they will also be archived on the internet. Your project data is syncing to the archive over the internet to the secure, encrypted server below. The server owner can view the data.',
  },
  permission: {
    id: 'ProjectSettings.RemoteArchive.AddRemoteArchive.permission',
    defaultMessage: 'Only a Project Coordinator can turn off Remote Archive.',
  },
  whatsIncluded: {
    id: 'ProjectSettings.RemoteArchive.AddRemoteArchive.whatsIncluded',
    defaultMessage: 'See What is Included',
  },
  orgHint: {
    id: '$1screens.RemoteArchive.AddRemoteArchive.orgHint',
    defaultMessage:
      'This archive will be added to both projects of the Territory.',
  },
});

type URLInput = {
  url: string;
};

export const AddRemoteArchive: NativeNavigationComponent<
  'AddRemoteArchive'
> = ({navigation}) => {
  const {
    control,
    handleSubmit,
    watch,
    formState: {errors},
  } = useForm<URLInput>();

  // #142 P2: ONE source of truth for the `/info` lookup. The live-validation
  // hook is the only thing that fetches; the header save button merely marks
  // the form as submitted and the render below reads the hook's current
  // state. The previous `useFindRemoteArchive` consulted the same endpoint a
  // second time, so pressing the header before the debounce left two requests
  // in flight.
  const [submetido, setSubmetido] = React.useState(false);
  const urlDigitada = watch('url') ?? '';
  const validacaoArquivo = useValidarArquivoRemoto(urlDigitada);

  // Editing the URL withdraws a submission: the inline feedback returns until
  // the header is pressed again. Adjusting state during render (React's
  // documented prop-change pattern) keeps that invalidation in the same
  // commit — an effect would paint one frame of the submitted surface for the
  // new URL first.
  const [urlDaSubmissao, setUrlDaSubmissao] = React.useState(urlDigitada);
  if (urlDaSubmissao !== urlDigitada) {
    setUrlDaSubmissao(urlDigitada);
    setSubmetido(false);
  }

  const marcarSubmetido = React.useCallback(() => {
    setSubmetido(true);
  }, []);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        // Once a valid archive is displayed the header has no job left; a
        // failed/absent result keeps it so the user can re-submit.
        submetido && validacaoArquivo.estado === 'valido' ? null : (
          <SaveButton
            onPress={handleSubmit(marcarSubmetido)}
            isLoading={false}
          />
        ),
    });
  }, [
    handleSubmit,
    marcarSubmetido,
    navigation,
    submetido,
    validacaoArquivo.estado,
  ]);

  if (submetido && validacaoArquivo.estado === 'verificando') {
    return <FindingRemoteArchive />;
  }

  if (submetido && validacaoArquivo.estado === 'valido') {
    return (
      <AddFoundArchive
        name={validacaoArquivo.nome ?? ''}
        url={validacaoArquivo.urlNormalizada ?? ''}
      />
    );
  }

  return (
    <SearchUrl control={control} errors={errors} validacao={validacaoArquivo} />
  );
};

type SearchUrlProp = {
  control: Control<URLInput>;
  errors: FieldErrors<URLInput>;
  validacao: ReturnType<typeof useValidarArquivoRemoto>;
};

const SearchUrl = ({control, errors, validacao}: SearchUrlProp) => {
  const {formatMessage} = useIntl();
  const navigation = useNavigationFromRoot();

  React.useLayoutEffect(() => {
    navigation.setOptions({headerShown: true});
  }, [navigation]);
  return (
    <View style={styles.container}>
      <View style={{flexDirection: 'row', marginBottom: 10}}>
        <HeaderText variant="header5">{formatMessage(m.url)}</HeaderText>
        <HeaderText variant="header5" style={{color: RED}}>
          *
        </HeaderText>
      </View>
      <HookFormTextInput
        testID={'RA.url-inp'}
        control={control}
        name="url"
        rules={{required: true, minLength: 1}}
      />
      {validacao.estado === 'verificando' && (
        <View testID="RA.url-checking" style={styles.urlFeedback}>
          <LoadingIndicator size="small" style={{flex: 0}} />
          <BodyText variant="smallMeta">
            {formatMessage(m.checkingUrl)}
          </BodyText>
        </View>
      )}
      {validacao.estado === 'valido' && (
        <View testID="RA.url-valid" style={styles.urlFeedback}>
          <MaterialIcons name="check-circle" size={16} color={DARK_GREEN} />
          <BodyText variant="smallMeta">
            {validacao.nome ?? formatMessage(m.validUrl)}
          </BodyText>
        </View>
      )}
      {(errors.url ||
        errors.root ||
        validacao.estado === 'invalido' ||
        validacao.estado === 'formato-invalido') && (
        <HeaderText variant="header6" style={{color: RED, marginTop: 10}}>
          {formatMessage(m.invalidUrl)}
        </HeaderText>
      )}
      {validacao.estado === 'indisponivel' && (
        <View style={styles.urlUnreachable}>
          <HeaderText
            variant="header6"
            testID="RA.url-unreachable"
            style={{color: RED}}>
            {formatMessage(m.urlUnreachable)}
          </HeaderText>
          <TouchableOpacity
            testID="RA.url-retry"
            accessibilityRole="button"
            onPress={validacao.tentarNovamente}>
            <HeaderText variant="header5" style={{color: COMAPEO_BLUE}}>
              {formatMessage(m.urlRetry)}
            </HeaderText>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const FindingRemoteArchive = () => {
  const {formatMessage} = useIntl();
  const navigation = useNavigationFromRoot();

  React.useLayoutEffect(() => {
    navigation.setOptions({headerShown: false});
  }, [navigation]);

  return (
    <View style={[styles.container, {marginTop: 80}]}>
      <HeaderText style={styles.title}>{formatMessage(m.looking)}</HeaderText>
      <Bar
        style={{borderWidth: 0, marginTop: 30}}
        indeterminate
        color={COMAPEO_BLUE}
        width={null}
        height={10}
      />
    </View>
  );
};

type AddFoundArchiveProps = {
  name: string;
  url: string;
};

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

const AddFoundArchive = ({name, url}: AddFoundArchiveProps) => {
  const {formatMessage} = useIntl();
  const {projectId} = useActiveProject();
  const {mutate, status} = useAddServerPeer({projectId});
  const {navigate, setOptions, addListener} = useNavigationFromRoot();

  const activeProjectId = useActiveProjectId();
  const organizations = useOrganizations();
  const organizationArchive = useAddRemoteArchiveToOrganization();
  const materializador = useOrganizationMaterializer();
  const estadoOrganizacoes = useCoiabOrganizationsState();
  // #142 fase C1: an organization with a journal entry must NOT be modified
  // through the independent manual fan-out — that could race the journal's
  // automatic application. The journal executor owns the lock.
  const [journalBusy, setJournalBusy] = React.useState(false);
  const journalBusyRef = React.useRef(false);

  // SPEC 11: when the active project belongs to a ready Organization, one
  // submission fans the archive out to both of its projects. Otherwise the
  // legacy single-project add below stays as the debug/legacy path.
  const activeOrganization = React.useMemo(() => {
    if (activeProjectId === undefined) return undefined;
    return organizations.find(
      (org): org is Extract<ReconstructedOrganization, {state: 'ready'}> =>
        org.state === 'ready' &&
        (org.slots.m === activeProjectId || org.slots.a === activeProjectId),
    );
  }, [organizations, activeProjectId]);

  const journalOrganization = React.useMemo(() => {
    if (!activeOrganization) return undefined;
    return estadoOrganizacoes.organizacoes.find(
      organizacao => organizacao.id === activeOrganization.organizationId,
    );
  }, [activeOrganization, estadoOrganizacoes.organizacoes]);

  const pending =
    status === 'pending' || organizationArchive.busy || journalBusy;

  async function handleAddRemoteArchive() {
    // #142 review P2: a second invocation while the journal pass is alive
    // must return BEFORE choosing a path. Falling through would skip the
    // journal branch and start the manual fan-out beside the live executor.
    if (journalBusyRef.current) return;
    if (activeOrganization) {
      // #142 fase C1: a journalized organization runs through the SAME
      // executor/lock. It re-reads both project ids from the journal and can
      // neither recreate a project nor race a manual fan-out.
      if (materializador && journalOrganization) {
        journalBusyRef.current = true;
        setJournalBusy(true);
        try {
          const outcome = await materializador.solicitarArquivo(
            journalOrganization.id,
            url,
          );
          if (outcome.estado === 'concluido') {
            navigate('SuccessfullyAddedArchive', {archiveName: name, url});
          } else if (
            outcome.estado === 'falha_recuperavel' ||
            outcome.estado === 'sem-arquivo' ||
            outcome.estado === 'organizacao-ausente'
          ) {
            const error = new Error(`archive-${outcome.estado}`);
            Sentry.captureException(error);
            navigate('ErrorBottomSheet', {error});
          }
          // `aplicando`/`em-andamento`/`pendente`: the journal still owns the
          // operation; the screen must not start a second manual send.
        } catch (error) {
          Sentry.captureException(error);
          navigate('ErrorBottomSheet', {error: toError(error)});
        } finally {
          journalBusyRef.current = false;
          setJournalBusy(false);
        }
        return;
      }
      // SPEC 11 / E8 fan-out: both slots via manager APIs, without switching
      // activeProjectId. A partial failure (one slot done, one error) leaves
      // the Organization half-configured and surfaces as an error; the retry
      // re-adds BOTH slots. Core does not document addServerPeer dedupe by
      // baseUrl (member-api.d.ts lists error codes only), so retry
      // idempotency rests on the E8 integration evidence, not a core
      // contract.
      const outcome = await organizationArchive.start({
        slots: activeOrganization.slots,
        baseUrl: url,
      });
      if (!outcome) return;
      if (outcome.error === undefined) {
        navigate('SuccessfullyAddedArchive', {archiveName: name, url});
      } else {
        Sentry.captureException(outcome.error);
        navigate('ErrorBottomSheet', {error: toError(outcome.error)});
      }
      return;
    }

    mutate(
      {baseUrl: url},
      {
        onSuccess: () => {
          navigate('SuccessfullyAddedArchive', {archiveName: name, url});
        },
        onError: err => {
          Sentry.captureException(err);
          navigate('ErrorBottomSheet', {error: err});
        },
      },
    );
  }

  React.useEffect(() => {
    const unsubscribe = addListener('beforeRemove', e => {
      if (!pending) {
        // If user is not actively adding server
        return;
      }

      // Prevent default behavior of leaving the screen
      e.preventDefault();
    });
    return () => {
      unsubscribe();
    };
  }, [addListener, pending]);

  React.useLayoutEffect(() => {
    setOptions({headerShown: true});
  }, [setOptions]);

  return (
    <ScreenContentWithDock
      dockContent={
        pending ? (
          <LoadingIndicator style={{marginBottom: 20}} />
        ) : (
          <Button
            fullWidth
            onPress={
              handleAddRemoteArchive
            }>{`+ ${formatMessage(m.navTitle)}`}</Button>
        )
      }>
      <HeaderText variant="header4" style={styles.title}>
        {formatMessage(m.youAreAdding)}
      </HeaderText>
      <View style={{alignSelf: 'center', marginBottom: 20}}>
        <HeaderText variant="header5">{name}</HeaderText>
        <BodyText variant="smallMeta">{url}</BodyText>
      </View>
      {activeOrganization ? (
        <BodyText
          variant="smallMeta"
          style={{marginBottom: 20, textAlign: 'center'}}>
          {formatMessage(m.orgHint)}
        </BodyText>
      ) : null}
      <View style={styles.greyBox}>
        <BodyText variant="smallMeta">{formatMessage(m.archiveInfo)}</BodyText>
        <BodyText style={{marginTop: 5}} variant="smallMeta">
          {formatMessage(m.permission)}
        </BodyText>
        <TouchableOpacity onPress={() => navigate('WhatsIncludedBottomSheet')}>
          <HeaderText
            variant="header5"
            style={{color: COMAPEO_BLUE, marginTop: 10}}>
            {formatMessage(m.whatsIncluded)}
          </HeaderText>
        </TouchableOpacity>
      </View>
    </ScreenContentWithDock>
  );
};

AddRemoteArchive.navTitle = m.navTitle;

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingTop: 40,
  },
  urlFeedback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  urlUnreachable: {
    gap: 4,
    marginTop: 10,
  },
  title: {
    marginBottom: 20,
    textAlign: 'center',
  },
  greyBox: {
    backgroundColor: VERY_LIGHT_GREY,
    padding: 20,
    borderColor: BLUE_GREY,
    borderWidth: 1,
    borderRadius: 10,
  },
});
