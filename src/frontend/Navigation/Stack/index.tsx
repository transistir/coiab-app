import * as React from 'react';
import {NativeStackNavigationOptions} from '@react-navigation/native-stack';
import {SafeAreaView} from 'react-native-safe-area-context';
import {WHITE, MEDIUM_GREY} from '../../lib/styles';
import {CustomHeaderLeft} from '../../sharedComponents/CustomHeaderLeft';
import {AppStackParamsList} from '../../sharedTypes/navigation';
import {useAuthContext} from '../../contexts/AuthContext';
import {FullScreenCenteredLoader} from '../../sharedComponents/FullScreenCenteredLoader';
import {createOnboardingScreens} from './OnboardingScreens';
import {createAppScreens} from './AppScreens';
import {PendingInvitesListener} from '../../sharedComponents/PendingInvitesListener';
import {PendingMapSharesListener} from '../../sharedComponents/PendingMapSharesListener';
import {useOwnDeviceInfo} from '@comapeo/core-react';
import {
  useActiveProjectId,
  useActiveProjectIdActions,
} from '../../contexts/ActiveProjectIdStoreContext';
import {useOrganizations} from '../../hooks/organization/useOrganizations';
import type {ReconstructedOrganization} from '../../lib/organization/reconstruct';
import {AuthScreen} from '../../screens/AuthScreen';
import {Success} from '../../screens/Onboarding/Success';
import {CreateOrganization} from '../../screens/Onboarding/CreateOrganization';
import {JoinOrganizationIntro} from '../../screens/Onboarding/JoinOrganizationIntro';
import {OrganizationProvisioning} from '../../screens/Onboarding/OrganizationProvisioning';
import {ActiveProjectProvider} from '../../contexts/ActiveProjectContext';
import {useIntl} from 'react-intl';
import {RootStack} from './RootStack';
import {InviteSuccessfullyAccepted} from '../../screens/Invites/InviteSuccessfullyAccepted';
import {ErrorBottomSheet} from '../../sharedComponents/ErrorBottomSheet';
import {InviteReceived} from '../../screens/Invites/InviteReceived';
import {OrganizationInviteReceived} from '../../screens/Invites/OrganizationInviteReceived';
import {InviteCanceled} from '../../screens/Invites/InviteCanceled';
import {DeepLinkListener} from './DeepLinkListener';
import {useOrganizationCreationCompletion} from '../../hooks/organization/useOrganizationCreationCompletion';

export type NavigatorLayout = NonNullable<
  React.ComponentProps<typeof RootStack.Navigator>['layout']
>;
export type NavigatorScreenLayout = NonNullable<
  React.ComponentProps<typeof RootStack.Navigator>['screenLayout']
>;

export const NavigatorScreenOptions: NativeStackNavigationOptions = {
  presentation: 'card',
  contentStyle: {backgroundColor: WHITE},
  headerStyle: {backgroundColor: WHITE},
  headerTitleStyle: {fontFamily: 'Rubik_500Medium'},
  headerLeft: props => <CustomHeaderLeft headerBackButtonProps={props} />,
  headerBackVisible: false,
  statusBarStyle: 'dark',
};

/**
 * Organization state as seen by the startup gate (SPEC 10.1): `none` when
 * the device holds no Organization at all, `provisioning` while one exists
 * but is not `ready` yet (incomplete or invalid — fail-closed), `ready`
 * once any Organization is usable.
 */
export type OrgGateStatus = 'none' | 'ready' | 'provisioning';

export function getInitialRoute(
  authState: 'authenticated' | 'unauthenticated' | 'obscured',
  deviceName: string | undefined,
  projectId: string | undefined,
  orgStatus: OrgGateStatus,
  /**
   * F1: the ACTIVE project is a slot of an organization that degraded while
   * another one is ready (resolveActiveProjectCorrection → 'degraded'). The
   * device must not land on Home operating the other organization.
   */
  activeProjectDegraded: boolean = false,
): keyof AppStackParamsList {
  if (authState === 'unauthenticated') {
    return 'AuthScreen';
  }
  if (!deviceName) {
    return 'IntroToCoMapeo';
  }
  if (orgStatus === 'provisioning') {
    return 'OrganizationProvisioning';
  }
  if (orgStatus === 'none') {
    // A device may hold non-marker projects (e.g. a legacy invite accept),
    // which still leaves it without an Organization — it goes through the
    // org fork regardless of any active project id.
    return 'Success';
  }
  if (activeProjectDegraded) {
    return 'OrganizationProvisioning';
  }
  return 'Home';
}

/**
 * What the active-id correction (SPEC 1.3) must do with the persisted
 * active project id once an Organization is ready:
 * - 'none': the id is a slot of a ready organization — nothing to correct.
 * - 'correct': the id is a slot of NO organization (a standalone/debug
 *   switch, or the pre-org era's persisted id) — the documented legacy
 *   case; the caller silently repoints it at the first ready
 *   organization's Monitoramento slot, exactly as before.
 * - 'degraded': the id IS a slot of an organization, but that organization
 *   is not ready (incomplete or invalid) while another one is — the
 *   active organization degraded. NEVER silently switch to the other
 *   organization: the caller routes to the recovery surface
 *   (OrganizationProvisioning) instead, reusing the gate's mechanism.
 */
export type ActiveProjectCorrection =
  {kind: 'none'} | {kind: 'correct'; projectId: string} | {kind: 'degraded'};

export function resolveActiveProjectCorrection(
  organizations: ReconstructedOrganization[],
  activeProjectId: string | undefined,
): ActiveProjectCorrection {
  const readyOrganization = organizations.find(org => org.state === 'ready');
  // Without a ready organization there is nothing to correct TO (the
  // caller only runs this once `orgStatus === 'ready'`).
  if (!readyOrganization) return {kind: 'none'};
  const isSlotOf = (org: ReconstructedOrganization) =>
    activeProjectId !== undefined &&
    (org.slots.m === activeProjectId || org.slots.a === activeProjectId);
  if (organizations.some(org => org.state === 'ready' && isSlotOf(org))) {
    return {kind: 'none'};
  }
  // A slot of a NON-ready organization (incomplete or invalid): the
  // active organization degraded while another is ready.
  if (organizations.some(isSlotOf)) return {kind: 'degraded'};
  // Rootless id (or no id at all): never was an organization slot origin.
  return {kind: 'correct', projectId: readyOrganization.slots.m};
}

// Lives outside ActiveProjectProvider: adding or changing the active project
// can remount the creation screen and lose its local success effect.
function OrganizationCompletion({
  state,
  navigation,
  ready,
  activeProjectId,
}: Pick<Parameters<NavigatorLayout>[0], 'state' | 'navigation'> & {
  ready: boolean;
  activeProjectId: string | undefined;
}) {
  const isOnboarding = state.routes.some(route => route.name === 'Success');
  const hasHome = state.routeNames.includes('Home');
  const isCreating = state.routes.some(
    route => route.name === 'CreateOrganization',
  );
  const {projectId: completedProjectId, store} =
    useOrganizationCreationCompletion();
  const creationComplete =
    completedProjectId !== undefined && completedProjectId === activeProjectId;
  // An existing ready organization must never dismiss a newly opened form.
  const shouldComplete = isCreating ? creationComplete : isOnboarding;
  React.useEffect(() => {
    // A screen-local completion (e.g. provisioning) may already have reset
    // the stack. Consume its handoff too, so a later form stays open.
    if (!isCreating && completedProjectId !== undefined) {
      store.setState({projectId: undefined});
    }
    if (!ready || !hasHome || !shouldComplete) return;
    // The layout effect runs before the navigator commits its changed screen
    // set. Dispatch after that commit so Home is registered by the router.
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      navigation.reset({index: 0, routes: [{name: 'Home'}]});
      store.setState({projectId: undefined});
    });
    return () => {
      cancelled = true;
    };
  }, [
    ready,
    hasHome,
    shouldComplete,
    navigation,
    store,
    isCreating,
    completedProjectId,
  ]);
  return null;
}

/**
 * SPEC 10.1 at runtime: `initialRouteName` is read once, when the navigator
 * mounts, and React Navigation ignores later changes to it — so an
 * Organization that degrades WHILE the app runs (a leave, a removal by
 * another device) would leave the user on Home operating a broken
 * organization. When the last ready organization goes away, the stack resets
 * to the fail-closed surface the startup gate would have picked. A MIXED
 * state (something else still ready) keeps Home: there the degraded
 * organization is reached through its repair entry instead.
 *
 * The same reset also carries the F1 cross-org degradation at RUNTIME: when
 * the ACTIVE project belongs to an organization that degrades while another
 * one is ready (resolveActiveProjectCorrection → 'degraded'), the active id
 * must NOT be silently rewritten to the ready organization's slot — the user
 * is routed to OrganizationProvisioning so the recovery UX renders instead.
 * A device that already boots degraded is handled declaratively by
 * getInitialRoute, not here: an imperative reset dispatched from this layout
 * effect on the navigator's FIRST commit is dropped or undone by the router
 * (the same commit-ordering hazard OrganizationCompletion documents above),
 * so the startup gate owns the cold start and this effect owns transitions.
 */
export function OrganizationDegradationGate({
  state,
  navigation,
  enabled,
  orgStatus,
  activeProjectDegraded = false,
}: Pick<Parameters<NavigatorLayout>[0], 'state' | 'navigation'> & {
  enabled: boolean;
  orgStatus: OrgGateStatus;
  /** resolveActiveProjectCorrection(...) === 'degraded' for the active id. */
  activeProjectDegraded?: boolean;
}) {
  const previousOrgStatus = React.useRef(orgStatus);
  // Starts false, not at the prop value: a device that MOUNTS already in
  // the degraded state (the degradation happened before the navigator
  // mounted, cold start into the mixed state) must route once too.
  const previousDegraded = React.useRef(false);
  React.useEffect(() => {
    // F2 (senior P1-1): while disabled the transition is NOT consumed —
    // the ref keeps the last value seen while ENABLED, so a
    // ready→provisioning transition observed during the disabled window
    // re-fires when enabled returns instead of being lost.
    if (!enabled) return;
    const previous = previousOrgStatus.current;
    previousOrgStatus.current = orgStatus;
    if (previous !== 'ready' || orgStatus !== 'provisioning') return;
    if (state.routes[state.index]?.name === 'OrganizationProvisioning') return;
    navigation.reset({index: 0, routes: [{name: 'OrganizationProvisioning'}]});
  }, [enabled, orgStatus, state, navigation]);
  React.useEffect(() => {
    // Same preservation rule as above for the degraded-active signal.
    if (!enabled) return;
    const previous = previousDegraded.current;
    previousDegraded.current = activeProjectDegraded;
    // Edge-triggered: the routing fires when the signal first becomes
    // true, not on every render while the state persists.
    if (previous || !activeProjectDegraded) return;
    if (state.routes[state.index]?.name === 'OrganizationProvisioning') return;
    navigation.reset({index: 0, routes: [{name: 'OrganizationProvisioning'}]});
  }, [enabled, activeProjectDegraded, state, navigation]);
  return null;
}

export const RootStackNavigator = () => {
  const security = useAuthContext();
  const {data: deviceInfo} = useOwnDeviceInfo();
  const activeProjectId = useActiveProjectId();
  const {setActiveProjectId} = useActiveProjectIdActions();
  const {formatMessage} = useIntl();
  // Suspends alongside useOwnDeviceInfo on the navigator's existing
  // Suspense boundary (see PLAN-46 risks: pinned, do not deviate).
  const organizations = useOrganizations();
  const orgStatus: OrgGateStatus = organizations.some(
    org => org.state === 'ready',
  )
    ? 'ready'
    : organizations.length > 0
      ? 'provisioning'
      : 'none';
  const isNotReadyForInvite =
    security.authState !== 'authenticated' ||
    !deviceInfo.name ||
    !activeProjectId;

  // SPEC 1.3 + F1 (review round 2): the Organization is the root product
  // state, so once an Organization is ready, a persisted active id that is
  // a slot of no ready organization does not survive into Home. The
  // correction is decided by resolveActiveProjectCorrection:
  // - ROOTLESS ids (a standalone/debug switch, the pre-org era) are still
  //   silently corrected to the first ready organization's Monitoramento
  //   slot — getInitialRoute stays pure.
  // - A DEGRADED active organization (its slot is no longer a ready slot
  //   while another organization is ready) is never silently switched —
  //   that rewrite would hand the user another organization's data with
  //   no notice. Instead the recovery UX is routed to: getInitialRoute
  //   opens on OrganizationProvisioning when the device already boots
  //   degraded, and OrganizationDegradationGate resets there when the
  //   degradation happens while the app runs.
  // Storybook builds seed the Storybook Project and resolve its preset/doc
  // ids for the flow screens; rewriting the active id to an organization
  // slot here makes those seeded ids unreadable (fields not found -> guard
  // goBack, observation 404). The QA captures must see the seeded project.
  const activeProjectCorrection =
    process.env.EXPO_PUBLIC_STORYBOOK_ENABLED !== 'true' &&
    orgStatus === 'ready'
      ? resolveActiveProjectCorrection(organizations, activeProjectId)
      : ({kind: 'none'} as const);
  const activeProjectDegraded = activeProjectCorrection.kind === 'degraded';
  React.useEffect(() => {
    if (activeProjectCorrection.kind !== 'correct') return;
    setActiveProjectId(activeProjectCorrection.projectId);
  }, [activeProjectCorrection, setActiveProjectId]);

  const layout: NavigatorLayout = ({children, state, navigation}) => (
    <SafeAreaView
      edges={['bottom']}
      style={{flex: 1, backgroundColor: MEDIUM_GREY}}>
      <OrganizationCompletion
        state={state}
        activeProjectId={activeProjectId}
        navigation={navigation}
        ready={
          !!deviceInfo.name &&
          organizations.some(
            org =>
              org.state === 'ready' &&
              (org.slots.m === activeProjectId ||
                org.slots.a === activeProjectId),
          )
        }
      />
      <OrganizationDegradationGate
        state={state}
        navigation={navigation}
        orgStatus={orgStatus}
        activeProjectDegraded={activeProjectDegraded}
        enabled={security.authState === 'authenticated' && !!deviceInfo.name}
      />
      <React.Suspense fallback={<FullScreenCenteredLoader />}>
        <PendingInvitesListener
          currentRouteName={state.routes[state.index]?.name}
          navigateToInviteScreen={inviteId =>
            navigation.navigate('InviteReceived', {inviteId})
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
            navigation.navigate('MapReceivedBottomSheet', {shareId})
          }
        />
        {!isNotReadyForInvite && (
          <DeepLinkListener
            currentRouteName={state.routes[state.index]?.name}
          />
        )}
        {/* Wrap here so app screens get ActiveProjectProvider without a separate navigator.
            activeProjectId is always set before any app screen renders. */}
        {activeProjectId ? (
          <ActiveProjectProvider activeProjectId={activeProjectId}>
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
    activeProjectId,
    orgStatus,
    activeProjectDegraded,
  );

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
          {!deviceInfo.name || !activeProjectId
            ? createOnboardingScreens({intl: formatMessage})
            : createAppScreens({intl: formatMessage})}
          {/* Keep fork/creation routes stable through the active-ID handoff.
              Pruning them makes StackRouter fall back to its original initial
              route (Success); it does not recompute the startup gate.
              OrganizationCompletion consumes the creation handoff for both
              entry paths once the refreshed organization and active slot agree. */}
          <RootStack.Group
            screenOptions={{
              presentation: 'card',
              headerShown: false,
            }}>
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
            navigationKey={activeProjectId}
            screenOptions={{
              presentation: 'transparentModal',
              headerShown: false,
              animation: 'none',
              contentStyle: {backgroundColor: 'transparent'},
            }}>
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
