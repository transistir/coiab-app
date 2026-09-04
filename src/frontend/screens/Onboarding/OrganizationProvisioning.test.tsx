import * as React from 'react';
import {Text} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {render, screen, userEvent} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {OrganizationProvisioning} from './OrganizationProvisioning';
import {useOrganizations} from '../../hooks/organization/useOrganizations';
import {useCreateOrganization} from '../../hooks/organization/useCreateOrganization';
import type {ReconstructedOrganization} from '../../lib/organization/reconstruct';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

jest.mock('../../hooks/organization/useOrganizations', () => ({
  useOrganizations: jest.fn(),
}));

jest.mock('../../hooks/organization/useCreateOrganization', () => ({
  useCreateOrganization: jest.fn(),
}));

const useOrganizationsMock = useOrganizations as jest.Mock;
const useCreateOrganizationMock = useCreateOrganization as jest.Mock;

const start = jest.fn();

function mockOrganizations(organizations: ReconstructedOrganization[]) {
  useOrganizationsMock.mockReturnValue(organizations);
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

const Stack = createNativeStackNavigator<AppStackParamsList>();

const HomeStub = () => <Text>HOME-REACHED</Text>;

async function renderScreen() {
  return render(
    <IntlProvider locale="en" messages={{}}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="OrganizationProvisioning"
            component={OrganizationProvisioning}
            options={{headerShown: false}}
          />
          <Stack.Screen name="Home" component={HomeStub} />
        </Stack.Navigator>
      </NavigationContainer>
    </IntlProvider>,
  );
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

beforeEach(() => {
  jest.clearAllMocks();
  mockOrganizations([]);
  mockCreateOrganization();
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
    view.rerender(
      <IntlProvider locale="en" messages={{}}>
        <NavigationContainer>
          <Stack.Navigator>
            <Stack.Screen
              name="OrganizationProvisioning"
              component={OrganizationProvisioning}
              options={{headerShown: false}}
            />
            <Stack.Screen name="Home" component={HomeStub} />
          </Stack.Navigator>
        </NavigationContainer>
      </IntlProvider>,
    );

    expect(await screen.findByText('HOME-REACHED')).toBeOnTheScreen();
  });
});
