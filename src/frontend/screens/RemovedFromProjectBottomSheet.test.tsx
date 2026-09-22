import * as React from 'react';
import {Text} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {render, screen, userEvent} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {RemovedFromProjectBottomSheet} from './RemovedFromProjectBottomSheet';
import {
  useLeaveProject,
  useOwnRoleInProject,
  useProjectSettings,
} from '@comapeo/core-react';
import type {AppStackParamsList} from '../sharedTypes/navigation';

jest.mock('@comapeo/core-react', () => ({
  useOwnRoleInProject: jest.fn(),
  useProjectSettings: jest.fn(),
  useLeaveProject: jest.fn(),
}));

const mockLeftProjectId = 'project-left';

const mockLeaveMutate = jest.fn();

const useLeaveProjectMock = useLeaveProject as jest.Mock;
const useOwnRoleInProjectMock = useOwnRoleInProject as jest.Mock;
const useProjectSettingsMock = useProjectSettings as jest.Mock;

function mockLeaveProject() {
  useLeaveProjectMock.mockReturnValue({
    // The screen's logic lives in the onSuccess handler — run it inline.
    mutate: mockLeaveMutate.mockImplementation((_vars, opts) => {
      opts.onSuccess();
    }),
    reset: jest.fn(),
    status: 'idle',
    error: undefined,
  });
}

const Stack = createNativeStackNavigator<AppStackParamsList>();

const HomeStub = () => <Text>HOME-REACHED</Text>;
const ProvisioningStub = () => <Text>PROVISIONING-REACHED</Text>;

async function renderScreen() {
  await render(
    <IntlProvider locale="en" messages={{}}>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="RemovedFromProjectBottomSheet">
          <Stack.Screen name="Home" component={HomeStub} />
          <Stack.Screen
            name="OrganizationProvisioning"
            component={ProvisioningStub}
          />
          <Stack.Screen
            name="RemovedFromProjectBottomSheet"
            component={RemovedFromProjectBottomSheet}
            initialParams={{projectId: mockLeftProjectId}}
            options={{headerShown: false}}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </IntlProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useOwnRoleInProjectMock.mockReturnValue({data: {roleId: undefined}});
  useProjectSettingsMock.mockReturnValue({
    data: {name: 'Projeto Removido', projectColor: '#444444'},
  });
  mockLeaveProject();
});
describe('RemovedFromProjectBottomSheet (Fase 11b)', () => {
  test('Close deixa o slot removido e reseta para OrganizationProvisioning sem escrever o id ativo (A §5.3)', async () => {
    await renderScreen();

    await userEvent.press(screen.getByText('Close'));

    expect(mockLeaveMutate).toHaveBeenCalledWith(
      {projectId: mockLeftProjectId},
      expect.anything(),
    );
    // The landing is the provisioning surface — never a surviving-slot
    // projection: the engine's revalidation (via the slot listener) owns
    // what opens next, and the active id is never written here.
    expect(await screen.findByText('PROVISIONING-REACHED')).toBeOnTheScreen();
  });
});
