import * as React from 'react';
import {Text} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {act, render, screen, fireEvent} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {Success} from './Success';
import type {OnboardingParamsList} from '../../sharedTypes/navigation';
import {DARK_GREY} from '../../lib/styles';
import {useCreateProject} from '@comapeo/core-react';

jest.mock('@comapeo/core-react', () => ({
  useOwnDeviceInfo: () => ({data: {name: 'Aparelho Teste'}}),
  useCreateProject: jest.fn(),
}));

jest.mock('../../contexts/ActiveProjectIdStoreContext', () => ({
  useProjetarProjectIdAtivo: jest.fn(),
}));

// The primary button passes DARK_GREY through renderIcon (PR A #19, step 2).
jest.mock('@react-native-vector-icons/material-icons', () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));

const useCreateProjectMock = useCreateProject as jest.Mock;
const useProjetarProjectIdAtivoMock = jest.requireMock(
  '../../contexts/ActiveProjectIdStoreContext',
) as {useProjetarProjectIdAtivo: jest.Mock};
const MaterialIconMock = (
  jest.requireMock('@react-native-vector-icons/material-icons') as {
    default: jest.Mock;
  }
).default;

const PT_MESSAGES = {
  '$1screens.DeviceNaming.Success.deviceReady': '{deviceName} está pronto!',
};

const Stack = createNativeStackNavigator<OnboardingParamsList>();

const ErrorStub = () => <Text>ERROR-REACHED</Text>;

let createProjectMutate: jest.Mock;
let projetarProjectIdAtivo: jest.Mock;

async function renderScreen() {
  return render(
    <IntlProvider locale="pt-BR" messages={PT_MESSAGES}>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="Success">
          <Stack.Screen name="Success" component={Success} />
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
  createProjectMutate = jest.fn();
  projetarProjectIdAtivo = jest.fn();
  useCreateProjectMock.mockReturnValue({
    mutate: createProjectMutate,
    status: 'idle',
  });
  useProjetarProjectIdAtivoMock.useProjetarProjectIdAtivo.mockReturnValue(
    projetarProjectIdAtivo,
  );
});

describe('Success (merged v14 screen)', () => {
  test('keeps the device-ready header and offers the mapping entry point', async () => {
    await renderScreen();

    expect(
      await screen.findByText('Aparelho Teste está pronto!'),
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('ONBOARDING.navigate-to-map-btn'),
    ).toBeOnTheScreen();
  });

  test('the mapping button creates a project and projects its id', async () => {
    await renderScreen();

    await fireEvent.press(
      await screen.findByTestId('ONBOARDING.navigate-to-map-btn'),
    );

    expect(createProjectMutate).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );

    const [, options] = createProjectMutate.mock.calls[0]!;
    act(() => {
      options.onSuccess('project-1');
    });
    expect(projetarProjectIdAtivo).toHaveBeenCalledWith('project-1');
  });

  test('a project creation error opens the error sheet', async () => {
    await renderScreen();

    await fireEvent.press(
      await screen.findByTestId('ONBOARDING.navigate-to-map-btn'),
    );

    const [, options] = createProjectMutate.mock.calls[0]!;
    act(() => {
      options.onError(new Error('falha ao criar projeto'));
    });

    expect(await screen.findByText('ERROR-REACHED')).toBeOnTheScreen();
  });

  test('the direct role-selection shortcut no longer exists', async () => {
    await renderScreen();

    await screen.findByTestId('ONBOARDING.navigate-to-map-btn');
    expect(
      screen.queryByTestId('ONBOARDING.role-coordinator-btn'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('ONBOARDING.role-participant-btn'),
    ).not.toBeOnTheScreen();
  });

  test('ícone do botão principal recebe DARK_GREY repassado pelo renderIcon (PR A #19, passo 2)', async () => {
    await renderScreen();

    await screen.findByTestId('ONBOARDING.navigate-to-map-btn');
    const mapIconCall = MaterialIconMock.mock.calls.find(
      ([props]) => props.name === 'map',
    );
    expect(mapIconCall?.[0]).toEqual(
      expect.objectContaining({name: 'map', color: DARK_GREY, size: 25}),
    );
  });
});
