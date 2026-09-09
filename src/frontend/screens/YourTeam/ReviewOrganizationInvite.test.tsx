import * as React from 'react';
import {Text} from 'react-native';
import {
  NavigationContainer,
  NavigationContainerRef,
} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {render, screen, userEvent} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {ReviewOrganizationInvite} from './ReviewOrganizationInvite';
import {usePrimaryOrganization} from '../../hooks/organization/useOrganizations';
import {useInviteToOrganization} from '../../hooks/organization/useInviteToOrganization';
import type {SlotSendState} from '../../hooks/organization/useInviteToOrganization';
import type {ReconstructedOrganization} from '../../lib/organization/reconstruct';
import type {
  AppStackParamsList,
  InviteProps,
  NativeRootNavigationProps,
} from '../../sharedTypes/navigation';
import {MEMBER_ROLE_ID} from '../../sharedTypes';

jest.mock('../../hooks/organization/useOrganizations', () => ({
  usePrimaryOrganization: jest.fn(),
}));

jest.mock('../../hooks/organization/useInviteToOrganization', () => ({
  useInviteToOrganization: jest.fn(),
}));

const usePrimaryOrganizationMock = usePrimaryOrganization as jest.Mock;
const useInviteToOrganizationMock = useInviteToOrganization as jest.Mock;

const start = jest.fn();
const retryFailed = jest.fn();

const routeParams: InviteProps = {
  name: 'Tablet 1',
  deviceId: 'device-1',
  deviceType: 'mobile',
  role: MEMBER_ROLE_ID,
};

const readyOrganization: ReconstructedOrganization = {
  state: 'ready',
  organizationId: 'a'.repeat(16),
  organizationName: 'Org',
  slots: {m: 'project-m', a: 'project-a'},
};

const incompleteOrganization: ReconstructedOrganization = {
  state: 'incomplete',
  organizationId: 'b'.repeat(16),
  organizationName: 'Partial Org',
  slots: {m: 'project-m'},
};

function mockOrganization(organization: ReconstructedOrganization | undefined) {
  usePrimaryOrganizationMock.mockReturnValue(organization);
}

function mockInviteHook(
  overrides?: Partial<ReturnType<typeof useInviteToOrganization>>,
) {
  useInviteToOrganizationMock.mockReturnValue({
    progress: {monitoramento: 'idle', alertas: 'idle'},
    busy: false,
    start,
    retryFailed,
    reset: jest.fn(),
    ...overrides,
  });
}

/**
 * Controllable stand-in for `useInviteToOrganization`: the hook reads a
 * module-level snapshot, and tests advance it with `await drive(patch)` —
 * the same way the real hook progresses slot by slot (idle → sending →
 * accepted/timeout/rejected). `drive` re-renders the screen afterwards, so
 * each step lands in its own act scope.
 */
type InviteProgress = {monitoramento: SlotSendState; alertas: SlotSendState};
type InviteState = {progress: InviteProgress; busy: boolean};

const idleState: InviteState = {
  progress: {monitoramento: 'idle', alertas: 'idle'},
  busy: false,
};

let inviteSnapshot: InviteState = idleState;
let rerenderScreen: ((ui: React.ReactElement) => Promise<void>) | undefined;
let buildScreenUI: () => React.ReactElement;

function useStatefulInviteHook(initial: InviteState = idleState) {
  inviteSnapshot = initial;
  useInviteToOrganizationMock.mockImplementation(() => ({
    progress: inviteSnapshot.progress,
    busy: inviteSnapshot.busy,
    start,
    retryFailed,
    reset: jest.fn(),
  }));
}

async function drive(patch: Partial<InviteState>) {
  inviteSnapshot = {...inviteSnapshot, ...patch};
  if (!rerenderScreen) throw new Error('renderScreen() must run before drive');
  // A fresh element each time: React skips re-rendering an identical one.
  await rerenderScreen(buildScreenUI());
}

const Stack = createNativeStackNavigator<AppStackParamsList>();

const InviteAcceptedStub = ({
  route,
}: NativeRootNavigationProps<'InviteAccepted'>) => (
  <Text>
    ACCEPTED-REACHED:{route.params.isOrganization ? 'ORG' : 'PROJECT'}
  </Text>
);

const InviteDeclinedStub = ({
  route,
}: NativeRootNavigationProps<'InviteDeclined'>) => (
  <Text>
    DECLINED-REACHED:{route.params.isOrganization ? 'ORG' : 'PROJECT'}
  </Text>
);

async function renderScreen() {
  const navigationRef =
    React.createRef<NavigationContainerRef<AppStackParamsList>>();

  buildScreenUI = () => (
    <IntlProvider locale="en" messages={{}}>
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator>
          <Stack.Screen
            name="ReviewOrganizationInvite"
            component={ReviewOrganizationInvite}
            initialParams={routeParams}
          />
          <Stack.Screen name="InviteAccepted" component={InviteAcceptedStub} />
          <Stack.Screen name="InviteDeclined" component={InviteDeclinedStub} />
        </Stack.Navigator>
      </NavigationContainer>
    </IntlProvider>
  );

  const result = await render(buildScreenUI());
  rerenderScreen = ui => result.rerender(ui);

  return {navigationRef};
}

function currentRoutes(
  navigationRef: React.RefObject<NavigationContainerRef<AppStackParamsList> | null>,
) {
  return navigationRef.current?.getState().routes ?? [];
}

beforeEach(() => {
  jest.clearAllMocks();
  inviteSnapshot = idleState;
  rerenderScreen = undefined;
  mockOrganization(readyOrganization);
  mockInviteHook();
});

describe('ReviewOrganizationInvite', () => {
  test('shows the review card and sends to both organization slots', async () => {
    const user = userEvent.setup();
    await renderScreen();

    expect(screen.getByText('You are inviting:')).toBeOnTheScreen();
    expect(screen.getByText('Tablet 1')).toBeOnTheScreen();

    await user.press(screen.getByTestId('ORG.send-invite-btn'));

    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({
      slots: {m: 'project-m', a: 'project-a'},
      deviceId: 'device-1',
      roleId: MEMBER_ROLE_ID,
    });
  });

  test('fails closed when the device holds no organization', async () => {
    mockOrganization(undefined);
    await renderScreen();

    expect(screen.getByText('No Organization found')).toBeOnTheScreen();
    expect(screen.queryByTestId('ORG.send-invite-btn')).not.toBeOnTheScreen();
  });

  test('fails closed when the organization is not ready yet', async () => {
    mockOrganization(incompleteOrganization);
    await renderScreen();

    expect(screen.getByText('No Organization found')).toBeOnTheScreen();
    expect(screen.queryByTestId('ORG.send-invite-btn')).not.toBeOnTheScreen();
  });

  test('names the timed-out project and offers to invite again', async () => {
    const user = userEvent.setup();
    mockInviteHook({
      progress: {monitoramento: 'accepted', alertas: 'timeout'},
    });
    await renderScreen();

    expect(
      screen.getByText('Could not reach Tablet 1 for Alertas.'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('ORG.retry-invite-btn')).toBeOnTheScreen();

    await user.press(screen.getByTestId('ORG.retry-invite-btn'));

    expect(retryFailed).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  test('names the failed project with the generic error line', async () => {
    mockInviteHook({
      progress: {monitoramento: 'error', alertas: 'accepted'},
    });
    await renderScreen();

    expect(
      screen.getByText(
        'Something went wrong inviting Tablet 1 to Monitoramento.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('ORG.retry-invite-btn')).toBeOnTheScreen();
  });

  test('advances to the accepted screen when both slots accept', async () => {
    mockInviteHook({
      progress: {monitoramento: 'accepted', alertas: 'accepted'},
    });
    await renderScreen();

    expect(await screen.findByText('ACCEPTED-REACHED:ORG')).toBeOnTheScreen();
  });

  test('advances to the declined screen when the device rejects', async () => {
    mockInviteHook({
      progress: {monitoramento: 'rejected', alertas: 'rejected'},
    });
    await renderScreen();

    expect(await screen.findByText('DECLINED-REACHED:ORG')).toBeOnTheScreen();
  });
});

describe('ReviewOrganizationInvite journeys', () => {
  test('send → waiting → both accept → replaced by the organization accepted screen', async () => {
    const user = userEvent.setup();
    useStatefulInviteHook();
    const {navigationRef} = await renderScreen();

    await user.press(screen.getByTestId('ORG.send-invite-btn'));
    expect(start).toHaveBeenCalledWith({
      slots: {m: 'project-m', a: 'project-a'},
      deviceId: 'device-1',
      roleId: MEMBER_ROLE_ID,
    });

    await drive({
      progress: {monitoramento: 'sending', alertas: 'sending'},
      busy: true,
    });
    expect(
      screen.getByText('Waiting for Device to Accept Invite'),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('ORG.send-invite-btn')).not.toBeOnTheScreen();

    await drive({
      progress: {monitoramento: 'accepted', alertas: 'accepted'},
      busy: false,
    });

    expect(await screen.findByText('ACCEPTED-REACHED:ORG')).toBeOnTheScreen();

    // N1: replace, not push — the review route must not remain underneath.
    const routes = currentRoutes(navigationRef);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.name).toBe('InviteAccepted');
    expect(routes[0]?.params).toEqual({name: 'Tablet 1', isOrganization: true});
  });

  test('one slot times out → retry names the failed project → waiting again → replaced on accept', async () => {
    const user = userEvent.setup();
    useStatefulInviteHook();
    const {navigationRef} = await renderScreen();

    await user.press(screen.getByTestId('ORG.send-invite-btn'));
    await drive({
      progress: {monitoramento: 'accepted', alertas: 'timeout'},
      busy: false,
    });

    // Monitoramento stays accepted across the retry: only its slot names a
    // failure line.
    expect(
      screen.getByText('Could not reach Tablet 1 for Alertas.'),
    ).toBeOnTheScreen();
    expect(
      screen.queryByText('Could not reach Tablet 1 for Monitoramento.'),
    ).not.toBeOnTheScreen();

    await user.press(screen.getByTestId('ORG.retry-invite-btn'));
    expect(retryFailed).toHaveBeenCalledTimes(1);

    await drive({
      progress: {monitoramento: 'accepted', alertas: 'sending'},
      busy: true,
    });
    expect(
      screen.getByText('Waiting for Device to Accept Invite'),
    ).toBeOnTheScreen();

    await drive({
      progress: {monitoramento: 'accepted', alertas: 'accepted'},
      busy: false,
    });

    expect(await screen.findByText('ACCEPTED-REACHED:ORG')).toBeOnTheScreen();
    const routes = currentRoutes(navigationRef);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.name).toBe('InviteAccepted');
    expect(routes[0]?.params).toEqual({name: 'Tablet 1', isOrganization: true});
  });

  test('one accept one reject → replaced by the organization declined screen', async () => {
    useStatefulInviteHook();
    const {navigationRef} = await renderScreen();

    await drive({
      progress: {monitoramento: 'accepted', alertas: 'rejected'},
      busy: false,
    });

    expect(await screen.findByText('DECLINED-REACHED:ORG')).toBeOnTheScreen();
    const routes = currentRoutes(navigationRef);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.name).toBe('InviteDeclined');
    expect(routes[0]?.params).toEqual({
      ...routeParams,
      isOrganization: true,
    });
  });
});
