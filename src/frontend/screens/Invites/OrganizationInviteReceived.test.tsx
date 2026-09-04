import * as React from 'react';
import {Text} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {render, screen, userEvent} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';
import {useManyInvites, useRejectInvite} from '@comapeo/core-react';

import {OrganizationInviteReceived} from './OrganizationInviteReceived';
import {useAcceptOrganizationBundle} from '../../hooks/organization/useAcceptOrganizationBundle';
import {useTracking} from '../../hooks/useTracking';
import {markerFor} from '../../lib/organization/marker';
import type {InviteLike} from '../../lib/organization/bundle';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

jest.mock('@comapeo/core-react', () => ({
  useManyInvites: jest.fn(),
  useRejectInvite: jest.fn(),
}));

jest.mock('../../hooks/organization/useAcceptOrganizationBundle', () => ({
  useAcceptOrganizationBundle: jest.fn(),
}));

jest.mock('../../hooks/useTracking', () => ({
  useTracking: jest.fn(),
}));

const useManyInvitesMock = useManyInvites as jest.Mock;
const useRejectInviteMock = useRejectInvite as jest.Mock;
const useAcceptOrganizationBundleMock =
  useAcceptOrganizationBundle as jest.Mock;
const useTrackingMock = useTracking as jest.Mock;

const ORG_ID = 'a1b2c3d4e5f60718';
const ORG_NAME = 'Org Um';

const start = jest.fn();
const mutateAsync = jest.fn();

function makeInvite(
  slot: 'm' | 'a',
  overrides?: Partial<InviteLike>,
): InviteLike {
  return {
    inviteId: `invite-${slot}`,
    projectDescription: markerFor(ORG_ID, slot, ORG_NAME),
    invitorDeviceId: 'invitor-1',
    roleName: 'Coordinator',
    receivedAt: slot === 'm' ? 1 : 2,
    state: 'pending',
    ...overrides,
  };
}

function mockInvites(invites: InviteLike[]) {
  useManyInvitesMock.mockReturnValue({data: invites});
}

function mockAcceptBundle(
  overrides?: Partial<ReturnType<typeof useAcceptOrganizationBundle>>,
) {
  useAcceptOrganizationBundleMock.mockReturnValue({
    start,
    reset: jest.fn(),
    status: 'idle',
    error: undefined,
    ...overrides,
  });
}

function mockRejectInvite() {
  useRejectInviteMock.mockReturnValue({
    mutateAsync,
    reset: jest.fn(),
    status: 'idle',
    error: undefined,
  });
}

const Stack = createNativeStackNavigator<AppStackParamsList>();

const HomeStub = () => <Text>HOME-REACHED</Text>;
const TrackStub = () => <Text>TRACK-ACTIVE</Text>;
const AcceptedStub = ({
  route,
}: {
  route: {params: {projectName: string; projectId: string}};
}) => <Text>JOINED-{route.params.projectName}</Text>;
const ErrorStub = ({route}: {route: {params: {error: Error}}}) => (
  <Text>ERROR-{route.params.error.message}</Text>
);

async function renderScreen({
  organizationId = ORG_ID,
  inviteId = 'invite-m',
}: {
  organizationId?: string;
  inviteId?: string;
} = {}) {
  return render(
    <IntlProvider locale="en" messages={{}}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="OrganizationInviteReceived"
            component={OrganizationInviteReceived}
            initialParams={{organizationId, inviteId}}
            options={{headerShown: false}}
          />
          <Stack.Screen name="Home" component={HomeStub} />
          <Stack.Screen
            name="InviteSuccessfullyAccepted"
            component={AcceptedStub}
          />
          <Stack.Screen name="TrackRecordingActive" component={TrackStub} />
          <Stack.Screen name="ErrorBottomSheet" component={ErrorStub} />
        </Stack.Navigator>
      </NavigationContainer>
    </IntlProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAcceptBundle();
  mockRejectInvite();
  mutateAsync.mockResolvedValue(undefined);
  useTrackingMock.mockReturnValue({isTracking: false});
});

describe('OrganizationInviteReceived', () => {
  test('a complete bundle shows the organization name and both actions', async () => {
    mockInvites([makeInvite('m'), makeInvite('a')]);
    await renderScreen();

    expect(screen.getByText(ORG_NAME)).toBeOnTheScreen();
    expect(screen.getByText('Join as a coordinator?')).toBeOnTheScreen();
    expect(screen.getByTestId('ORG.invite-join-btn')).toBeOnTheScreen();
    expect(screen.getByTestId('ORG.invite-decline-btn')).toBeOnTheScreen();
  });

  test('a transient bundle shows the preparing state with no actions', async () => {
    // Only the Monitoramento invite has arrived so far (SPEC 7.4).
    mockInvites([makeInvite('m')]);
    await renderScreen();

    expect(screen.getByText('Preparing invitation…')).toBeOnTheScreen();
    expect(screen.queryByTestId('ORG.invite-join-btn')).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.invite-decline-btn'),
    ).not.toBeOnTheScreen();
  });

  test('a definitive bundle shows the error with only Close', async () => {
    // The Alertas invite was canceled — the bundle can never complete.
    mockInvites([
      makeInvite('m'),
      makeInvite('a', {state: 'canceled', receivedAt: 3}),
    ]);
    await renderScreen();

    expect(
      screen.getByText(
        'This invitation is incomplete. Ask the sender to invite you again.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('ORG.invite-close-btn')).toBeOnTheScreen();
    expect(screen.queryByTestId('ORG.invite-join-btn')).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.invite-decline-btn'),
    ).not.toBeOnTheScreen();
  });

  test('a bundle that cannot be grouped at all shows the error with only Close', async () => {
    mockInvites([]);
    await renderScreen({inviteId: 'invite-gone'});

    expect(
      screen.getByText(
        'This invitation is incomplete. Ask the sender to invite you again.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('ORG.invite-close-btn')).toBeOnTheScreen();
    expect(screen.queryByTestId('ORG.invite-join-btn')).not.toBeOnTheScreen();
  });

  test('pressing join starts the accept of the whole bundle', async () => {
    mockInvites([makeInvite('m'), makeInvite('a')]);
    start.mockResolvedValue({
      ok: true,
      accepted: [
        {slot: 'm', projectId: 'project-m'},
        {slot: 'a', projectId: 'project-a'},
      ],
      activeProjectId: 'project-m',
    });
    const user = userEvent.setup();
    await renderScreen();

    await user.press(screen.getByTestId('ORG.invite-join-btn'));

    expect(start).toHaveBeenCalledTimes(1);
    const [bundle] = start.mock.calls[0]!;
    expect(bundle.organizationId).toBe(ORG_ID);
    expect(bundle.organizationName).toBe(ORG_NAME);
    expect(Object.keys(bundle.invites).sort()).toStrictEqual(['a', 'm']);
  });

  test('a successful accept lands on the joined confirmation', async () => {
    mockInvites([makeInvite('m'), makeInvite('a')]);
    start.mockResolvedValue({
      ok: true,
      accepted: [
        {slot: 'm', projectId: 'project-m'},
        {slot: 'a', projectId: 'project-a'},
      ],
      activeProjectId: 'project-m',
    });
    const user = userEvent.setup();
    await renderScreen();

    await user.press(screen.getByTestId('ORG.invite-join-btn'));

    expect(await screen.findByText('JOINED-Org Um')).toBeOnTheScreen();
  });

  test('a failed accept surfaces the error sheet instead of the confirmation', async () => {
    mockInvites([makeInvite('m'), makeInvite('a')]);
    start.mockResolvedValue({ok: false, error: new Error('network gone')});
    const user = userEvent.setup();
    await renderScreen();

    await user.press(screen.getByTestId('ORG.invite-join-btn'));

    expect(await screen.findByText('ERROR-network gone')).toBeOnTheScreen();
    expect(screen.queryByText('JOINED-Org Um')).not.toBeOnTheScreen();
  });

  test('pressing decline rejects every pending slot of the bundle', async () => {
    mockInvites([makeInvite('m'), makeInvite('a')]);
    const user = userEvent.setup();
    await renderScreen();

    await user.press(screen.getByTestId('ORG.invite-decline-btn'));

    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutateAsync).toHaveBeenCalledWith({inviteId: 'invite-m'});
    expect(mutateAsync).toHaveBeenCalledWith({inviteId: 'invite-a'});
  });

  test('pressing decline also rejects pending duplicates, never terminal ones', async () => {
    mockInvites([
      makeInvite('m'),
      makeInvite('a'),
      // An older still-pending duplicate of the slot-m invite (P5 O5).
      makeInvite('m', {inviteId: 'invite-m-dup', receivedAt: 0}),
      // A canceled duplicate is terminal — nothing left to reject.
      makeInvite('a', {
        inviteId: 'invite-a-dead',
        receivedAt: 3,
        state: 'canceled',
      }),
    ]);
    const user = userEvent.setup();
    await renderScreen();

    await user.press(screen.getByTestId('ORG.invite-decline-btn'));

    expect(mutateAsync).toHaveBeenCalledTimes(3);
    expect(mutateAsync).toHaveBeenCalledWith({inviteId: 'invite-m-dup'});
    expect(mutateAsync).not.toHaveBeenCalledWith({inviteId: 'invite-a-dead'});
  });

  test('joining with tracking active redirects to the tracking guard, not the accept', async () => {
    useTrackingMock.mockReturnValue({isTracking: true});
    mockInvites([makeInvite('m'), makeInvite('a')]);
    const user = userEvent.setup();
    await renderScreen();

    await user.press(screen.getByTestId('ORG.invite-join-btn'));

    expect(await screen.findByText('TRACK-ACTIVE')).toBeOnTheScreen();
    expect(start).not.toHaveBeenCalled();
  });
});
