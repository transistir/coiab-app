import {act, renderHook, waitFor} from '@testing-library/react-native';
import React, {type ReactNode} from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import {ComapeoCoreProvider} from '@comapeo/core-react';

import {MapeoApiWrapper} from '../../../../tests/integration/helpers/MapeoApiWrapper';
import {COORDINATOR_ROLE_ID} from '../../sharedTypes';
import {
  invitesQueryKey,
  membersQueryKey,
} from '../../lib/organization/queryKeys';
import {useInviteToOrganization} from './useInviteToOrganization';

const DEVICE_ID = 'device-1';
const MONITORAMENTO_PROJECT_ID = 'project-monitoramento';
const ALERTAS_PROJECT_ID = 'project-alertas';
const SLOTS = {
  m: MONITORAMENTO_PROJECT_ID,
  a: ALERTAS_PROJECT_ID,
} as const;

/** The `AbortSignal.timeout()` DOMException core's invite wait aborts with. */
function timeoutError() {
  const error = new Error('The operation was aborted due to timeout');
  error.name = 'TimeoutError';
  return error;
}

function createFakeClient() {
  const inviteByProject = new Map<string, ReturnType<typeof jest.fn>>();
  const clientApi = {
    getProject: async (projectId: string) => {
      let invite = inviteByProject.get(projectId);
      if (!invite) {
        invite = jest.fn();
        inviteByProject.set(projectId, invite);
      }
      return {$member: {invite}};
    },
    listProjects: async () => [],
    invite: {addListener: jest.fn(), removeListener: jest.fn()},
    on: jest.fn(),
  };
  return {
    clientApi: clientApi as unknown as ComapeoCoreClientApi,
    inviteByProject,
  };
}

function createWrapper(clientApi: ComapeoCoreClientApi) {
  return ({children}: {children: ReactNode}) => (
    <MapeoApiWrapper mapeoApi={clientApi}>{children}</MapeoApiWrapper>
  );
}

/**
 * Like `MapeoApiWrapper`, but owning (and spying on) its query client, so
 * the tests can assert the per-slot cache invalidation the hook performs —
 * the member and invite lists are refreshed through core-react's react-query
 * cache.
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

describe('useInviteToOrganization', () => {
  test('sends to both slots concurrently and aggregates a mixed outcome', async () => {
    const {clientApi, inviteByProject} = createFakeClient();
    let resolveMonitoramento!: (decision: string) => void;
    let rejectAlertas!: (error: unknown) => void;
    const inviteMonitoramento = jest.fn(
      () =>
        new Promise<string>(resolve => {
          resolveMonitoramento = resolve;
        }),
    );
    const inviteAlertas = jest.fn(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectAlertas = reject;
        }),
    );
    inviteByProject.set(MONITORAMENTO_PROJECT_ID, inviteMonitoramento);
    inviteByProject.set(ALERTAS_PROJECT_ID, inviteAlertas);

    const hook = await renderHook(() => useInviteToOrganization(), {
      wrapper: createWrapper(clientApi),
    });

    let startPromise!: Promise<void>;
    await act(async () => {
      startPromise = hook.result.current.start({
        slots: SLOTS,
        deviceId: DEVICE_ID,
        roleId: COORDINATOR_ROLE_ID,
      });
    });

    await waitFor(() => {
      expect(hook.result.current.progress.monitoramento).toBe('sending');
      expect(hook.result.current.progress.alertas).toBe('sending');
    });
    expect(inviteMonitoramento).toHaveBeenCalledWith(DEVICE_ID, {
      roleId: COORDINATOR_ROLE_ID,
    });
    expect(inviteAlertas).toHaveBeenCalledWith(DEVICE_ID, {
      roleId: COORDINATOR_ROLE_ID,
    });

    // One slot accepted, the other never answered — the accepted slot is
    // not lost.
    await act(async () => {
      resolveMonitoramento('ACCEPT');
      rejectAlertas(timeoutError());
      await startPromise;
    });

    expect(hook.result.current.progress.monitoramento).toBe('accepted');
    expect(hook.result.current.progress.alertas).toBe('timeout');
    expect(hook.result.current.busy).toBe(false);

    hook.unmount();
  });

  test('retryFailed re-sends only the timed-out slot; ALREADY counts as accepted', async () => {
    const {clientApi, inviteByProject} = createFakeClient();
    const inviteMonitoramento = jest.fn().mockResolvedValue('ACCEPT');
    const inviteAlertas = jest.fn().mockRejectedValueOnce(timeoutError());
    inviteByProject.set(MONITORAMENTO_PROJECT_ID, inviteMonitoramento);
    inviteByProject.set(ALERTAS_PROJECT_ID, inviteAlertas);

    const hook = await renderHook(() => useInviteToOrganization(), {
      wrapper: createWrapper(clientApi),
    });

    await act(async () => {
      await hook.result.current.start({
        slots: SLOTS,
        deviceId: DEVICE_ID,
        roleId: COORDINATOR_ROLE_ID,
      });
    });

    expect(hook.result.current.progress.monitoramento).toBe('accepted');
    expect(hook.result.current.progress.alertas).toBe('timeout');

    // The device had already joined: the retry resolves with ALREADY.
    inviteAlertas.mockResolvedValueOnce('ALREADY');
    await act(async () => {
      await hook.result.current.retryFailed();
    });

    expect(inviteMonitoramento).toHaveBeenCalledTimes(1);
    expect(inviteAlertas).toHaveBeenCalledTimes(2);
    expect(hook.result.current.progress.monitoramento).toBe('accepted');
    expect(hook.result.current.progress.alertas).toBe('accepted');

    hook.unmount();
  });

  test('a rejected slot is never re-sent; an errored one is', async () => {
    const {clientApi, inviteByProject} = createFakeClient();
    const inviteMonitoramento = jest.fn().mockResolvedValue('REJECT');
    const inviteAlertas = jest.fn().mockRejectedValueOnce(new Error('boom'));
    inviteByProject.set(MONITORAMENTO_PROJECT_ID, inviteMonitoramento);
    inviteByProject.set(ALERTAS_PROJECT_ID, inviteAlertas);

    const hook = await renderHook(() => useInviteToOrganization(), {
      wrapper: createWrapper(clientApi),
    });

    await act(async () => {
      await hook.result.current.start({
        slots: SLOTS,
        deviceId: DEVICE_ID,
        roleId: COORDINATOR_ROLE_ID,
      });
    });

    expect(hook.result.current.progress.monitoramento).toBe('rejected');
    expect(hook.result.current.progress.alertas).toBe('error');
    expect(hook.result.current.progress.error).toBeDefined();

    inviteAlertas.mockResolvedValueOnce('ACCEPT');
    await act(async () => {
      await hook.result.current.retryFailed();
    });

    expect(inviteMonitoramento).toHaveBeenCalledTimes(1);
    expect(inviteAlertas).toHaveBeenCalledTimes(2);
    expect(hook.result.current.progress.monitoramento).toBe('rejected');
    expect(hook.result.current.progress.alertas).toBe('accepted');

    hook.unmount();
  });

  test('a retry that answers every re-sent slot clears the aggregate error', async () => {
    const {clientApi, inviteByProject} = createFakeClient();
    const inviteMonitoramento = jest.fn().mockRejectedValueOnce(timeoutError());
    const inviteAlertas = jest.fn().mockRejectedValueOnce(timeoutError());
    inviteByProject.set(MONITORAMENTO_PROJECT_ID, inviteMonitoramento);
    inviteByProject.set(ALERTAS_PROJECT_ID, inviteAlertas);

    const hook = await renderHook(() => useInviteToOrganization(), {
      wrapper: createWrapper(clientApi),
    });

    await act(async () => {
      await hook.result.current.start({
        slots: SLOTS,
        deviceId: DEVICE_ID,
        roleId: COORDINATOR_ROLE_ID,
      });
    });

    expect(hook.result.current.progress.monitoramento).toBe('timeout');
    expect(hook.result.current.progress.alertas).toBe('timeout');
    expect(hook.result.current.progress.error).toBeDefined();

    inviteMonitoramento.mockResolvedValueOnce('ACCEPT');
    inviteAlertas.mockResolvedValueOnce('ACCEPT');
    await act(async () => {
      await hook.result.current.retryFailed();
    });

    expect(hook.result.current.progress.monitoramento).toBe('accepted');
    expect(hook.result.current.progress.alertas).toBe('accepted');
    // The error describes the LAST send only — it must not survive a
    // successful retry (SPEC 6.5).
    expect(hook.result.current.progress.error).toBeUndefined();

    hook.unmount();
  });

  test('reset while sending is a no-op; the running send still settles normally', async () => {
    const {clientApi, inviteByProject} = createFakeClient();
    let resolveMonitoramento!: (decision: string) => void;
    let resolveAlertas!: (decision: string) => void;
    const inviteMonitoramento = jest.fn(
      () =>
        new Promise<string>(resolve => {
          resolveMonitoramento = resolve;
        }),
    );
    const inviteAlertas = jest.fn(
      () =>
        new Promise<string>(resolve => {
          resolveAlertas = resolve;
        }),
    );
    inviteByProject.set(MONITORAMENTO_PROJECT_ID, inviteMonitoramento);
    inviteByProject.set(ALERTAS_PROJECT_ID, inviteAlertas);

    const hook = await renderHook(() => useInviteToOrganization(), {
      wrapper: createWrapper(clientApi),
    });

    let startPromise!: Promise<void>;
    await act(async () => {
      startPromise = hook.result.current.start({
        slots: SLOTS,
        deviceId: DEVICE_ID,
        roleId: COORDINATOR_ROLE_ID,
      });
    });

    await waitFor(() => {
      expect(hook.result.current.progress.monitoramento).toBe('sending');
      expect(hook.result.current.progress.alertas).toBe('sending');
    });
    expect(hook.result.current.busy).toBe(true);

    // A mid-flight reset changes nothing: the running send keeps its
    // outcome (its token is untouched), so busy stays true and the progress
    // is not cleared — resetting again later cannot duplicate the invites.
    await act(async () => {
      hook.result.current.reset();
    });
    expect(hook.result.current.busy).toBe(true);
    expect(hook.result.current.progress.monitoramento).toBe('sending');
    expect(hook.result.current.progress.alertas).toBe('sending');

    // The send was never cancelled, so its completion publishes normally.
    await act(async () => {
      resolveMonitoramento('ACCEPT');
      resolveAlertas('ACCEPT');
      await startPromise;
    });

    expect(hook.result.current.progress.monitoramento).toBe('accepted');
    expect(hook.result.current.progress.alertas).toBe('accepted');
    expect(hook.result.current.busy).toBe(false);

    // Idle again: a reset now clears the board.
    await act(async () => {
      hook.result.current.reset();
    });
    expect(hook.result.current.busy).toBe(false);
    expect(hook.result.current.progress.monitoramento).toBe('idle');
    expect(hook.result.current.progress.alertas).toBe('idle');

    hook.unmount();
  });

  test('each settling slot invalidates its member list and the invite cache', async () => {
    const {clientApi, inviteByProject} = createFakeClient();
    const inviteMonitoramento = jest.fn().mockResolvedValue('ACCEPT');
    const inviteAlertas = jest.fn().mockRejectedValueOnce(timeoutError());
    inviteByProject.set(MONITORAMENTO_PROJECT_ID, inviteMonitoramento);
    inviteByProject.set(ALERTAS_PROJECT_ID, inviteAlertas);
    const {wrapper, invalidateQueries} = createSpiedWrapper(clientApi);

    const hook = await renderHook(() => useInviteToOrganization(), {wrapper});

    await act(async () => {
      await hook.result.current.start({
        slots: SLOTS,
        deviceId: DEVICE_ID,
        roleId: COORDINATOR_ROLE_ID,
      });
    });

    expect(hook.result.current.progress.monitoramento).toBe('accepted');
    expect(hook.result.current.progress.alertas).toBe('timeout');
    // Per core-react's own useSendInvite: the member list of each touched
    // project AND the invite list are invalidated as each slot settles —
    // a slot that timed out still refreshed the caches.
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: membersQueryKey(MONITORAMENTO_PROJECT_ID),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: membersQueryKey(ALERTAS_PROJECT_ID),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: invitesQueryKey,
    });

    hook.unmount();
  });
});
