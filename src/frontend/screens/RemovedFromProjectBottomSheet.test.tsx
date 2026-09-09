import * as React from 'react';
import {Text} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {render, screen, userEvent} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {RemovedFromProjectBottomSheet} from './RemovedFromProjectBottomSheet';
import {
  useCreateProject,
  useLeaveProject,
  useManyProjects,
  useOwnRoleInProject,
  useProjectSettings,
} from '@comapeo/core-react';
import {useOrganizations} from '../hooks/organization/useOrganizations';
import type {ReconstructedOrganization} from '../lib/organization/reconstruct';
import type {AppStackParamsList} from '../sharedTypes/navigation';

jest.mock('@comapeo/core-react', () => ({
  useOwnRoleInProject: jest.fn(),
  useProjectSettings: jest.fn(),
  useManyProjects: jest.fn(),
  useLeaveProject: jest.fn(),
  useCreateProject: jest.fn(),
}));

jest.mock('../contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({projectId: mockLeftProjectId, projectApi: {}}),
}));

jest.mock('../contexts/ActiveProjectIdStoreContext', () => ({
  useActiveProjectIdActions: () => ({
    setActiveProjectId: mockSetActiveProjectId,
    clearActiveProjectId: mockClearActiveProjectId,
  }),
}));

jest.mock('../hooks/organization/useOrganizations', () => ({
  useOrganizations: jest.fn(),
}));

const mockLeftProjectId = 'project-left';
const mockSurvivingSlotId = 'project-surviving';
const mockOtherProjectId = 'project-other';

const mockSetActiveProjectId = jest.fn();
const mockClearActiveProjectId = jest.fn();
const mockLeaveMutate = jest.fn();
const mockCreateProjectMutate = jest.fn();

const useOrganizationsMock = useOrganizations as jest.Mock;
const useManyProjectsMock = useManyProjects as jest.Mock;
const useLeaveProjectMock = useLeaveProject as jest.Mock;
const useCreateProjectMock = useCreateProject as jest.Mock;
const useOwnRoleInProjectMock = useOwnRoleInProject as jest.Mock;
const useProjectSettingsMock = useProjectSettings as jest.Mock;

function mockProjectList(projectIds: string[]) {
  useManyProjectsMock.mockReturnValue({
    data: projectIds.map(projectId => ({
      projectId,
      name: projectId === mockLeftProjectId ? undefined : `Name ${projectId}`,
      projectColor: undefined,
    })),
  });
}

function mockOrganizations(organizations: ReconstructedOrganization[]) {
  useOrganizationsMock.mockReturnValue(organizations);
}

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
const SuccessStub = () => <Text>SUCCESS-REACHED</Text>;

async function renderScreen() {
  await render(
    <IntlProvider locale="en" messages={{}}>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="RemovedFromProjectBottomSheet">
          <Stack.Screen name="Home" component={HomeStub} />
          <Stack.Screen name="Success" component={SuccessStub} />
          <Stack.Screen
            name="RemovedFromProjectBottomSheet"
            component={RemovedFromProjectBottomSheet}
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
  mockProjectList([mockLeftProjectId]);
  mockOrganizations([]);
  mockLeaveProject();
  useCreateProjectMock.mockReturnValue({
    mutate: mockCreateProjectMutate,
    status: 'idle',
  });
});

describe('RemovedFromProjectBottomSheet', () => {
  test('an org project with a surviving slot activates it and never creates a project', async () => {
    mockOrganizations([
      {
        state: 'ready',
        organizationId: 'a1b2c3d4e5f60718',
        organizationName: 'Org Um',
        slots: {m: mockLeftProjectId, a: mockSurvivingSlotId},
      },
    ]);
    await renderScreen();

    await userEvent.press(screen.getByText('Close'));

    expect(mockLeaveMutate).toHaveBeenCalledWith(
      {projectId: mockLeftProjectId},
      expect.anything(),
    );
    expect(mockCreateProjectMutate).not.toHaveBeenCalled();
    expect(mockSetActiveProjectId).toHaveBeenCalledWith(mockSurvivingSlotId);
    expect(mockClearActiveProjectId).not.toHaveBeenCalled();
  });

  test('an org project with no surviving slot clears the active id and resets to the org fork', async () => {
    mockOrganizations([
      {
        state: 'incomplete',
        organizationId: 'a1b2c3d4e5f60718',
        organizationName: 'Org Um',
        slots: {m: mockLeftProjectId},
      },
    ]);
    await renderScreen();

    await userEvent.press(screen.getByText('Close'));

    expect(mockCreateProjectMutate).not.toHaveBeenCalled();
    expect(mockClearActiveProjectId).toHaveBeenCalledTimes(1);
    expect(mockSetActiveProjectId).not.toHaveBeenCalled();
    // SPEC 10.1: the startup gate's organization fork is the landing.
    expect(await screen.findByText('SUCCESS-REACHED')).toBeOnTheScreen();
  });

  test('a non-org project switches to any remaining project without creating one', async () => {
    mockProjectList([mockLeftProjectId, mockOtherProjectId]);
    await renderScreen();

    await userEvent.press(screen.getByText('Close'));

    expect(mockCreateProjectMutate).not.toHaveBeenCalled();
    expect(mockSetActiveProjectId).toHaveBeenCalledWith(mockOtherProjectId);
    expect(mockClearActiveProjectId).not.toHaveBeenCalled();
  });

  test('a non-org project with nothing remaining clears the active id and resets to the org fork', async () => {
    mockProjectList([mockLeftProjectId]);
    await renderScreen();

    await userEvent.press(screen.getByText('Close'));

    expect(mockCreateProjectMutate).not.toHaveBeenCalled();
    expect(mockClearActiveProjectId).toHaveBeenCalledTimes(1);
    expect(mockSetActiveProjectId).not.toHaveBeenCalled();
    expect(await screen.findByText('SUCCESS-REACHED')).toBeOnTheScreen();
  });
});
