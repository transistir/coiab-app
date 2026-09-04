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

  beforeEach(() => {
    store = createActiveProjectIdStore();
  });

  function createWrapper(clientApi: ComapeoCoreClientApi) {
    return ({children}: {children: ReactNode}) => (
      <MapeoApiWrapper mapeoApi={clientApi}>
        <ActiveProjectIdStoreProvider store={store}>
          {children}
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
              {children}
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

  test('a partial bundle without the persisted identity surfaces identity-required', async () => {
    const {clientApi, accept} = createFakeClient();
    // Only slot a survived transit: a recovery accept (docs/OrgLayerSpike.md
    // finding 6) must be pinned by the persisted identity, so without one it
    // fails closed before accepting anything.
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
    ).toBe('identity-required');
    expect(accept).not.toHaveBeenCalled();
    expect(hook.result.current.activeProjectId).toBeUndefined();

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
});
