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

const Stack = createNativeStackNavigator<AppStackParamsList>();
const navigationRef = createNavigationContainerRef<AppStackParamsList>();

const SuccessStub = () => <Text>BACK-REACHED</Text>;

async function renderScreen() {
  return render(
    <IntlProvider locale="en" messages={{}}>
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
  test('renders title, waiting body and OK button', async () => {
    await renderScreen();
    navigationRef.navigate('JoinOrganizationIntro');

    expect(await screen.findByText('Join an Organization')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Ask a coordinator of an existing Organization to invite this device. When the invitation arrives it will appear on this screen.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('ORG.join-intro-ok-btn')).toBeOnTheScreen();
  });

  test('OK goes back to the previous screen', async () => {
    await renderScreen();
    navigationRef.navigate('JoinOrganizationIntro');

    expect(await screen.findByText('Join an Organization')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('ORG.join-intro-ok-btn'));

    expect(await screen.findByText('BACK-REACHED')).toBeOnTheScreen();
  });
});
