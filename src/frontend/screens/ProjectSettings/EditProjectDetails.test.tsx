import * as React from 'react';
import {act, render, screen, userEvent} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {EditProjectDetails} from './EditProjectDetails';
import {useUpdateProjectSettings} from '@comapeo/core-react';
import {useProjectRoleAndDetails} from '../../hooks/useProjectRoleAndDetails';
import {markerFor} from '../../lib/organization/marker';

jest.mock('@comapeo/core-react', () => ({
  useUpdateProjectSettings: jest.fn(),
}));

jest.mock('../../hooks/useProjectRoleAndDetails', () => ({
  useProjectRoleAndDetails: jest.fn(),
}));

// Presentational color picker row — pulls in the navigation context for its
// own focus effect, irrelevant to this screen's behavior under test.
jest.mock('../../sharedComponents/HorizontalScrollView', () => ({
  HorizontalScrollView: () => null,
}));

jest.mock('../../contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({projectId: 'project-active', projectApi: {}}),
}));

const useUpdateProjectSettingsMock = useUpdateProjectSettings as jest.Mock;
const useProjectRoleAndDetailsMock = useProjectRoleAndDetails as jest.Mock;

const ORG_ID = 'a1b2c3d4e5f60718';
const ORG_NAME = 'Org Um';
const MARKER = markerFor(ORG_ID, 'm', ORG_NAME);

const mutate = jest.fn();

function mockProjectDetails(overrides?: {
  projectDescription?: string;
  projectName?: string;
}) {
  useProjectRoleAndDetailsMock.mockReturnValue({
    role: 'coordinator',
    projectHeader: overrides?.projectName ?? 'Projeto Teste',
    projectName: overrides?.projectName ?? 'Projeto Teste',
    projectColor: '#444444',
    projectDescription: overrides?.projectDescription,
  });
}

function mockUpdateProjectSettings() {
  useUpdateProjectSettingsMock.mockReturnValue({
    mutate,
    mutateAsync: jest.fn(),
    reset: jest.fn(),
    status: 'idle',
    error: null,
    data: undefined,
    variables: undefined,
    isIdle: true,
    isPending: false,
    isSuccess: false,
    isError: false,
    isLoading: false,
  } as never);
}

/** The save action lives in the navigation header options (SaveButton). */
const navigation = {
  setOptions: jest.fn(),
  goBack: jest.fn(),
  navigate: jest.fn(),
};

function screenProps(): React.ComponentProps<typeof EditProjectDetails> {
  return {
    navigation,
    route: {key: 'EditProjectDetails', name: 'EditProjectDetails'},
  } as unknown as React.ComponentProps<typeof EditProjectDetails>;
}

async function renderScreen() {
  await render(
    <IntlProvider locale="en" messages={{}}>
      <EditProjectDetails {...screenProps()} />
    </IntlProvider>,
  );
}

async function save() {
  const lastOptions = navigation.setOptions.mock.calls.at(-1)![0] as {
    headerRight: () => React.ReactElement<{onPress: () => unknown}>;
  };
  const {onPress} = lastOptions.headerRight().props;
  await act(async () => {
    await onPress();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateProjectSettings();
});

describe('EditProjectDetails', () => {
  test('a marker project hides the description input (SPEC 4.3)', async () => {
    mockProjectDetails({projectDescription: MARKER});
    await renderScreen();

    expect(
      screen.queryByTestId('edit-project-description'),
    ).not.toBeOnTheScreen();
    expect(screen.getByTestId('edit-project-name')).toBeOnTheScreen();
  });

  test('a marker project saves the existing description unchanged', async () => {
    mockProjectDetails({projectDescription: MARKER});
    await renderScreen();

    await save();

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({
      projectColor: '#444444',
      name: 'Projeto Teste',
      projectDescription: MARKER,
    });
  });

  test('a non-marker project still offers and saves the description', async () => {
    mockProjectDetails({projectDescription: 'Plano de manejo'});
    await renderScreen();

    expect(screen.getByTestId('edit-project-description')).toBeOnTheScreen();

    const user = userEvent.setup();
    await user.type(
      screen.getByTestId('edit-project-description'),
      ' atualizado',
    );

    await save();

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({
      projectColor: '#444444',
      name: 'Projeto Teste',
      projectDescription: 'Plano de manejo atualizado',
    });
  });

  test('a non-marker project with an empty description saves it unchanged', async () => {
    mockProjectDetails({projectDescription: ''});
    await renderScreen();

    expect(screen.getByTestId('edit-project-description')).toBeOnTheScreen();

    await save();

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({
      projectColor: '#444444',
      name: 'Projeto Teste',
      projectDescription: '',
    });
  });

  test('a non-marker project with no description saves without a changed description value', async () => {
    mockProjectDetails(); // projectDescription undefined
    await renderScreen();

    expect(screen.getByTestId('edit-project-description')).toBeOnTheScreen();

    await save();

    expect(mutate).toHaveBeenCalledTimes(1);
    // The form sends `projectDescription: undefined` — never a new value.
    expect(mutate.mock.calls[0]![0].projectDescription).toBeUndefined();
    expect(mutate.mock.calls[0]![0]).toEqual({
      projectColor: '#444444',
      name: 'Projeto Teste',
    });
  });

  test('a successful save navigates back', async () => {
    mockProjectDetails({projectDescription: MARKER});
    await renderScreen();

    await save();

    mutate.mock.calls[0]![1].onSuccess();
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
