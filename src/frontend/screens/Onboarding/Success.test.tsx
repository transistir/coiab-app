import * as React from 'react';
import {Text} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {render, screen, fireEvent} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {Success} from './Success';
import type {OnboardingParamsList} from '../../sharedTypes/navigation';
import {DARK_GREY} from '../../lib/styles';
import {
  createUserProfileStore,
  UserProfileStoreProvider,
  type UserProfileStore,
} from '../../contexts/UserProfileStoreContext';

jest.mock('@comapeo/core-react', () => ({
  useOwnDeviceInfo: () => ({data: {name: 'Aparelho Teste'}}),
}));

// The primary button passes DARK_GREY through renderIcon (PR A #19, passo 2).
jest.mock('../../images/ProjectCoordinator.svg', () => jest.fn(() => null));
const ProjectCoordinatorIcon = jest.requireMock(
  '../../images/ProjectCoordinator.svg',
) as jest.Mock;

const PT_MESSAGES = {
  '$1screens.DeviceNaming.Success.deviceReady': '{deviceName} está pronto!',
  '$1screens.OrganizationSetup.roleQuestion': 'Você é coordenador(a)?',
  '$1screens.OrganizationSetup.roleCoordinatorButton':
    'Sim, sou coordenador(a)',
  '$1screens.OrganizationSetup.roleParticipantButton': 'Não, sou participante',
};

const Stack = createNativeStackNavigator<OnboardingParamsList>();

const CreateStub = () => <Text>CREATE-REACHED</Text>;
const JoinStub = () => <Text>JOIN-REACHED</Text>;

let store: UserProfileStore;

async function renderScreen() {
  return render(
    <IntlProvider locale="pt-BR" messages={PT_MESSAGES}>
      <UserProfileStoreProvider store={store}>
        <NavigationContainer>
          <Stack.Navigator initialRouteName="Success">
            <Stack.Screen name="Success" component={Success} />
            <Stack.Screen
              name="CreateOrganization"
              component={CreateStub}
              options={{headerShown: false}}
            />
            <Stack.Screen
              name="JoinOrganizationIntro"
              component={JoinStub}
              options={{headerShown: false}}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </UserProfileStoreProvider>
    </IntlProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  store = createUserProfileStore();
});

describe('Success (the "sem organização" state, #129)', () => {
  test('keeps the device-ready header and asks the coordinator question', async () => {
    await renderScreen();

    expect(
      await screen.findByText('Aparelho Teste está pronto!'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Você é coordenador(a)?')).toBeOnTheScreen();
  });

  test('the coordinator answer stores the role and opens CreateOrganization', async () => {
    await renderScreen();

    await fireEvent.press(
      await screen.findByTestId('ONBOARDING.role-coordinator-btn'),
    );

    expect(store.instance.getState().coordinationRole).toBe('coordinator');
    expect(await screen.findByText('CREATE-REACHED')).toBeOnTheScreen();
  });

  test('the participant answer stores the role and opens JoinOrganizationIntro', async () => {
    await renderScreen();

    await fireEvent.press(
      await screen.findByTestId('ONBOARDING.role-participant-btn'),
    );

    expect(store.instance.getState().coordinationRole).toBe('participant');
    expect(await screen.findByText('JOIN-REACHED')).toBeOnTheScreen();
  });

  test('the direct creation shortcut no longer exists', async () => {
    await renderScreen();

    await screen.findByTestId('ONBOARDING.role-coordinator-btn');
    expect(
      screen.queryByTestId('ONBOARDING.create-org-btn'),
    ).not.toBeOnTheScreen();
  });

  test('ícone do botão principal recebe DARK_GREY repassado pelo renderIcon (PR A #19, passo 2)', async () => {
    await renderScreen();

    await screen.findByTestId('ONBOARDING.role-coordinator-btn');
    expect(ProjectCoordinatorIcon).toHaveBeenCalledWith(
      expect.objectContaining({color: DARK_GREY}),
      // O React invoca o componente mock com (props, legacyContext).
      undefined,
    );
  });
});
