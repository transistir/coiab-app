import * as React from 'react';
import {Text} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {render, screen, fireEvent} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {Success} from './Success';
import type {OnboardingParamsList} from '../../sharedTypes/navigation';

jest.mock('@comapeo/core-react', () => ({
  useOwnDeviceInfo: () => ({data: {name: 'Aparelho Teste'}}),
}));

// pt-BR copied verbatim from SPEC A :142 and SPEC B :53. The copy is
// asserted through the i18n keys (exact pt-BR text), not the English
// defaultMessage (SPEC B :100-102).
const PT_MESSAGES = {
  '$1screens.DeviceNaming.Success.deviceReady': '{deviceName} está pronto!',
  '$1screens.OrganizationSetup.noOrganizationBody':
    'Seu dispositivo ainda não está em uma organização',
  '$1screens.OrganizationSetup.noOrganizationGuidance':
    'Crie uma organização ou aguarde um convite para participar de uma existente.',
  '$1screens.OrganizationSetup.createOrganization': 'Criar organização',
  '$1screens.OrganizationSetup.waitInviteButton': 'Aguardar convite',
};

const Stack = createNativeStackNavigator<OnboardingParamsList>();

const CreateStub = () => <Text>CREATE-REACHED</Text>;
const JoinStub = () => <Text>JOIN-REACHED</Text>;

async function renderScreen() {
  return render(
    <IntlProvider locale="pt-BR" messages={PT_MESSAGES}>
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
    </IntlProvider>,
  );
}

describe('Success (the "sem organização" state, SPEC A §6.2)', () => {
  test('keeps the device-ready header and renders the SPEC body by exact pt-BR text', async () => {
    await renderScreen();

    expect(
      await screen.findByText('Aparelho Teste está pronto!'),
    ).toBeOnTheScreen();
    expect(
      screen.getByText('Seu dispositivo ainda não está em uma organização'),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Crie uma organização ou aguarde um convite para participar de uma existente.',
      ),
    ).toBeOnTheScreen();
  });

  test('Criar organização is the primary action and opens CreateOrganization', async () => {
    await renderScreen();

    const createButton = await screen.findByTestId('ONBOARDING.create-org-btn');
    expect(createButton).toHaveTextContent('Criar organização');

    await fireEvent.press(createButton);

    expect(await screen.findByText('CREATE-REACHED')).toBeOnTheScreen();
  });

  test('Aguardar convite is the secondary action and opens JoinOrganizationIntro', async () => {
    await renderScreen();

    const joinButton = await screen.findByTestId('ONBOARDING.join-org-btn');
    expect(joinButton).toHaveTextContent('Aguardar convite');

    await fireEvent.press(joinButton);

    expect(await screen.findByText('JOIN-REACHED')).toBeOnTheScreen();
  });
});
