import * as React from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {Platform} from 'react-native';
import {NativeStackNavigationOptions} from '@react-navigation/native-stack';
import {SafeAreaView} from 'react-native-safe-area-context';
import {WHITE, DARK_GREY, LIGHT_BLUE, MEDIUM_GREY} from '../../lib/styles';
import {CustomHeaderLeft} from '../../sharedComponents/CustomHeaderLeft';
import {AppStackParamsList} from '../../sharedTypes/navigation';
import {useAuthContext} from '../../contexts/AuthContext';
import {FullScreenCenteredLoader} from '../../sharedComponents/FullScreenCenteredLoader';
import {TelaCarregamento} from '../../sharedComponents/TelaCarregamento';
import {createOnboardingScreens} from './OnboardingScreens';
import {createAppScreens} from './AppScreens';
import {PendingInvitesListener} from '../../sharedComponents/PendingInvitesListener';
import {PendingMapSharesListener} from '../../sharedComponents/PendingMapSharesListener';
import {useOwnDeviceInfo} from '@comapeo/core-react';
import {useActiveProjectId} from '../../contexts/ActiveProjectIdStoreContext';
import {
  classificarDocumento,
  derivarProjectIdAtivo,
  type DocumentoGate,
} from '../../lib/organization/coiabOrganizations';
import type {ActivationStatus} from '../../lib/organization/activation';
import {useCoiabOrganizationsState} from '../../contexts/CoiabOrganizationsStoreContext';
import {useOrganizationActivationContext} from '../../contexts/OrganizationActivationContext';
import {
  isProfileComplete,
  useUserProfileState,
  type CoordinationRole,
} from '../../contexts/UserProfileStoreContext';
import {AuthScreen} from '../../screens/AuthScreen';
import {Success} from '../../screens/Onboarding/Success';
import {EthnicGroupSelection} from '../../screens/Onboarding/EthnicGroupSelection';
import {VillageEntry} from '../../screens/Onboarding/VillageEntry';
import {CreateOrganization} from '../../screens/Onboarding/CreateOrganization';
import {JoinOrganizationIntro} from '../../screens/Onboarding/JoinOrganizationIntro';
import {OrganizationProvisioning} from '../../screens/Onboarding/OrganizationProvisioning';
import {Organizations} from '../../screens/Organizations';
import {ActiveProjectProvider} from '../../contexts/ActiveProjectContext';
import {RootStack} from './RootStack';
import {InviteSuccessfullyAccepted} from '../../screens/Invites/InviteSuccessfullyAccepted';
import {ErrorBottomSheet} from '../../sharedComponents/ErrorBottomSheet';
import {InviteReceived} from '../../screens/Invites/InviteReceived';
import {OrganizationInviteReceived} from '../../screens/Invites/OrganizationInviteReceived';
import {InviteCanceled} from '../../screens/Invites/InviteCanceled';
import {DeepLinkListener} from './DeepLinkListener';
import {CommonActions, StackActions} from '@react-navigation/native';
import {RUBIK} from '../../lib/fonts';

export type NavigatorLayout = NonNullable<
  React.ComponentProps<typeof RootStack.Navigator>['layout']
>;
export type NavigatorScreenLayout = NonNullable<
  React.ComponentProps<typeof RootStack.Navigator>['screenLayout']
>;

// The bottom inset sits behind the home indicator (iOS) or, since the nav bar is
// transparent and edge-to-edge, the system navigation bar (Android). It should
// match the screen above it: white like the tabs, except on these screens.
const IOS_BOTTOM_INSET_COLORS: Partial<
  Record<keyof AppStackParamsList, string>
> = {
  IntroToCoMapeo: LIGHT_BLUE,
  AudioRecording: DARK_GREY,
};

function getBottomInsetColor(routeName: keyof AppStackParamsList | undefined) {
  if (Platform.OS === 'android') return MEDIUM_GREY;
  return (routeName && IOS_BOTTOM_INSET_COLORS[routeName]) ?? WHITE;
}

export const NavigatorScreenOptions: NativeStackNavigationOptions = {
  presentation: 'card',
  contentStyle: {backgroundColor: WHITE},
  headerStyle: {backgroundColor: WHITE},
  headerTitleStyle: {fontFamily: RUBIK[500]},
  headerLeft: props => <CustomHeaderLeft headerBackButtonProps={props} />,
  headerBackVisible: false,
  statusBarStyle: 'dark',
};

const m = defineMessages({
  // SPEC A §6.2 row 1 ("Registro/core carregando"): the activation of the
  // settled document holds the device on the canonical loading copy — the
  // navigator registers no route, so no project screen can mount behind it.
  loadingOrganization: {
    id: '$1screens.OrganizationSetup.loadingOrganization',
    defaultMessage: 'Loading territory…',
  },
});

/**
 * The startup gate's route table (SPEC B §3.3). The persisted document
 * decides BEFORE the activation state: while any organization is still being
 * prepared, or is ready only because its confirmation was never
 * acknowledged, nothing may be activated — the device opens on the
 * provisioning surface and waits for the "Abrir organização" tap, no matter
 * how healthy the reconstruction looks. An empty document goes through the
 * create/join fork regardless of the core's project rows (marker-only
 * organizations from spike builds are unrecognized, A :131). Only a settled
 * document ('pronta') consults the activation: Home needs a VALIDATED
 * activation ('ready'); every other published status — recovery,
 * unavailable, selection, and anything unexpected — fails closed onto the
 * provisioning surface. 'loading' | 'opening' are not routes: the
 * RootStackNavigator renders the loader and never calls this while they
 * hold, so the fall-through only guards a direct caller against reaching
 * Home on an unvalidated activation.
 *
 * `profileComplete` (#128) gates ONLY the empty document: a device with no
 * organizations still has one step of onboarding left after the device name,
 * so an incomplete profile opens the ethnic-group flow instead of the
 * create/join fork. `coordinationRole` (#129) then splits that fork: a
 * coordinator opens the creation form, a participant the invitation intro,
 * and an unanswered role the question on Success. Every other branch —
 * pending documents, a settled document's activation, and the
 * auth/device-name guards — is unaffected by the profile.
 */
type LayoutProps = Parameters<NavigatorLayout>[0];

// Android's bottom inset sits behind the system navigation bar, where grey is a
// deliberate visual choice. iOS's is the home activity indicator, which should
// match the screen above it: white like the tabs, except on these screens.
function openSheetAction(
  {state, descriptors}: Pick<LayoutProps, 'state' | 'descriptors'>,
  name: 'InviteReceived' | 'MapReceivedBottomSheet',
  params: {inviteId: string} | {shareId: string},
) {
  const currentRoute = state.routes[state.index];
  const presentation = currentRoute
    ? descriptors[currentRoute.key]?.options.presentation
    : undefined;

  return presentation && presentation !== 'card'
    ? StackActions.replace(name, params)
    : CommonActions.navigate(name, params);
}

export function getInitialRoute(
  authState: 'authenticated' | 'unauthenticated' | 'obscured',
  deviceName: string | undefined,
  documento: DocumentoGate,
  ativacao: ActivationStatus,
  profileComplete: boolean,
  coordinationRole: CoordinationRole,
): keyof AppStackParamsList {
  if (authState === 'unauthenticated') {
    return 'AuthScreen';
  }
  if (!deviceName) {
    return 'IntroToCoMapeo';
  }
  if (documento === 'preparando' || documento === 'confirmacao') {
    return 'OrganizationProvisioning';
  }
  if (documento === 'nenhum') {
    if (!profileComplete) return 'EthnicGroupSelection';
    if (coordinationRole === 'coordinator') return 'CreateOrganization';
    if (coordinationRole === 'participant') return 'JoinOrganizationIntro';
    return 'Success';
  }
  if (ativacao === 'ready') {
    return 'Home';
  }
  return 'OrganizationProvisioning';
}

/**
 * SPEC A §6.2 at runtime: `initialRouteName` is read once, when the
 * navigator mounts, and React Navigation ignores later changes to it — the
 * loader window owns the cold start, so the navigator mounts only once the
 * settled document's activation has published a terminal status. Every
 * activation that publishes AFTER that mount is routed by this gate:
 * - a NEW `generation` with status `ready` (a fresh activation that
 *   revalidated both areas — the "Abrir organização" tap, a drawer area
 *   switch, a recovery reactivation) opens the destination `Home/Map` once,
 *   wherever the user happened to be;
 * - status `recovery` or `unavailable` (the open organization lost access
 *   mid-flight, or the boot is blocked) fails closed onto the provisioning
 *   surface, exactly as the cold-start gate would have routed it. The rule
 *   is checked on EVERY navigator state change, not only on the
 *   publication: a concurrent commit that restores content routes after a
 *   reset — the revert that races the leave flow — is pruned again by the
 *   same rule instead of being left on screen.
 * A ready republished with the SAME generation (a blocked switch rolling
 * back to the validated snapshot) is no transition: the previous
 * organization and area stand (SPEC A §6.2 row "Troca bloqueada").
 * Publications observed while the device cannot route (no device name,
 * unauthenticated) are not consumed: the ref keeps the last generation
 * seen while enabled, so the routing fires when the gate is enabled again.
 * The rule reads ONLY the activation status and the route names (A §7:234)
 * — never the derived id, the legacy active id or a project list.
 */
const ROTAS_SEM_PROJETO: Record<string, true> = {
  // The stable entry/recovery group registered below (the startup gate's
  // route table plus the organization fork).
  Success: true,
  // The onboarding profile screens (#128) hold no project context either;
  // they sit in the same stable group as Success (see the registration).
  EthnicGroupSelection: true,
  VillageEntry: true,
  CreateOrganization: true,
  JoinOrganizationIntro: true,
  OrganizationProvisioning: true,
  // SPEC A §7/:157: recovery must keep the selector reachable — an
  // organization that cannot reopen cannot trap the user without a way to
  // choose another one.
  Organizations: true,
  // The shared modals, which need no project context.
  ErrorBottomSheet: true,
  InviteReceived: true,
  OrganizationInviteReceived: true,
  InviteSuccessfullyAccepted: true,
  InviteCanceled: true,
  // Review fronteira P2-3: the removal explanation reads the removed slot
  // from its route params, and it must survive the recovery its own
  // detection triggers.
  RemovedFromProjectBottomSheet: true,
};

export function GenerationTransitionGate({
  state,
  navigation,
  status,
  generation,
  enabled,
}: Pick<Parameters<NavigatorLayout>[0], 'state' | 'navigation'> & {
  status: ActivationStatus;
  generation: number;
  enabled: boolean;
}) {
  const previousGeneration = React.useRef(generation);
  React.useEffect(() => {
    if (!enabled) return;
    const prevGeneration = previousGeneration.current;
    previousGeneration.current = generation;
    if (status === 'ready') {
      // A new generation means a fresh activation: the validated
      // destination is Home/Map, wherever the user happened to be.
      if (
        generation !== prevGeneration &&
        state.routes[state.index]?.name !== 'Home'
      )
        navigation.reset({
          index: 0,
          routes: [{name: 'Home', params: {screen: 'Map'}}],
        });
      return;
    }
    // The organization context is not openable (`recovery` | `unavailable`):
    // no route outside the projectless set may stay on the stack.
    if (
      (status === 'recovery' || status === 'unavailable') &&
      state.routes.some(route => ROTAS_SEM_PROJETO[route.name] !== true)
    )
      navigation.reset({
        index: 0,
        routes: [{name: 'OrganizationProvisioning'}],
      });
  }, [enabled, status, generation, state, navigation]);
  return null;
}

export const RootStackNavigator = () => {
  const security = useAuthContext();
  const {data: deviceInfo} = useOwnDeviceInfo();
  const activeProjectId = useActiveProjectId();
  const {formatMessage} = useIntl();
  // The persisted document is the ONLY startup authority (SPEC B §3.3): the
  // reconstruction no longer routes — marker-only project rows say nothing
  // about what this device may open.
  const estadoOrganizacoes = useCoiabOrganizationsState();
  // SPEC A §4.2 rule 5: the operational project is DERIVED from the active
  // selection — the screen set is the document's word, never the legacy
  // persisted active id.
  const derivado = derivarProjectIdAtivo(estadoOrganizacoes);
  // Review fronteira P1: an un-settled SECOND organization never takes the
  // cold start away from an operable selection. With A ready, acknowledged
  // and selected, the boot routes A's activation exactly as a settled
  // document would (loader, then Home), while B resumes in the background
  // and stays reachable through the selector and the creation guard —
  // otherwise the landing screen depended on whether A published before or
  // after the navigator mounted.
  const documento =
    derivado !== null ? 'pronta' : classificarDocumento(estadoOrganizacoes);
  // SPEC A §5.3:168/§4.2: the content history is keyed by the organization
  // + area selection, so switching either one starts a fresh content root.
  const contextKey = estadoOrganizacoes.ativa
    ? `${estadoOrganizacoes.ativa.organizacaoId}:${estadoOrganizacoes.ativa.area}`
    : 'none';
  // The engine's published selection (SPEC A §5.2): status, generation and
  // the operational project id the provider projects into the active store.
  const {status: ativacao, generation} = useOrganizationActivationContext();
  // #128: the local onboarding profile decides only the empty-document
  // branch of the startup gate (see `getInitialRoute`).
  const profileState = useUserProfileState();
  const profileComplete = isProfileComplete(profileState);
  const isNotReadyForInvite =
    security.authState !== 'authenticated' ||
    !deviceInfo.name ||
    !activeProjectId;

  // SPEC A §6.2 row 1: while the activation of the settled document is in
  // flight at cold start (the engine has never published a validated context
  // this session — generation 0), the navigator is replaced by the loader:
  // no route is registered, so no project screen — not even the org fork —
  // can flash behind the gate. Runtime activations (generation > 0) never
  // take the navigator away: a blocked switch must keep the previous
  // organization and area on screen.
  const aguardandoAbertura =
    security.authState !== 'unauthenticated' &&
    !!deviceInfo.name &&
    documento === 'pronta' &&
    generation === 0 &&
    (ativacao === 'loading' || ativacao === 'opening');

  const layout: NavigatorLayout = ({
    children,
    state,
    navigation,
    descriptors,
  }) => (
    <SafeAreaView
      edges={{bottom: 'maximum'}}
      style={{
        flex: 1,
        paddingBottom: 20,
        backgroundColor: getBottomInsetColor(state.routes[state.index]?.name),
      }}>
      <GenerationTransitionGate
        state={state}
        navigation={navigation}
        status={ativacao}
        generation={generation}
        enabled={security.authState === 'authenticated' && !!deviceInfo.name}
      />
      <React.Suspense fallback={<FullScreenCenteredLoader />}>
        <PendingInvitesListener
          currentRouteName={state.routes[state.index]?.name}
          navigateToInviteScreen={inviteId =>
            navigation.dispatch(
              openSheetAction({state, descriptors}, 'InviteReceived', {
                inviteId,
              }),
            )
          }
          navigateToOrgInviteScreen={(organizationId, inviteId) =>
            navigation.navigate('OrganizationInviteReceived', {
              organizationId,
              inviteId,
            })
          }
        />
        <PendingMapSharesListener
          currentRouteName={state.routes[state.index]?.name}
          navigateToMapShareScreen={shareId =>
            navigation.dispatch(
              openSheetAction({state, descriptors}, 'MapReceivedBottomSheet', {
                shareId,
              }),
            )
          }
        />
        {!isNotReadyForInvite && (
          <DeepLinkListener currentRouteName={state.routes[state.index]?.name} />
        )}
        {/* Wrap here so app screens get ActiveProjectProvider without a separate navigator.
            The operational id falls back to the document's own derivation
            (SPEC A §4.2 rule 5): when the legacy projection is momentarily
            absent (a leave cleared it while the document still says the
            organization is open), the derivation keeps the provider mounted
            so no registered app screen renders without a project context. */}
        {(activeProjectId ?? derivado) ? (
          <ActiveProjectProvider activeProjectId={activeProjectId ?? derivado!}>
            {children}
          </ActiveProjectProvider>
        ) : (
          children
        )}
      </React.Suspense>
    </SafeAreaView>
  );

  const screenLayout: NavigatorScreenLayout = ({children}) => (
    <React.Suspense fallback={<FullScreenCenteredLoader />}>
      {children}
    </React.Suspense>
  );

  const commonNavigatorProps = {
    layout,
    screenLayout,
    screenOptions: NavigatorScreenOptions,
  } as const;

  const initialRouteName = getInitialRoute(
    security.authState,
    deviceInfo.name,
    documento,
    ativacao,
    profileComplete,
    profileState.coordinationRole,
  );

  if (aguardandoAbertura) {
    return <TelaCarregamento label={formatMessage(m.loadingOrganization)} />;
  }

  return (
    <RootStack.Navigator
      {...commonNavigatorProps}
      initialRouteName={initialRouteName}>
      {security.authState === 'unauthenticated' ? (
        <RootStack.Screen
          name="AuthScreen"
          component={AuthScreen}
          options={{
            headerShown: false,
            animation: 'fade',
          }}
        />
      ) : (
        <>
          {derivado === null
            ? createOnboardingScreens({intl: formatMessage})
            : createAppScreens({intl: formatMessage, contextKey})}
          {/* Keep fork/creation routes stable through the active-ID handoff.
              Pruning them makes StackRouter fall back to its original initial
              route (Success); it does not recompute the startup gate. */}
          <RootStack.Group
            screenOptions={{
              presentation: 'card',
              headerShown: false,
            }}>
            <RootStack.Screen
              name="EthnicGroupSelection"
              component={EthnicGroupSelection}
              options={{headerShown: false}}
            />
            <RootStack.Screen
              name="VillageEntry"
              component={VillageEntry}
              options={{headerShown: false}}
            />
            <RootStack.Screen name="Success" component={Success} />
            <RootStack.Screen
              name="CreateOrganization"
              component={CreateOrganization}
            />
            <RootStack.Screen
              name="JoinOrganizationIntro"
              component={JoinOrganizationIntro}
            />
            <RootStack.Screen
              name="OrganizationProvisioning"
              component={OrganizationProvisioning}
            />
          </RootStack.Group>
          {/* Shared screen */}
          <RootStack.Group
            navigationKey={contextKey}
            screenOptions={{
              presentation: 'transparentModal',
              headerShown: false,
              animation: 'none',
              contentStyle: {backgroundColor: 'transparent'},
            }}>
            <RootStack.Screen
              name="Organizations"
              component={Organizations}
              options={{headerShown: false}}
            />
            <RootStack.Screen
              name="ErrorBottomSheet"
              component={ErrorBottomSheet}
            />
            <RootStack.Screen
              name="InviteReceived"
              component={InviteReceived}
            />
            <RootStack.Screen
              name="OrganizationInviteReceived"
              component={OrganizationInviteReceived}
            />
            <RootStack.Screen
              name="InviteSuccessfullyAccepted"
              component={InviteSuccessfullyAccepted}
            />
            <RootStack.Screen
              name="InviteCanceled"
              component={InviteCanceled}
            />
          </RootStack.Group>
        </>
      )}
    </RootStack.Navigator>
  );
};
