import * as React from 'react';
import {Text} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {render, screen, userEvent} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {LeaveProject} from './LeaveProject';
import {useLeaveProject, useManyProjects} from '@comapeo/core-react';
import {useOrganizations} from '../../hooks/organization/useOrganizations';
import type {ReconstructedOrganization} from '../../lib/organization/reconstruct';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

jest.mock('@comapeo/core-react', () => ({
  useLeaveProject: jest.fn(),
  useManyProjects: jest.fn(),
}));

jest.mock('../../hooks/server/projects', () => ({
  useProjectSettings: jest.fn(),
}));

import {useProjectSettings} from '../../hooks/server/projects';

jest.mock('../../contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({projectId: mockLeftProjectId, projectApi: {}}),
}));

jest.mock('../../contexts/ActiveProjectIdStoreContext', () => ({
  useActiveProjectIdActions: () => ({
    setActiveProjectId: mockSetActiveProjectId,
    clearActiveProjectId: mockClearActiveProjectId,
  }),
}));

jest.mock('../../hooks/organization/useOrganizations', () => ({
  useOrganizations: jest.fn(),
}));

const mockLeftProjectId = 'project-left';
const mockSurvivingSlotId = 'project-surviving';
const mockOtherProjectId = 'project-other';

const mockSetActiveProjectId = jest.fn();
const mockClearActiveProjectId = jest.fn();
const mockLeaveMutate = jest.fn();

const useOrganizationsMock = useOrganizations as jest.Mock;
const useManyProjectsMock = useManyProjects as jest.Mock;
const useLeaveProjectMock = useLeaveProject as jest.Mock;

function mockProjectList(projectIds: string[]) {
  useManyProjectsMock.mockReturnValue({
    data: projectIds.map(projectId => ({
      projectId,
      name: projectId === mockLeftProjectId ? undefined : `Name ${projectId}`,
    })),
  });
}

function mockOrganizations(organizations: ReconstructedOrganization[]) {
  useOrganizationsMock.mockReturnValue(organizations);
}

const Stack = createNativeStackNavigator<AppStackParamsList>();

const HomeStub = () => <Text>HOME-REACHED</Text>;
const SuccessStub = () => <Text>SUCCESS-REACHED</Text>;
const LeftConfirmationStub = ({
  route,
}: {
  route: {params: {projectName: string}};
}) => <Text>LEFT-{route.params.projectName}</Text>;

async function renderScreen() {
  await render(
    <IntlProvider locale="en" messages={{}}>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="LeaveProject">
          <Stack.Screen name="Home" component={HomeStub} />
          <Stack.Screen name="Success" component={SuccessStub} />
          <Stack.Screen
            name="LeaveProject"
            component={LeaveProject}
            initialParams={{memberType: 'coordinator'}}
          />
          <Stack.Screen
            name="LeftProjectConfirmation"
            component={LeftConfirmationStub}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </IntlProvider>,
  );
}

const useProjectSettingsMock = useProjectSettings as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  useProjectSettingsMock.mockReturnValue({data: {name: 'Projeto X'}});
  useManyProjectsMock.mockReturnValue({data: []});
  useOrganizationsMock.mockReturnValue([]);
  useLeaveProjectMock.mockReturnValue({
    // The screen's logic lives in the onSuccess handler — run it inline.
    mutate: mockLeaveMutate.mockImplementation((_vars, opts) => {
      opts.onSuccess();
    }),
    reset: jest.fn(),
    status: 'idle',
    error: undefined,
  });
});

describe('LeaveProject', () => {
  test('an org project with a surviving slot activates it', async () => {
    mockOrganizations([
      {
        state: 'ready',
        organizationId: 'a1b2c3d4e5f60718',
        organizationName: 'Org Um',
        slots: {m: mockLeftProjectId, a: mockSurvivingSlotId},
      },
    ]);
    await renderScreen();

    await userEvent.press(screen.getByText('Yes, Leave'));

    expect(mockLeaveMutate).toHaveBeenCalledWith(
      {projectId: mockLeftProjectId},
      expect.anything(),
    );
    expect(mockSetActiveProjectId).toHaveBeenCalledWith(mockSurvivingSlotId);
    expect(mockClearActiveProjectId).not.toHaveBeenCalled();
    expect(await screen.findByText('LEFT-Projeto X')).toBeOnTheScreen();
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

    await userEvent.press(screen.getByText('Yes, Leave'));

    expect(mockClearActiveProjectId).toHaveBeenCalledTimes(1);
    expect(mockSetActiveProjectId).not.toHaveBeenCalled();
    // SPEC 10.1: the startup gate's organization fork is the landing.
    expect(await screen.findByText('SUCCESS-REACHED')).toBeOnTheScreen();
  });

  test('a non-org project switches to any remaining project', async () => {
    mockProjectList([mockLeftProjectId, mockOtherProjectId]);
    await renderScreen();

    await userEvent.press(screen.getByText('Yes, Leave'));

    expect(mockSetActiveProjectId).toHaveBeenCalledWith(mockOtherProjectId);
    expect(mockClearActiveProjectId).not.toHaveBeenCalled();
  });

  test('a non-org project with nothing remaining clears the active id and resets to the org fork', async () => {
    mockProjectList([mockLeftProjectId]);
    await renderScreen();

    await userEvent.press(screen.getByText('Yes, Leave'));

    expect(mockClearActiveProjectId).toHaveBeenCalledTimes(1);
    expect(mockSetActiveProjectId).not.toHaveBeenCalled();
    expect(await screen.findByText('SUCCESS-REACHED')).toBeOnTheScreen();
  });
});
