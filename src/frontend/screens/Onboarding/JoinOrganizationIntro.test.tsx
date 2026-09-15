import * as React from 'react';
import {Text} from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {render, screen, fireEvent} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {JoinOrganizationIntro} from './JoinOrganizationIntro';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

// pt-BR copied verbatim from SPEC A :143 and SPEC B :60. The copy is
// asserted through the i18n keys (exact pt-BR text), not the English
// defaultMessage (SPEC B :100-102).
const PT_MESSAGES = {
  '$1screens.OrganizationSetup.waitInviteTitle': 'Aguardar convite',
  '$1screens.OrganizationSetup.waitInviteBody':
    'Peça a uma pessoa responsável pela organização para convidar este dispositivo.',
  '$1screens.OrganizationSetup.backButton': 'Voltar',
};

const Stack = createNativeStackNavigator<AppStackParamsList>();
const navigationRef = createNavigationContainerRef<AppStackParamsList>();

const SuccessStub = () => <Text>BACK-REACHED</Text>;

async function renderScreen() {
  return render(
    <IntlProvider locale="pt-BR" messages={PT_MESSAGES}>
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator initialRouteName="Success">
          <Stack.Screen name="Success" component={SuccessStub} />
          <Stack.Screen
            name="JoinOrganizationIntro"
            component={JoinOrganizationIntro}
            options={{headerShown: false}}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </IntlProvider>,
  );
}

describe('JoinOrganizationIntro', () => {
  test('renders title, waiting body and back button in exact pt-BR', async () => {
    await renderScreen();
    navigationRef.navigate('JoinOrganizationIntro');

    expect(await screen.findByText('Aguardar convite')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Peça a uma pessoa responsável pela organização para convidar este dispositivo.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('ORG.join-intro-back-btn')).toBeOnTheScreen();
  });

  test('the back button returns to the previous screen', async () => {
    await renderScreen();
    navigationRef.navigate('JoinOrganizationIntro');

    expect(await screen.findByText('Aguardar convite')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('ORG.join-intro-back-btn'));

    expect(await screen.findByText('BACK-REACHED')).toBeOnTheScreen();
  });
});
