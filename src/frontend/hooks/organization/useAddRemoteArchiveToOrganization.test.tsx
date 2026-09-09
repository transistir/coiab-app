import {act, renderHook} from '@testing-library/react-native';
import React, {type ReactNode} from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import {ComapeoCoreProvider} from '@comapeo/core-react';

import {membersQueryKey} from '../../lib/organization/queryKeys';
import {
  useAddRemoteArchiveToOrganization,
  type AddRemoteArchiveOutcome,
} from './useAddRemoteArchiveToOrganization';

const MONITORAMENTO_PROJECT_ID = 'project-monitoramento';
const ALERTAS_PROJECT_ID = 'project-alertas';
const SLOTS = {
  m: MONITORAMENTO_PROJECT_ID,
  a: ALERTAS_PROJECT_ID,
} as const;
const BASE_URL = 'http://localhost:9999';

function createFakeClient() {
  const addServerPeerByProject = new Map<string, ReturnType<typeof jest.fn>>();
  const clientApi = {
    getProject: async (projectId: string) => {
      let addServerPeer = addServerPeerByProject.get(projectId);
      if (!addServerPeer) {
        addServerPeer = jest.fn();
        addServerPeerByProject.set(projectId, addServerPeer);
      }
      return {$member: {addServerPeer}};
    },
    listProjects: async () => [],
    invite: {addListener: jest.fn(), removeListener: jest.fn()},
    on: jest.fn(),
  };
  return {
    clientApi: clientApi as unknown as ComapeoCoreClientApi,
    addServerPeerByProject,
  };
}

/**
 * Like `MapeoApiWrapper`, but owning (and spying on) its query client, so
 * the tests can assert the per-slot cache invalidation the hook performs —
 * the member lists are refreshed through core-react's react-query cache.
 */
function createSpiedWrapper(clientApi: ComapeoCoreClientApi) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {gcTime: Infinity},
      mutations: {gcTime: Infinity},
    },
  });
  const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
  // Mock map server API for tests (mirrors MapeoApiWrapper).
  const getMapServerBaseUrl = async () => new URL('http://localhost:8080');
  const mockFetch = async () => ({}) as Response;
  return {
    wrapper: ({children}: {children: ReactNode}) => (
      <QueryClientProvider client={queryClient}>
        <ComapeoCoreProvider
          clientApi={clientApi}
          getMapServerBaseUrl={getMapServerBaseUrl}
          fetch={mockFetch}
          queryClient={queryClient}>
          {children}
        </ComapeoCoreProvider>
      </QueryClientProvider>
    ),
    invalidateQueries,
  };
}

describe('useAddRemoteArchiveToOrganization', () => {
  test('adds the server to both organization projects', async () => {
    const {clientApi, addServerPeerByProject} = createFakeClient();
    const addMonitoramento = jest.fn();
    const addAlertas = jest.fn();
    addServerPeerByProject.set(MONITORAMENTO_PROJECT_ID, addMonitoramento);
    addServerPeerByProject.set(ALERTAS_PROJECT_ID, addAlertas);
    const {wrapper, invalidateQueries} = createSpiedWrapper(clientApi);

    const hook = await renderHook(() => useAddRemoteArchiveToOrganization(), {
      wrapper,
    });

    let outcome: AddRemoteArchiveOutcome;
    await act(async () => {
      outcome = await hook.result.current.start({
        slots: SLOTS,
        baseUrl: BASE_URL,
      });
    });

    expect(addMonitoramento).toHaveBeenCalledWith(BASE_URL);
    expect(addAlertas).toHaveBeenCalledWith(BASE_URL);
    // Success resolves with no error for the caller to navigate on.
    expect(outcome).toEqual({error: undefined});
    expect(hook.result.current.progress.monitoramento).toBe('done');
    expect(hook.result.current.progress.alertas).toBe('done');
    expect(hook.result.current.progress.error).toBeUndefined();
    expect(hook.result.current.busy).toBe(false);
    // The member cache of each touched project is invalidated (J2) — these
    // are the exact keys core-react's member queries subscribe to.
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: membersQueryKey(MONITORAMENTO_PROJECT_ID),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: membersQueryKey(ALERTAS_PROJECT_ID),
    });

    hook.unmount();
  });

  test('one failing slot does not abort the other', async () => {
    const {clientApi, addServerPeerByProject} = createFakeClient();
    const alertasError = new Error('NETWORK_ERROR');
    const addMonitoramento = jest.fn();
    const addAlertas = jest.fn().mockRejectedValue(alertasError);
    addServerPeerByProject.set(MONITORAMENTO_PROJECT_ID, addMonitoramento);
    addServerPeerByProject.set(ALERTAS_PROJECT_ID, addAlertas);
    const {wrapper, invalidateQueries} = createSpiedWrapper(clientApi);

    const hook = await renderHook(() => useAddRemoteArchiveToOrganization(), {
      wrapper,
    });

    let outcome: AddRemoteArchiveOutcome;
    await act(async () => {
      outcome = await hook.result.current.start({
        slots: SLOTS,
        baseUrl: BASE_URL,
      });
    });

    expect(addMonitoramento).toHaveBeenCalledWith(BASE_URL);
    expect(addAlertas).toHaveBeenCalledWith(BASE_URL);
    expect(hook.result.current.progress.monitoramento).toBe('done');
    expect(hook.result.current.progress.alertas).toBe('error');
    // The resolved outcome carries the failed slot's error, so the surface
    // can report the partial failure without digging into `progress`.
    expect(outcome).toEqual({error: alertasError});
    expect(hook.result.current.progress.error).toBe(alertasError);
    // Both slots settle (the failure included) and each invalidates its own
    // member cache as it settles — not only at the end of the fan-out.
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: membersQueryKey(MONITORAMENTO_PROJECT_ID),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: membersQueryKey(ALERTAS_PROJECT_ID),
    });

    hook.unmount();
  });

  test('total failure resolves with the first slot error in fan-out order', async () => {
    const {clientApi, addServerPeerByProject} = createFakeClient();
    const monitoramentoError = new Error('M_BOOM');
    const alertasError = new Error('A_BOOM');
    addServerPeerByProject.set(
      MONITORAMENTO_PROJECT_ID,
      jest.fn().mockRejectedValue(monitoramentoError),
    );
    addServerPeerByProject.set(
      ALERTAS_PROJECT_ID,
      jest.fn().mockRejectedValue(alertasError),
    );
    const {wrapper} = createSpiedWrapper(clientApi);

    const hook = await renderHook(() => useAddRemoteArchiveToOrganization(), {
      wrapper,
    });

    let outcome: AddRemoteArchiveOutcome;
    await act(async () => {
      outcome = await hook.result.current.start({
        slots: SLOTS,
        baseUrl: BASE_URL,
      });
    });

    // `error` is the FIRST slot error (monitoramento, the first slot in the
    // fan-out), not an aggregate; per-slot detail stays in `progress`.
    expect(outcome).toEqual({error: monitoramentoError});
    expect(outcome!.error).not.toBe(alertasError);
    expect(hook.result.current.progress.monitoramento).toBe('error');
    expect(hook.result.current.progress.alertas).toBe('error');
    expect(hook.result.current.progress.error).toBe(monitoramentoError);
    expect(hook.result.current.busy).toBe(false);

    hook.unmount();
  });

  test('a second start while busy is superseded and resolves undefined', async () => {
    const {clientApi, addServerPeerByProject} = createFakeClient();
    let releaseMonitoramento!: () => void;
    const blocked = new Promise<void>(resolve => {
      releaseMonitoramento = resolve;
    });
    // First slot hangs until released, keeping the first attempt in flight.
    addServerPeerByProject.set(
      MONITORAMENTO_PROJECT_ID,
      jest.fn(() => blocked),
    );
    addServerPeerByProject.set(ALERTAS_PROJECT_ID, jest.fn());
    const {wrapper} = createSpiedWrapper(clientApi);

    const hook = await renderHook(() => useAddRemoteArchiveToOrganization(), {
      wrapper,
    });

    let first!: Promise<AddRemoteArchiveOutcome>;
    let second!: Promise<AddRemoteArchiveOutcome>;
    await act(async () => {
      // busyRef flips synchronously inside the first call, so this second
      // call hits the re-entry guard before any rerender.
      first = hook.result.current.start({slots: SLOTS, baseUrl: BASE_URL});
      second = hook.result.current.start({slots: SLOTS, baseUrl: BASE_URL});
    });
    await expect(second).resolves.toBeUndefined();

    releaseMonitoramento();
    let firstOutcome: AddRemoteArchiveOutcome;
    await act(async () => {
      firstOutcome = await first;
    });

    // The running attempt settles normally despite the concurrent call.
    expect(firstOutcome).toEqual({error: undefined});
    expect(hook.result.current.busy).toBe(false);
    // The superseded attempt never reached the projects.
    expect(
      addServerPeerByProject.get(MONITORAMENTO_PROJECT_ID),
    ).toHaveBeenCalledTimes(1);
    expect(
      addServerPeerByProject.get(ALERTAS_PROJECT_ID),
    ).toHaveBeenCalledTimes(1);

    hook.unmount();
  });
});
