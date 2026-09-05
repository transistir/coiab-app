import * as React from 'react';
import {Text} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {
  render,
  screen,
  fireEvent,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {CreateOrganization} from './CreateOrganization';
import {useCreateOrganization} from '../../hooks/organization/useCreateOrganization';
import {OrganizationOperationError} from '../../lib/organization/fanout';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

jest.mock('../../hooks/organization/useCreateOrganization', () => ({
  useCreateOrganization: jest.fn(),
}));

const useCreateOrganizationMock = useCreateOrganization as jest.Mock;

const start = jest.fn();

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

const ProvisioningStub = () => <Text>PROVISIONING-REACHED</Text>;

const ErrorStub = ({
  route,
}: NativeStackScreenProps<AppStackParamsList, 'ErrorBottomSheet'>) => (
  <Text>ERROR: {route.params.error.message}</Text>
);

async function renderScreen() {
  return render(
    <IntlProvider locale="en" messages={{}}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="CreateOrganization"
            component={CreateOrganization}
            options={{headerShown: false}}
          />
          <Stack.Screen name="Home" component={HomeStub} />
          <Stack.Screen
            name="OrganizationProvisioning"
            component={ProvisioningStub}
          />
          <Stack.Screen
            name="ErrorBottomSheet"
            component={ErrorStub}
            options={{headerShown: false}}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </IntlProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateOrganization();
});

describe('CreateOrganization', () => {
  // The real bound is the minted marker `coiab-org:v1:<16>:<slot>:<name>`
  // (SPEC 4.1/E3): 31 overhead chars, so the encoded name must fit 29.
  const MARKER_OVERHEAD = 'coiab-org:v1:'.length + 16 + 1 + 1;
  const MAX_ENCODED_NAME = 60 - MARKER_OVERHEAD;

  test('renders title, name input and create button', async () => {
    await renderScreen();

    expect(screen.getByText('Name your Organization')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'The Organization is the way CoMapeo organizes mapping. It contains the Monitoramento and Alertas projects.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('ORG.create-name-inp')).toBeOnTheScreen();
    expect(screen.getByTestId('ORG.create-btn')).toBeOnTheScreen();
  });

  test('create button is disabled while the name is empty', async () => {
    await renderScreen();

    expect(screen.getByTestId('ORG.create-btn')).toBeDisabled();
  });

  test('presses create with the trimmed name', async () => {
    const user = userEvent.setup();
    await renderScreen();

    await user.type(
      screen.getByTestId('ORG.create-name-inp'),
      '  Minha Organização  ',
    );

    const button = screen.getByTestId('ORG.create-btn');
    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    await user.press(button);

    await waitFor(() => {
      expect(start).toHaveBeenCalledWith('Minha Organização');
    });
  });

  test('does not start while the name is only whitespace', async () => {
    await renderScreen();

    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      '   ',
    );
    // Button stays disabled, but press guard is also asserted directly.
    expect(screen.getByTestId('ORG.create-btn')).toBeDisabled();
    expect(start).not.toHaveBeenCalled();
  });

  test('an ASCII name at the exact encoded-marker boundary stays enabled', async () => {
    await renderScreen();

    // 31 + 29 = 60 — the marker fits exactly.
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'a'.repeat(MAX_ENCODED_NAME),
    );
    expect(screen.getByTestId('ORG.create-btn')).toBeEnabled();
    expect(
      screen.queryByText('Organization name is too long'),
    ).not.toBeOnTheScreen();

    // One more char makes the marker overflow 60 — the button is disabled
    // even though the raw input is far below its 60-char maxLength.
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'a'.repeat(MAX_ENCODED_NAME + 1),
    );
    expect(screen.getByTestId('ORG.create-btn')).toBeDisabled();
    expect(screen.getByText('Organization name is too long')).toBeOnTheScreen();
  });

  test('an accented name is guarded by its encoded length, not the raw one', async () => {
    await renderScreen();

    // 'Minha Organização' encodes to 27 chars (ç and ã become %XX%XX):
    // 31 + 27 = 58, inside the bound.
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'Minha Organização',
    );
    expect(screen.getByTestId('ORG.create-btn')).toBeEnabled();

    // Appending ASCII chars walks the encoded length onto the boundary:
    // 27 + 2 = 29 still fits exactly; +3 overflows.
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'Minha Organização' +
        'x'.repeat(
          MAX_ENCODED_NAME - encodeURIComponent('Minha Organização').length,
        ),
    );
    expect(screen.getByTestId('ORG.create-btn')).toBeEnabled();

    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'Minha Organização' +
        'x'.repeat(
          MAX_ENCODED_NAME - encodeURIComponent('Minha Organização').length + 1,
        ),
    );
    expect(screen.getByTestId('ORG.create-btn')).toBeDisabled();
    expect(screen.getByText('Organization name is too long')).toBeOnTheScreen();
  });

  test('an emoji name is guarded by its encoded length', async () => {
    await renderScreen();

    // Each 🌴 encodes to 12 chars (%F0%9F%8C%B4, 4 bytes × 3): two fit the
    // 29-char encoded-name bound, three do not — both far below the raw
    // 60-char input maxLength.
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      '🌴'.repeat(2),
    );
    expect(screen.getByTestId('ORG.create-btn')).toBeEnabled();

    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      '🌴'.repeat(3),
    );
    expect(screen.getByTestId('ORG.create-btn')).toBeDisabled();
    expect(screen.getByText('Organization name is too long')).toBeOnTheScreen();
  });

  test('shows the loading state instead of the button while creating', async () => {
    mockCreateOrganization({status: 'creating'});
    await renderScreen();

    expect(screen.queryByTestId('ORG.create-btn')).not.toBeOnTheScreen();
  });

  test('navigates to Home when the organization is created', async () => {
    mockCreateOrganization({status: 'success'});
    await renderScreen();

    expect(await screen.findByText('HOME-REACHED')).toBeOnTheScreen();
  });

  test('navigates to ErrorBottomSheet when the create fails', async () => {
    mockCreateOrganization({
      status: 'error',
      error: new Error('boom'),
    });
    await renderScreen();

    expect(await screen.findByText('ERROR: boom')).toBeOnTheScreen();
  });

  test('an incomplete-org-blocks-create failure routes to OrganizationProvisioning, not the error sheet', async () => {
    // The device already holds a half-provisioned organization (the errored
    // attempt's id was lost): the provisioning screen owns the repair — it
    // retries the reconstructed id — so this error must not dead-end in the
    // error sheet, and a naive resubmit here would mint a second org.
    mockCreateOrganization({
      status: 'error',
      error: new OrganizationOperationError(
        'incomplete-org-blocks-create',
        'an incomplete organization is already being set up',
      ),
    });
    await renderScreen();

    expect(await screen.findByText('PROVISIONING-REACHED')).toBeOnTheScreen();
    expect(screen.queryByText(/incomplete organization/)).not.toBeOnTheScreen();
  });
});
