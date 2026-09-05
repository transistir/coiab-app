import * as React from 'react';
import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {AddRemoteArchive} from './AddRemoteArchive';
import {useAddServerPeer} from '@comapeo/core-react';
import {useFindRemoteArchive} from '../../hooks/server/projects';
import {useOrganizations} from '../../hooks/organization/useOrganizations';
import {useAddRemoteArchiveToOrganization} from '../../hooks/organization/useAddRemoteArchiveToOrganization';
import type {ReconstructedOrganization} from '../../lib/organization/reconstruct';

jest.mock('@comapeo/core-react', () => ({
  useAddServerPeer: jest.fn(),
}));

jest.mock('../../hooks/server/projects', () => ({
  useFindRemoteArchive: jest.fn(),
}));

jest.mock('../../hooks/organization/useOrganizations', () => ({
  useOrganizations: jest.fn(),
}));

jest.mock('../../hooks/organization/useAddRemoteArchiveToOrganization', () => ({
  useAddRemoteArchiveToOrganization: jest.fn(),
}));

jest.mock('../../contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({projectId: mockActiveProjectId, projectApi: {}}),
}));

jest.mock('../../contexts/ActiveProjectIdStoreContext', () => ({
  useActiveProjectId: () => mockActiveProjectId,
}));

// Both SearchUrl and AddFoundArchive drive navigation through this object;
// AddRemoteArchive itself receives it as the navigation prop.
jest.mock('../../hooks/useNavigationWithTypes', () => ({
  useNavigationFromRoot: () => mockNavigation,
}));

let mockActiveProjectId = 'project-monitoramento';

const mockNavigation: {
  navigate: jest.Mock;
  goBack: jest.Mock;
  setOptions: jest.Mock;
  addListener: jest.Mock;
} = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  setOptions: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
};

const mutate = jest.fn();
const orgStart = jest.fn();

const useAddServerPeerMock = useAddServerPeer as jest.Mock;
const useFindRemoteArchiveMock = useFindRemoteArchive as jest.Mock;
const useOrganizationsMock = useOrganizations as jest.Mock;
const useAddRemoteArchiveMock = useAddRemoteArchiveToOrganization as jest.Mock;

// Value "returned" by the (mocked) archive lookup once a URL was submitted.
let foundArchiveName: string | undefined;

const READY_ORG: ReconstructedOrganization = {
  state: 'ready',
  organizationId: 'a1b2c3d4e5f60718',
  organizationName: 'Org Um',
  slots: {m: 'project-monitoramento', a: 'project-alertas'},
};

const INCOMPLETE_ORG: ReconstructedOrganization = {
  state: 'incomplete',
  organizationId: 'a1b2c3d4e5f60718',
  organizationName: 'Org Um',
  // Only monitoramento exists locally so far; the org cannot fan out.
  slots: {m: 'project-monitoramento'},
};

function mockCoreReact({serverPeerStatus = 'idle'} = {}) {
  useAddServerPeerMock.mockReturnValue({mutate, status: serverPeerStatus});
  useFindRemoteArchiveMock.mockImplementation(({url}: {url?: string}) => ({
    isLoading: false,
    data: url ? foundArchiveName : undefined,
    isError: false,
  }));
}

function mockOrganizations(organizations: ReconstructedOrganization[]) {
  useOrganizationsMock.mockReturnValue(organizations);
}

function mockOrgArchive({
  busy = false,
  error,
}: {busy?: boolean; error?: unknown} = {}) {
  orgStart.mockResolvedValue({error});
  useAddRemoteArchiveMock.mockReturnValue({
    progress: {monitoramento: 'idle', alertas: 'idle'},
    busy,
    start: orgStart,
    reset: jest.fn(),
  });
}

function renderScreen() {
  return render(
    <IntlProvider locale="en" messages={{}}>
      <AddRemoteArchive
        navigation={mockNavigation as never}
        route={{key: 'AddRemoteArchive', name: 'AddRemoteArchive'} as never}
      />
    </IntlProvider>,
  );
}

type HeaderOptions = {
  headerRight?: () => React.ReactElement<{onPress: () => unknown}> | null;
};

/** Types a URL, then presses the header save button that looks it up. */
async function findArchive() {
  foundArchiveName = 'Archive A';
  const user = userEvent.setup();
  await user.type(
    screen.getByTestId('RA.url-inp'),
    'https://archive.example.com',
  );

  const options = mockNavigation.setOptions.mock.calls
    .map(([opts]) => opts as HeaderOptions)
    .reverse()
    .find(
      opts =>
        typeof opts.headerRight === 'function' && opts.headerRight() !== null,
    )!;

  await act(async () => {
    // handleSubmit is async — awaiting it inside act keeps its validation
    // microtasks from leaking into the next test's act scope.
    await options.headerRight!()!.props.onPress();
  });

  await waitFor(() => {
    expect(screen.getByText('You are adding:')).toBeOnTheScreen();
  });
}

async function pressAdd() {
  const user = userEvent.setup();
  await user.press(screen.getByText('+ Add Remote Archive'));
}

function lastBeforeRemoveListener() {
  const calls = mockNavigation.addListener.mock.calls.filter(
    ([event]) => event === 'beforeRemove',
  );
  return calls.at(-1)![1] as (e: {preventDefault: () => void}) => void;
}

beforeEach(() => {
  jest.clearAllMocks();
  foundArchiveName = undefined;
  mockActiveProjectId = 'project-monitoramento';
  mockCoreReact();
  mockOrganizations([]);
  mockOrgArchive();
});

describe('AddRemoteArchive', () => {
  test('org active project: submit fans out to both slots, not the legacy mutate', async () => {
    mockOrganizations([READY_ORG]);
    orgStart.mockResolvedValue({error: undefined});
    await renderScreen();
    await findArchive();

    expect(
      screen.getByText(
        'This archive will be added to both projects of the Organization.',
      ),
    ).toBeOnTheScreen();

    await pressAdd();

    await waitFor(() => {
      expect(orgStart).toHaveBeenCalledWith({
        slots: {m: 'project-monitoramento', a: 'project-alertas'},
        baseUrl: 'https://archive.example.com/',
      });
    });
    expect(mutate).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).toHaveBeenCalledWith(
      'SuccessfullyAddedArchive',
      {archiveName: 'Archive A', url: 'https://archive.example.com/'},
    );
  });

  test('org membership via slot a fans out to the same two slots', async () => {
    mockActiveProjectId = 'project-alertas';
    mockOrganizations([READY_ORG]);
    orgStart.mockResolvedValue({error: undefined});
    await renderScreen();
    await findArchive();

    await pressAdd();

    await waitFor(() => {
      expect(orgStart).toHaveBeenCalledWith({
        slots: {m: 'project-monitoramento', a: 'project-alertas'},
        baseUrl: 'https://archive.example.com/',
      });
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  test('partial failure (one slot done, one error) navigates to the error sheet', async () => {
    mockOrganizations([READY_ORG]);
    orgStart.mockResolvedValue({error: new Error('second slot failed')});
    await renderScreen();
    await findArchive();

    await pressAdd();

    await waitFor(() => {
      expect(mockNavigation.navigate).toHaveBeenCalledWith(
        'ErrorBottomSheet',
        expect.objectContaining({error: expect.any(Error)}),
      );
    });
    expect(mockNavigation.navigate).not.toHaveBeenCalledWith(
      'SuccessfullyAddedArchive',
      expect.anything(),
    );
  });

  test('non-org active project keeps the single-project path', async () => {
    mockActiveProjectId = 'project-standalone';
    mutate.mockImplementation((_vars: unknown, opts: {onSuccess: () => void}) =>
      opts.onSuccess(),
    );
    await renderScreen();
    await findArchive();

    expect(
      screen.queryByText(
        'This archive will be added to both projects of the Organization.',
      ),
    ).not.toBeOnTheScreen();

    await pressAdd();

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        {baseUrl: 'https://archive.example.com/'},
        expect.objectContaining({onSuccess: expect.any(Function)}),
      );
    });
    // The single-project add targets the active project itself — the same
    // id the active-project store reports.
    expect(useAddServerPeerMock).toHaveBeenCalledWith({
      projectId: 'project-standalone',
    });
    expect(orgStart).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).toHaveBeenCalledWith(
      'SuccessfullyAddedArchive',
      {archiveName: 'Archive A', url: 'https://archive.example.com/'},
    );
  });

  test('active project in an INCOMPLETE organization keeps the single-project path', async () => {
    mockActiveProjectId = 'project-monitoramento';
    mockOrganizations([INCOMPLETE_ORG]);
    mutate.mockImplementation((_vars: unknown, opts: {onSuccess: () => void}) =>
      opts.onSuccess(),
    );
    await renderScreen();
    await findArchive();

    // The fan-out needs both slots present; until the org is ready, the
    // active project stays on the legacy single-project add.
    expect(
      screen.queryByText(
        'This archive will be added to both projects of the Organization.',
      ),
    ).not.toBeOnTheScreen();

    await pressAdd();

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        {baseUrl: 'https://archive.example.com/'},
        expect.objectContaining({onSuccess: expect.any(Function)}),
      );
    });
    expect(useAddServerPeerMock).toHaveBeenCalledWith({
      projectId: 'project-monitoramento',
    });
    expect(orgStart).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).toHaveBeenCalledWith(
      'SuccessfullyAddedArchive',
      {archiveName: 'Archive A', url: 'https://archive.example.com/'},
    );
  });

  test('beforeRemove is prevented while the org fan-out is pending', async () => {
    mockOrganizations([READY_ORG]);
    mockOrgArchive({busy: true});
    await renderScreen();
    await findArchive();

    // The dock shows the loader, not the add button, while the fan-out runs.
    expect(screen.queryByText('+ Add Remote Archive')).not.toBeOnTheScreen();

    const preventDefault = jest.fn();
    await act(async () => {
      lastBeforeRemoveListener()({preventDefault});
    });
    expect(preventDefault).toHaveBeenCalled();
  });

  test('beforeRemove is not prevented when the org fan-out is idle', async () => {
    mockOrganizations([READY_ORG]);
    mockOrgArchive({busy: false});
    await renderScreen();
    await findArchive();

    const preventDefault = jest.fn();
    await act(async () => {
      lastBeforeRemoveListener()({preventDefault});
    });
    expect(preventDefault).not.toHaveBeenCalled();
  });

  test('beforeRemove is prevented while the legacy single-project add is pending', async () => {
    mockOrganizations([]);
    mockCoreReact({serverPeerStatus: 'pending'});
    await renderScreen();
    await findArchive();

    expect(screen.queryByText('+ Add Remote Archive')).not.toBeOnTheScreen();

    const preventDefault = jest.fn();
    await act(async () => {
      lastBeforeRemoveListener()({preventDefault});
    });
    expect(preventDefault).toHaveBeenCalled();
  });
});
