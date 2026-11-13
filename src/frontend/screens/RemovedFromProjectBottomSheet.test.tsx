import * as React from 'react';
import {Text} from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {act, render, screen, userEvent} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {RemovedFromProjectBottomSheet} from './RemovedFromProjectBottomSheet';
import {
  useCreateProject,
  useLeaveProject,
  useManyProjects,
  useOwnRoleInProject,
  useProjectSettings,
} from '@comapeo/core-react';
import type {AppStackParamsList} from '../sharedTypes/navigation';

jest.mock('@comapeo/core-react', () => ({
  useOwnRoleInProject: jest.fn(),
  useProjectSettings: jest.fn(),
  useLeaveProject: jest.fn(),
  useManyProjects: jest.fn(),
  useCreateProject: jest.fn(),
}));

jest.mock('../contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({projectId: 'project-left'}),
}));

jest.mock('../contexts/ActiveProjectIdStoreContext', () => ({
  useProjetarProjectIdAtivo: jest.fn(),
}));

const mockLeftProjectId = 'project-left';
const mockDefaultProjectId = 'default-project';

const mockLeaveMutate = jest.fn();

let projetarProjectIdAtivo: jest.Mock;

const useLeaveProjectMock = useLeaveProject as jest.Mock;
const useOwnRoleInProjectMock = useOwnRoleInProject as jest.Mock;
const useProjectSettingsMock = useProjectSettings as jest.Mock;
const useManyProjectsMock = useManyProjects as jest.Mock;
const useCreateProjectMock = useCreateProject as jest.Mock;
const useProjetarProjectIdAtivoMock = jest.requireMock(
  '../contexts/ActiveProjectIdStoreContext',
) as {useProjetarProjectIdAtivo: jest.Mock};

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
const navigationRef = createNavigationContainerRef<AppStackParamsList>();

const HomeStub = () => <Text>HOME-REACHED</Text>;

async function renderScreen() {
  render(
    <IntlProvider locale="en" messages={{}}>
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator initialRouteName="Home">
          <Stack.Screen name="Home" component={HomeStub} />
          <Stack.Screen
            name="RemovedFromProjectBottomSheet"
            component={RemovedFromProjectBottomSheet}
            options={{headerShown: false}}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </IntlProvider>,
  );

  // The native-stack navigator mounts asynchronously: wait for the initial
  // route to settle before dispatching, or the navigate becomes a no-op.
  await screen.findByText('HOME-REACHED');
  await act(async () => {
    navigationRef.navigate('RemovedFromProjectBottomSheet', {
      projectId: mockLeftProjectId,
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  useOwnRoleInProjectMock.mockReturnValue({data: {reason: undefined}});
  useProjectSettingsMock.mockReturnValue({
    data: {name: 'Projeto Removido', projectColor: '#444444'},
  });
  useManyProjectsMock.mockReturnValue({
    data: [{projectId: mockDefaultProjectId, name: undefined}],
  });
  useCreateProjectMock.mockReturnValue({
    mutate: jest.fn(),
    status: 'idle',
  });
  projetarProjectIdAtivo = jest.fn();
  useProjetarProjectIdAtivoMock.useProjetarProjectIdAtivo.mockReturnValue(
    projetarProjectIdAtivo,
  );
  mockLeaveProject();
});

describe('RemovedFromProjectBottomSheet (Fase 11b)', () => {
  test('Close deixa o slot removido, projeta o projeto padrão e volta para Home', async () => {
    await renderScreen();

    await userEvent.press(await screen.findByText('Close'));

    expect(mockLeaveMutate).toHaveBeenCalledWith(
      {projectId: mockLeftProjectId},
      expect.anything(),
    );
    // The merged screen repoints the surviving (default) project and pops the
    // sheet; it no longer resets to OrganizationProvisioning.
    expect(projetarProjectIdAtivo).toHaveBeenCalledWith(mockDefaultProjectId);
    expect(await screen.findByText('HOME-REACHED')).toBeOnTheScreen();
  });
});
