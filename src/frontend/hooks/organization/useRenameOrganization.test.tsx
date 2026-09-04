import {act, renderHook} from '@testing-library/react-native';

import {
  projectSettingsQueryKey,
  projectsQueryKey,
} from '../../lib/organization/queryKeys';
import {renameOrganization} from '../../lib/organization/fanout';
import {useRenameOrganization} from './useRenameOrganization';

jest.mock('@comapeo/core-react', () => ({
  // The hook only forwards it to the mocked fan-out.
  useClientApi: () => ({}),
}));

const mockInvalidateQueries = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({invalidateQueries: mockInvalidateQueries}),
}));

jest.mock('../../lib/organization/fanout', () => ({
  renameOrganization: jest.fn(),
}));

const renameOrganizationMock = renameOrganization as jest.Mock;

const ARGS = {
  organizationId: 'a1b2c3d4e5f60718',
  newName: 'Acme Renomeada',
  slots: {m: 'project-m', a: 'project-a'},
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(res => {
    resolve = res;
  });
  return {promise, resolve};
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInvalidateQueries.mockResolvedValue(undefined);
  renameOrganizationMock.mockResolvedValue(undefined);
});

describe('useRenameOrganization', () => {
  test('a second overlapping start is a no-op — only one fan-out runs', async () => {
    const gate = deferred();
    renameOrganizationMock.mockReturnValue(gate.promise);

    const hook = await renderHook(() => useRenameOrganization());

    // RNTL 14's act always returns a thenable — never fire-and-forget it.
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = hook.result.current.rename(ARGS);
      second = hook.result.current.rename(ARGS);
    });

    // The second start hit the busy guard: one fan-out, still renaming.
    expect(renameOrganizationMock).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe('renaming');

    gate.resolve();
    await act(async () => {
      await first;
      await second;
    });

    expect(renameOrganizationMock).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe('success');
    expect(hook.result.current.error).toBeUndefined();

    hook.unmount();
  });

  test('reset while busy is inert — the running attempt settles normally', async () => {
    const gate = deferred();
    renameOrganizationMock.mockReturnValue(gate.promise);

    const hook = await renderHook(() => useRenameOrganization());

    let running!: Promise<void>;
    await act(async () => {
      running = hook.result.current.rename(ARGS);
    });
    await act(async () => {
      hook.result.current.reset();
    });

    // The mid-flight reset changed nothing: the attempt keeps its token.
    expect(hook.result.current.status).toBe('renaming');

    gate.resolve();
    await act(async () => {
      await running;
    });

    // The attempt still settles normally and clears its own busy flag.
    expect(hook.result.current.status).toBe('success');

    hook.unmount();
  });

  test('publishes success only after the cache invalidations settle', async () => {
    const fanoutGate = deferred();
    renameOrganizationMock.mockReturnValue(fanoutGate.promise);
    let release!: () => void;
    const invalidationGate = new Promise<void>(res => {
      release = res;
    });
    mockInvalidateQueries.mockImplementation(() => invalidationGate);

    const hook = await renderHook(() => useRenameOrganization());

    let running!: Promise<void>;
    await act(async () => {
      running = hook.result.current.rename(ARGS);
    });
    expect(hook.result.current.status).toBe('renaming');
    expect(mockInvalidateQueries).not.toHaveBeenCalled();

    fanoutGate.resolve();
    await act(async () => {
      await Promise.resolve();
    });

    // Fan-out done, invalidations in flight — still no terminal status.
    expect(mockInvalidateQueries).toHaveBeenCalled();
    expect(hook.result.current.status).toBe('renaming');

    release();
    await act(async () => {
      await running;
    });

    // Publication is LAST: success lands only once invalidations settled.
    expect(hook.result.current.status).toBe('success');

    const keys = mockInvalidateQueries.mock.calls.map(
      call => (call[0] as {queryKey?: unknown})?.queryKey,
    );
    expect(keys).toContainEqual(projectsQueryKey);
    expect(keys).toContainEqual(projectSettingsQueryKey('project-m'));
    expect(keys).toContainEqual(projectSettingsQueryKey('project-a'));

    hook.unmount();
  });
});
