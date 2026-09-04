import {act, renderHook} from '@testing-library/react-native';
import React, {type ReactNode} from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import {ComapeoCoreProvider} from '@comapeo/core-react';

import {membersQueryKey} from '../../lib/organization/queryKeys';
import {useAddRemoteArchiveToOrganization} from './useAddRemoteArchiveToOrganization';

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

    await act(async () => {
      await hook.result.current.start({slots: SLOTS, baseUrl: BASE_URL});
    });

    expect(addMonitoramento).toHaveBeenCalledWith(BASE_URL);
    expect(addAlertas).toHaveBeenCalledWith(BASE_URL);
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
    const addMonitoramento = jest.fn();
    const addAlertas = jest.fn().mockRejectedValue(new Error('NETWORK_ERROR'));
    addServerPeerByProject.set(MONITORAMENTO_PROJECT_ID, addMonitoramento);
    addServerPeerByProject.set(ALERTAS_PROJECT_ID, addAlertas);
    const {wrapper, invalidateQueries} = createSpiedWrapper(clientApi);

    const hook = await renderHook(() => useAddRemoteArchiveToOrganization(), {
      wrapper,
    });

    await act(async () => {
      await hook.result.current.start({slots: SLOTS, baseUrl: BASE_URL});
    });

    expect(addMonitoramento).toHaveBeenCalledWith(BASE_URL);
    expect(addAlertas).toHaveBeenCalledWith(BASE_URL);
    expect(hook.result.current.progress.monitoramento).toBe('done');
    expect(hook.result.current.progress.alertas).toBe('error');
    expect(hook.result.current.progress.error).toBeInstanceOf(Error);
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
});
