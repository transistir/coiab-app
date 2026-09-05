import * as React from 'react';
import {Alert, Text} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {render, screen, userEvent} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';
import {useManyInvites} from '@comapeo/core-react';

import {OrganizationProvisioning} from './OrganizationProvisioning';
import {useOrganizations} from '../../hooks/organization/useOrganizations';
import {useCreateOrganization} from '../../hooks/organization/useCreateOrganization';
import {useDiscardIncompleteOrganization} from '../../hooks/organization/useDiscardIncompleteOrganization';
import {markerFor} from '../../lib/organization/marker';
import type {DiscardResult} from '../../lib/organization/fanout';
import type {InviteLike} from '../../lib/organization/bundle';
import type {ReconstructedOrganization} from '../../lib/organization/reconstruct';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

jest.mock('@comapeo/core-react', () => ({
  useManyInvites: jest.fn(),
}));

jest.mock('../../hooks/organization/useOrganizations', () => ({
  useOrganizations: jest.fn(),
}));

jest.mock('../../hooks/organization/useCreateOrganization', () => ({
  useCreateOrganization: jest.fn(),
}));

jest.mock('../../hooks/organization/useDiscardIncompleteOrganization', () => ({
  useDiscardIncompleteOrganization: jest.fn(),
}));

const useOrganizationsMock = useOrganizations as jest.Mock;
const useCreateOrganizationMock = useCreateOrganization as jest.Mock;
const useDiscardMock = useDiscardIncompleteOrganization as jest.Mock;
const useManyInvitesMock = useManyInvites as jest.Mock;

const start = jest.fn();
const discard = jest.fn();

function mockOrganizations(organizations: ReconstructedOrganization[]) {
  useOrganizationsMock.mockReturnValue(organizations);
}

function mockInvites(invites: InviteLike[]) {
  useManyInvitesMock.mockReturnValue({data: invites});
}

function mockCreateOrganization(
  overrides?: Partial<ReturnType<typeof useCreateOrganization>>,
) {
  useCreateOrganizationMock.mockReturnValue({
    start,
    reset: jest.fn(),
    status: 'idle',
    error: undefined,
    organizationId: undefined,
    ...overrides,
  });
}

function mockDiscard(
  overrides?: Partial<ReturnType<typeof useDiscardIncompleteOrganization>>,
) {
  useDiscardMock.mockReturnValue({
    discard,
    reset: jest.fn(),
    status: 'idle',
    error: undefined,
    result: undefined,
    ...overrides,
  });
}

/** The buttons of the most recent `Alert.alert` call. */
function alertButtons(): Array<{text?: string; onPress?: () => void}> {
  const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1]?.[2];
  if (!Array.isArray(buttons)) throw new Error('no alert buttons');
  return buttons;
}

function pressAlertButton(text: string) {
  const button = alertButtons().find(entry => entry.text === text);
  if (!button) {
    throw new Error(
      `no alert button ${text}; got ${alertButtons()
        .map(entry => entry.text)
        .join(', ')}`,
    );
  }
  button.onPress?.();
}

const Stack = createNativeStackNavigator<AppStackParamsList>();

const HomeStub = () => <Text>HOME-REACHED</Text>;
const SuccessStub = () => <Text>START-OVER-FORK-REACHED</Text>;

/**
 * ONE navigator tree for the initial render and every rerender: a rerender
 * whose screen set differs from the mounted one remounts the navigator and
 * wipes its navigation state.
 */
function navigatorTree() {
  return (
    <IntlProvider locale="en" messages={{}}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="OrganizationProvisioning"
            component={OrganizationProvisioning}
            options={{headerShown: false}}
          />
          <Stack.Screen name="Home" component={HomeStub} />
          <Stack.Screen name="Success" component={SuccessStub} />
        </Stack.Navigator>
      </NavigationContainer>
    </IntlProvider>
  );
}

async function renderScreen() {
  return render(navigatorTree());
}

const readyOrganization: ReconstructedOrganization = {
  state: 'ready',
  organizationId: 'a'.repeat(16),
  organizationName: 'Org',
  slots: {m: 'project-m', a: 'project-a'},
};

const invalidOrganization: ReconstructedOrganization = {
  state: 'invalid',
  organizationId: 'b'.repeat(16),
  reason: 'duplicate-slot',
  organizationName: undefined,
  slots: {},
};

const incompleteOrganization: ReconstructedOrganization = {
  state: 'incomplete',
  organizationId: 'c'.repeat(16),
  organizationName: 'Partial Org',
  slots: {m: 'project-m'},
};

const namelessIncompleteOrganization: ReconstructedOrganization = {
  state: 'incomplete',
  organizationId: 'd'.repeat(16),
  organizationName: undefined,
  slots: {a: 'project-a'},
};

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockOrganizations([]);
  mockCreateOrganization();
  mockDiscard();
  mockInvites([]);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('OrganizationProvisioning', () => {
  test('shows the setup text while there is no ready organization', async () => {
    await renderScreen();

    expect(screen.getByText('Setting up your Organization…')).toBeOnTheScreen();
    expect(screen.queryByText('HOME-REACHED')).not.toBeOnTheScreen();
  });

  test('shows the error line when an organization is invalid, and stays put', async () => {
    mockOrganizations([invalidOrganization]);
    await renderScreen();

    expect(
      screen.getByText(
        'Something is wrong with this Organization. Contact support.',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByText('HOME-REACHED')).not.toBeOnTheScreen();
  });

  test('offers to finish setting up for an incomplete organization with a name', async () => {
    mockOrganizations([incompleteOrganization]);
    await renderScreen();

    expect(screen.getByTestId('ORG.provisioning-retry-btn')).toBeOnTheScreen();
    expect(screen.getByText('Finish setting up')).toBeOnTheScreen();
  });

  test('pressing the retry resumes the reconstructed organization (idempotent fan-out)', async () => {
    const user = userEvent.setup();
    mockOrganizations([incompleteOrganization]);
    await renderScreen();

    await user.press(screen.getByTestId('ORG.provisioning-retry-btn'));

    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith('Partial Org', 'cccccccccccccccc');
  });

  test('stays passive (no retry) when the incomplete organization has no name', async () => {
    mockOrganizations([namelessIncompleteOrganization]);
    await renderScreen();

    expect(screen.getByText('Setting up your Organization…')).toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.provisioning-retry-btn'),
    ).not.toBeOnTheScreen();
  });

  test('hides the retry button while a pending invite covers the missing slot', async () => {
    // The invite sheet completes the organization — fabricating the slot
    // here would create a private project alongside it.
    mockOrganizations([incompleteOrganization]);
    mockInvites([
      {
        inviteId: 'invite-a',
        projectDescription: markerFor('c'.repeat(16), 'a', 'Partial Org'),
        invitorDeviceId: 'invitor-1',
        roleName: 'Coordinator',
        receivedAt: 1,
        state: 'pending',
      },
    ]);
    await renderScreen();

    expect(screen.getByText('Setting up your Organization…')).toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.provisioning-retry-btn'),
    ).not.toBeOnTheScreen();
  });

  test('hides the retry button while the fan-out is running', async () => {
    mockOrganizations([incompleteOrganization]);
    mockCreateOrganization({status: 'creating'});
    await renderScreen();

    expect(
      screen.queryByTestId('ORG.provisioning-retry-btn'),
    ).not.toBeOnTheScreen();
    expect(screen.getByText('Setting up your Organization…')).toBeOnTheScreen();
  });

  test('advances to Home when an organization becomes ready', async () => {
    const view = await renderScreen();

    mockOrganizations([readyOrganization]);
    // Re-render so the hook publishes the new organization state.
    view.rerender(navigatorTree());

    expect(await screen.findByText('HOME-REACHED')).toBeOnTheScreen();
  });

  test('offers the discard escape hatch even when the incomplete organization has no name', async () => {
    // A nameless incomplete org has no retry (no name, no marker can be
    // minted) — the discard is the only way out of the creation lockout.
    mockOrganizations([namelessIncompleteOrganization]);
    await renderScreen();

    expect(
      screen.getByTestId('ORG.provisioning-discard-btn'),
    ).toBeOnTheScreen();
  });

  test('discards only after the destructive confirm, and cancel leaves everything alone', async () => {
    const user = userEvent.setup();
    mockOrganizations([incompleteOrganization]);
    await renderScreen();

    await user.press(screen.getByTestId('ORG.provisioning-discard-btn'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(discard).not.toHaveBeenCalled();

    pressAlertButton('Cancel');
    expect(discard).not.toHaveBeenCalled();

    await user.press(screen.getByTestId('ORG.provisioning-discard-btn'));
    pressAlertButton('Discard and start over');
    expect(discard).toHaveBeenCalledWith('cccccccccccccccc');
  });

  test('a fully discarded organization routes back to the start-over fork', async () => {
    mockOrganizations([namelessIncompleteOrganization]);
    mockDiscard({
      status: 'success',
      result: {
        ok: true,
        removed: [{slot: 'a', projectId: 'project-a'}],
        skipped: [],
      } satisfies DiscardResult,
    });
    await renderScreen();

    expect(
      await screen.findByText('START-OVER-FORK-REACHED'),
    ).toBeOnTheScreen();
  });

  test('a partial discard names each skipped project and why, and stays put', async () => {
    mockOrganizations([incompleteOrganization]);
    mockDiscard({
      status: 'success',
      result: {
        ok: false,
        removed: [],
        skipped: [
          {
            slot: 'm',
            projectId: 'project-m',
            reason: 'shared-with-other-devices',
          },
        ],
      } satisfies DiscardResult,
    });
    await renderScreen();

    expect(
      screen.getByText(
        'Monitoramento is shared with other devices, so it was kept.',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByText('START-OVER-FORK-REACHED')).not.toBeOnTheScreen();
    expect(screen.getByText('Setting up your Organization…')).toBeOnTheScreen();
  });

  test('a skip with no creation provenance is explained the same way', async () => {
    // Finding 1: a joined slot this device cannot prove it created is never
    // deleted — the user is told which project was kept and why.
    mockOrganizations([incompleteOrganization]);
    mockDiscard({
      status: 'success',
      result: {
        ok: false,
        removed: [],
        skipped: [
          {slot: 'm', projectId: 'project-m', reason: 'not-created-here'},
        ],
      } satisfies DiscardResult,
    });
    await renderScreen();

    expect(
      screen.getByText(
        'Monitoramento was not created on this device, so it was kept.',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByText('START-OVER-FORK-REACHED')).not.toBeOnTheScreen();
  });

  test('a failed discard says so and stays on the screen', async () => {
    // Finding 2: a discard error must reach the user — never a silent
    // return to a screen that looks untouched.
    const view = await renderScreen();
    expect(
      screen.queryByText(/went wrong while discarding/),
    ).not.toBeOnTheScreen();

    mockDiscard({status: 'error', error: new Error('IPC_GONE')});
    view.rerender(navigatorTree());

    expect(
      await screen.findByText(
        'Something went wrong while discarding this setup. It was not fully removed — you can try again.',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByText('START-OVER-FORK-REACHED')).not.toBeOnTheScreen();
    expect(screen.queryByText('HOME-REACHED')).not.toBeOnTheScreen();
    expect(screen.getByText('Setting up your Organization…')).toBeOnTheScreen();
  });

  test('hides the discard action while the fan-out runs', async () => {
    mockOrganizations([incompleteOrganization]);
    mockCreateOrganization({status: 'creating'});
    await renderScreen();

    expect(
      screen.queryByTestId('ORG.provisioning-discard-btn'),
    ).not.toBeOnTheScreen();
  });

  test('hides the discard action while a pending invite covers the missing slot', async () => {
    // The invite completes the organization — that is the expected path, not
    // tearing the setup down.
    mockOrganizations([incompleteOrganization]);
    mockInvites([
      {
        inviteId: 'invite-a',
        projectDescription: markerFor('c'.repeat(16), 'a', 'Partial Org'),
        invitorDeviceId: 'invitor-1',
        roleName: 'Coordinator',
        receivedAt: 1,
        state: 'pending',
      },
    ]);
    await renderScreen();

    expect(
      screen.queryByTestId('ORG.provisioning-discard-btn'),
    ).not.toBeOnTheScreen();
  });
});
