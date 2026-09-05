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
import {
  useOrganizations,
  usePrimaryOrganization,
} from '../../hooks/organization/useOrganizations';
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
  return 'Home';
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

  const primaryOrganization = usePrimaryOrganization();

  // SPEC 1.3: the Organization is the root product state, so once an
  // Organization is ready, a persisted active id that is a slot of no ready
  // organization (a standalone/debug switch) does not survive into Home —
  // getInitialRoute stays pure; this effect corrects the stored id to the
  // primary organization's Monitoramento slot instead.
  React.useEffect(() => {
    if (orgStatus !== 'ready' || !activeProjectId) return;
    const activeIsReadyOrgSlot = organizations.some(
      org =>
        org.state === 'ready' &&
        (org.slots.m === activeProjectId || org.slots.a === activeProjectId),
    );
    if (activeIsReadyOrgSlot) return;
    if (primaryOrganization?.state === 'ready') {
      setActiveProjectId(primaryOrganization.slots.m);
    }
  }, [
    organizations,
    orgStatus,
    activeProjectId,
    primaryOrganization,
    setActiveProjectId,
  ]);

  const layout: NavigatorLayout = ({children, state, navigation}) => (
    <SafeAreaView
      edges={['bottom']}
      style={{flex: 1, backgroundColor: MEDIUM_GREY}}>
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
          {/* Organization-fork screens, shared between the onboarding and app
              screen sets (the gate can land on any of them with or without an
              active project, SPEC 10.1): normal cards, registered
              unconditionally. The navigationKey remounts the group when the
              screen set flips (active project appears/disappears), so stale
              routes on these screens are pruned and the gate re-decides —
              same mechanic the shared invite-sheet group relies on. */}
          <RootStack.Group
            navigationKey={
              activeProjectId ? 'org-screens-app' : 'org-screens-onboarding'
            }
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
