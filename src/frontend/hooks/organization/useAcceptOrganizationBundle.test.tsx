import {act, renderHook} from '@testing-library/react-native';
import React, {type ReactNode} from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import {ComapeoCoreProvider} from '@comapeo/core-react';

import {MapeoApiWrapper} from '../../../../tests/integration/helpers/MapeoApiWrapper';
import {
  ActiveProjectIdStoreProvider,
  createActiveProjectIdStore,
  useActiveProjectId,
  type ActiveProjectIdStore,
} from '../../contexts/ActiveProjectIdStoreContext';
import {
  createOrganizationInviteIdentityStore,
  OrganizationInviteIdentityStoreProvider,
  type OrganizationInviteIdentityStore,
} from '../../contexts/OrganizationInviteIdentityStoreContext';
import type {
  InviteLike,
  OrganizationInviteBundle,
} from '../../lib/organization/bundle';
import {OrganizationOperationError} from '../../lib/organization/fanout';
import {markerFor} from '../../lib/organization/marker';
import {
  invitesQueryKey,
  projectsQueryKey,
} from '../../lib/organization/queryKeys';
import {useAcceptOrganizationBundle} from './useAcceptOrganizationBundle';

const ORG_ID = 'a1b2c3d4e5f60718';
const ORG_NAME = 'Org Um';

function makeInvite(slot: 'm' | 'a', inviteId: string): InviteLike {
  return {
    inviteId,
    projectDescription: markerFor(ORG_ID, slot, ORG_NAME),
    invitorDeviceId: 'invitor-1',
    roleName: 'Coordinator',
    receivedAt: 1,
    state: 'pending',
  };
}

function makeBundle(): OrganizationInviteBundle {
  return {
    organizationId: ORG_ID,
    organizationName: ORG_NAME,
    invitorDeviceId: 'invitor-1',
    roleName: 'Coordinator',
    invites: {
      m: makeInvite('m', 'invite-m'),
      a: makeInvite('a', 'invite-a'),
    },
    allInviteIds: ['invite-m', 'invite-a'],
    completeness: 'complete',
  };
}

type FakeProject = {
  projectId: string;
  projectDescription?: string;
};

function createFakeClient(projects: FakeProject[] = []) {
  const accept = jest.fn();
  const clientApi = {
    listProjects: async () =>
      projects.map(project => ({
        ...project,
        name: 'fake',
        createdAt: '',
        updatedAt: '',
        status: 'joined' as const,
      })),
    invite: {
      accept,
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    on: jest.fn(),
  };
  return {
    clientApi: clientApi as unknown as ComapeoCoreClientApi,
    accept,
  };
}

describe('useAcceptOrganizationBundle', () => {
  let store: ActiveProjectIdStore;
  let identityStore: OrganizationInviteIdentityStore;

  beforeEach(() => {
    store = createActiveProjectIdStore();
    identityStore = createOrganizationInviteIdentityStore();
  });

  function createWrapper(clientApi: ComapeoCoreClientApi) {
    return ({children}: {children: ReactNode}) => (
      <MapeoApiWrapper mapeoApi={clientApi}>
        <ActiveProjectIdStoreProvider store={store}>
          <OrganizationInviteIdentityStoreProvider store={identityStore}>
            {children}
          </OrganizationInviteIdentityStoreProvider>
        </ActiveProjectIdStoreProvider>
      </MapeoApiWrapper>
    );
  }

  /** Like `createWrapper`, but owns its query client — and spies on it. */
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
            <ActiveProjectIdStoreProvider store={store}>
              <OrganizationInviteIdentityStoreProvider store={identityStore}>
                {children}
              </OrganizationInviteIdentityStoreProvider>
            </ActiveProjectIdStoreProvider>
          </ComapeoCoreProvider>
        </QueryClientProvider>
      ),
      invalidateQueries,
    };
  }

  test('accepts both slots and sets the monitoramento project active', async () => {
    const {clientApi, accept} = createFakeClient();
    accept
      .mockResolvedValueOnce('project-monitoramento')
      .mockResolvedValueOnce('project-alertas');

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('success');
    expect(hook.result.current.acceptBundle.error).toBeUndefined();
    expect(accept).toHaveBeenCalledTimes(2);
    expect(accept).toHaveBeenCalledWith({inviteId: 'invite-m'});
    expect(accept).toHaveBeenCalledWith({inviteId: 'invite-a'});
    expect(hook.result.current.activeProjectId).toBe('project-monitoramento');

    hook.unmount();
  });

  test('activates the pre-accepted local monitoramento project even when only slot a is accepted', async () => {
    // Slot m is already local; this accept only joins slot a (SPEC 8.2),
    // and the fresh read after the accept is stale — it still shows only
    // the pre-accept local project.
    const {clientApi, accept} = createFakeClient([
      {
        projectId: 'project-monitoramento',
        projectDescription: markerFor(ORG_ID, 'm', ORG_NAME),
      },
    ]);
    accept.mockResolvedValueOnce('project-alertas');

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('success');
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith({inviteId: 'invite-a'});
    // SPEC 8.6: the local slot-m project outranks this accept's slot-a
    // result — the entry point lands on Monitoramento even though only the
    // Alertas invite was part of THIS accept.
    expect(hook.result.current.activeProjectId).toBe('project-monitoramento');

    hook.unmount();
  });

  test('an inconsistent bundle fails without accepting anything', async () => {
    const {clientApi, accept} = createFakeClient();
    const bundle = makeBundle();
    // The slot-a invite carries a slot-m marker — rejected in preflight.
    bundle.invites.a = makeInvite('m', 'invite-a');

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(bundle);
    });

    expect(hook.result.current.acceptBundle.status).toBe('error');
    expect(hook.result.current.acceptBundle.error).toBeInstanceOf(
      OrganizationOperationError,
    );
    expect(
      (hook.result.current.acceptBundle.error as OrganizationOperationError)
        .code,
    ).toBe('slot-mismatch');
    expect(accept).not.toHaveBeenCalled();
    expect(hook.result.current.activeProjectId).toBeUndefined();

    hook.unmount();
  });

  test('a first-ever accept pins the identity, and a partial bundle fails closed on the absent slot', async () => {
    const {clientApi, accept} = createFakeClient();
    // Only slot a survived transit: with no identity yet stored, the hook
    // pins one from THIS bundle (PLAN-46 decision 6), and the absent slot
    // still fails closed before anything is accepted.
    const bundle = makeBundle();
    delete bundle.invites.m;
    bundle.completeness = 'incomplete-definitive';

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(bundle);
    });

    expect(hook.result.current.acceptBundle.status).toBe('error');
    expect(
      (hook.result.current.acceptBundle.error as OrganizationOperationError)
        .code,
    ).toBe('missing-invite');
    expect(accept).not.toHaveBeenCalled();
    expect(hook.result.current.activeProjectId).toBeUndefined();
    // The attempt still pinned the identity for a later recovery accept.
    expect(identityStore.instance.getState()).toStrictEqual({
      [ORG_ID]: {invitorDeviceId: 'invitor-1', roleName: 'Coordinator'},
    });

    hook.unmount();
  });

  test('a partial bundle diverging from the stored identity fails closed with identity-mismatch', async () => {
    const {clientApi, accept} = createFakeClient();
    identityStore.actions.setIdentity(ORG_ID, {
      invitorDeviceId: 'invitor-original',
      roleName: 'Coordinator',
    });
    // A different device re-invites only slot a: the stored identity wins,
    // so this bundle must never complete the organization.
    const bundle = makeBundle();
    delete bundle.invites.m;
    bundle.completeness = 'incomplete-definitive';

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(bundle);
    });

    expect(hook.result.current.acceptBundle.status).toBe('error');
    expect(
      (hook.result.current.acceptBundle.error as OrganizationOperationError)
        .code,
    ).toBe('identity-mismatch');
    expect(accept).not.toHaveBeenCalled();
    expect(identityStore.instance.getState()).toStrictEqual({
      [ORG_ID]: {invitorDeviceId: 'invitor-original', roleName: 'Coordinator'},
    });

    hook.unmount();
  });

  test('a failed accept keeps the pinned identity', async () => {
    const {clientApi, accept} = createFakeClient();
    accept.mockRejectedValue(new Error('network gone'));

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('error');
    expect(identityStore.instance.getState()).toStrictEqual({
      [ORG_ID]: {invitorDeviceId: 'invitor-1', roleName: 'Coordinator'},
    });

    hook.unmount();
  });

  test('a successful accept clears the identity once the organization is fully local', async () => {
    // Core's accept joins the projects, which then show up in listProjects()
    // — the fresh read the hook reconstructs from.
    const localProjects: FakeProject[] = [];
    const accept = jest.fn(async ({inviteId}: {inviteId: string}) => {
      const projectId =
        inviteId === 'invite-m' ? 'project-monitoramento' : 'project-alertas';
      localProjects.push({
        projectId,
        projectDescription: markerFor(
          ORG_ID,
          inviteId === 'invite-m' ? 'm' : 'a',
          ORG_NAME,
        ),
      });
      return projectId;
    });
    const clientApi = {
      listProjects: async () =>
        localProjects.map(project => ({
          ...project,
          name: 'fake',
          createdAt: '',
          updatedAt: '',
          status: 'joined' as const,
        })),
      invite: {accept, addListener: jest.fn(), removeListener: jest.fn()},
      on: jest.fn(),
    } as unknown as ComapeoCoreClientApi;

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('success');
    expect(identityStore.instance.getState()).toStrictEqual({});

    hook.unmount();
  });

  test('a stale fresh read still clears the identity when the pre-accept read saw the other slot', async () => {
    // P5 O4: slot a is already local BEFORE the accept; this accept joins
    // slot m; the fresh read after the accept is stale — it still shows only
    // the pre-accept slot-a project. The union of reads sees both slots, so
    // the recovery identity must be cleared anyway.
    const {clientApi, accept} = createFakeClient([
      {
        projectId: 'project-alertas',
        projectDescription: markerFor(ORG_ID, 'a', ORG_NAME),
      },
    ]);
    accept.mockResolvedValueOnce('project-monitoramento');

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('success');
    expect(accept).toHaveBeenCalledWith({inviteId: 'invite-m'});
    expect(identityStore.instance.getState()).toStrictEqual({});

    hook.unmount();
  });

  test('accepting invalidates the project and invite caches', async () => {
    const {clientApi, accept} = createFakeClient();
    accept
      .mockResolvedValueOnce('project-monitoramento')
      .mockResolvedValueOnce('project-alertas');
    const {wrapper, invalidateQueries} = createSpiedWrapper(clientApi);

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('success');
    const invalidations = invalidateQueries.mock.calls.map(
      call => call[0]?.queryKey,
    );
    expect(invalidations).toContainEqual(projectsQueryKey);
    expect(invalidations).toContainEqual(invitesQueryKey);

    hook.unmount();
  });

  test('activates the monitoramento project of the completed organization, not just of this accept', async () => {
    // Slot m was accepted in an EARLIER attempt and is already local, so
    // this accept only joins slot a (SPEC 8.2).
    const localProjects: FakeProject[] = [
      {
        projectId: 'project-monitoramento',
        projectDescription: markerFor(ORG_ID, 'm', ORG_NAME),
      },
    ];
    const accept = jest.fn(async ({inviteId}: {inviteId: string}) => {
      if (inviteId === 'invite-m') return 'project-monitoramento';
      // Core's accept joins the project, which then shows up in
      // listProjects() — the fresh read the hook reconstructs from.
      localProjects.push({
        projectId: 'project-alertas',
        projectDescription: markerFor(ORG_ID, 'a', ORG_NAME),
      });
      return 'project-alertas';
    });
    const clientApi = {
      listProjects: async () =>
        localProjects.map(project => ({
          ...project,
          name: 'fake',
          createdAt: '',
          updatedAt: '',
          status: 'joined' as const,
        })),
      invite: {accept, addListener: jest.fn(), removeListener: jest.fn()},
      on: jest.fn(),
    } as unknown as ComapeoCoreClientApi;

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('success');
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith({inviteId: 'invite-a'});
    // SPEC 8.6: the completed organization's Monitoramento project is the
    // active one, even though only slot a was part of THIS accept result.
    expect(hook.result.current.activeProjectId).toBe('project-monitoramento');

    hook.unmount();
  });

  test('an accept that rejects after core completed the join still succeeds', async () => {
    // Reject-but-completed (Bug 46): slot m's accept times out on the reply
    // while core finished the join. The accept loop recovers that slot from
    // the local read and goes on to slot a, so the org is complete and the
    // hook publishes success — not a false partial error.
    const localProjects: FakeProject[] = [];
    const accept = jest.fn(async ({inviteId}: {inviteId: string}) => {
      if (inviteId === 'invite-m') {
        localProjects.push({
          projectId: 'project-monitoramento',
          projectDescription: markerFor(ORG_ID, 'm', ORG_NAME),
        });
        throw new Error('SYNC_TIMEOUT');
      }
      localProjects.push({
        projectId: 'project-alertas',
        projectDescription: markerFor(ORG_ID, 'a', ORG_NAME),
      });
      return 'project-alertas';
    });
    const clientApi = {
      listProjects: async () =>
        localProjects.map(project => ({
          ...project,
          name: 'fake',
          createdAt: '',
          updatedAt: '',
          status: 'joined' as const,
        })),
      invite: {accept, addListener: jest.fn(), removeListener: jest.fn()},
      on: jest.fn(),
    } as unknown as ComapeoCoreClientApi;

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('success');
    expect(hook.result.current.acceptBundle.error).toBeUndefined();
    expect(accept).toHaveBeenCalledTimes(2);
    // SPEC 8.6: the org's Monitoramento slot is the active project.
    expect(hook.result.current.activeProjectId).toBe('project-monitoramento');
    // Both slots local — the recovery identity is no longer needed.
    expect(identityStore.instance.getState()).toStrictEqual({});

    hook.unmount();
  });

  test('a half-completed accept fails with accept-partial naming the missing slot', async () => {
    // Slot m's reject-but-completed join landed, but slot a's accept failed
    // for real: the org is half-joined. The published error must say exactly
    // that (typed code + the missing slots) instead of the raw timeout, so
    // the UI can route to recovery instead of reporting a total failure.
    const localProjects: FakeProject[] = [];
    const accept = jest.fn(async ({inviteId}: {inviteId: string}) => {
      if (inviteId === 'invite-m') {
        localProjects.push({
          projectId: 'project-monitoramento',
          projectDescription: markerFor(ORG_ID, 'm', ORG_NAME),
        });
        throw new Error('SYNC_TIMEOUT');
      }
      throw new Error('NETWORK_GONE'); // slot a fails without joining
    });
    const clientApi = {
      listProjects: async () =>
        localProjects.map(project => ({
          ...project,
          name: 'fake',
          createdAt: '',
          updatedAt: '',
          status: 'joined' as const,
        })),
      invite: {accept, addListener: jest.fn(), removeListener: jest.fn()},
      on: jest.fn(),
    } as unknown as ComapeoCoreClientApi;

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('error');
    const error = hook.result.current.acceptBundle.error;
    expect(error).toBeInstanceOf(OrganizationOperationError);
    expect((error as OrganizationOperationError).code).toBe('accept-partial');
    expect((error as OrganizationOperationError).details?.missingSlots).toEqual(
      ['a'],
    );
    // The underlying failure stays reachable for diagnostics.
    expect((error as OrganizationOperationError).details?.cause).toMatchObject({
      message: 'NETWORK_GONE',
    });
    // The org is still incomplete — the recovery identity stays pinned.
    expect(identityStore.instance.getState()).toStrictEqual({
      [ORG_ID]: {invitorDeviceId: 'invitor-1', roleName: 'Coordinator'},
    });

    hook.unmount();
  });

  test('a failed accept with zero local progress publishes the original error', async () => {
    // Nothing joined anywhere: there is no progress to reconcile, so the
    // reconciliation must not replace the failure the user saw with a
    // synthesized one.
    const {clientApi, accept} = createFakeClient();
    accept.mockRejectedValue(new Error('NETWORK_GONE'));

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('error');
    expect(hook.result.current.acceptBundle.error).toMatchObject({
      message: 'NETWORK_GONE',
    });
    expect(hook.result.current.activeProjectId).toBeUndefined();

    hook.unmount();
  });
});
