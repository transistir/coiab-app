import {act, renderHook, waitFor} from '@testing-library/react-native';
import React, {Suspense, type ReactNode} from 'react';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';

// The hook generates the organization id with expo-crypto; run the test
// against a node-crypto-backed mock, mirroring
// src/frontend/__mocks__/expo-crypto.ts (which jest.mock cannot require here
// without recursing into the mocked module itself).
jest.mock('expo-crypto', () => ({
  getRandomBytes: (byteCount: number) =>
    new Uint8Array(require('node:crypto').randomBytes(byteCount)),
}));

import {MapeoApiWrapper} from '../../../../tests/integration/helpers/MapeoApiWrapper';
import {
  createManager,
  setUpIPC,
} from '../../../../tests/integration/helpers/core';
import {
  ActiveProjectIdStoreProvider,
  createActiveProjectIdStore,
  useActiveProjectId,
  type ActiveProjectIdStore,
} from '../../contexts/ActiveProjectIdStoreContext';
import {OrganizationOperationError} from '../../lib/organization/fanout';
import {markerFor, parseMarker} from '../../lib/organization/marker';
import {useCreateOrganization} from './useCreateOrganization';
import {useOrganizations} from './useOrganizations';

type FakeProjectRow = {
  projectId: string;
  projectDescription?: string;
  status: 'joined' | 'joining' | 'left';
};

/**
 * A fake client whose `createProject` joins the created project into the
 * (mutable) local list, so `listProjects()` reconstructions see it — enough
 * of the real client for the create fan-out and the react-query cache.
 */
function createFakeCreateClient() {
  const projects: FakeProjectRow[] = [];
  const createProject = jest.fn(
    async (opts: {name: string; projectDescription?: string}) => {
      const projectId = `project-${projects.length + 1}`;
      projects.push({
        projectId,
        projectDescription: opts.projectDescription,
        status: 'joined',
      });
      return projectId;
    },
  );
  const clientApi = {
    listProjects: async () => [...projects],
    createProject,
    invite: {addListener: jest.fn(), removeListener: jest.fn()},
    on: jest.fn(),
  } as unknown as ComapeoCoreClientApi;
  return {clientApi, createProject, projects};
}

describe('useCreateOrganization', () => {
  let client: ComapeoCoreClientApi;
  let store: ActiveProjectIdStore;
  let onTeardown: Array<() => unknown> = [];

  beforeEach(async () => {
    onTeardown = [];
    store = createActiveProjectIdStore();

    const managerSetup = await createManager({
      name: 'test',
      deviceType: 'mobile',
    });
    const {fastifyController} = managerSetup;

    const ipcSetup = setUpIPC({manager: managerSetup.manager});
    ({client} = ipcSetup);
    const {stop} = ipcSetup;
    onTeardown.push(stop);

    await fastifyController.start();
    onTeardown.push(() => fastifyController.stop());
  });

  afterEach(async () => {
    for (const fn of onTeardown) await fn();
  });

  function createWrapper(wrapperClient: ComapeoCoreClientApi = client) {
    return ({children}: {children: ReactNode}) => (
      <MapeoApiWrapper mapeoApi={wrapperClient}>
        <ActiveProjectIdStoreProvider store={store}>
          <Suspense fallback={null}>{children}</Suspense>
        </ActiveProjectIdStoreProvider>
      </MapeoApiWrapper>
    );
  }

  test('creates both organization projects and sets the monitoramento one active', async () => {
    const hook = await renderHook(
      () => ({
        create: useCreateOrganization(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper()},
    );

    // The active-project store provider holds back children while it
    // resolves its fallback.
    await waitFor(() => {
      expect(hook.result.current).not.toBeNull();
    });

    await act(async () => {
      await hook.result.current!.create.start('Org Teste');
    });

    expect(hook.result.current.create.status).toBe('success');
    expect(hook.result.current.create.error).toBeUndefined();

    const organizationId = hook.result.current.create.organizationId;
    expect(organizationId).toMatch(/^[0-9a-f]{16}$/);

    const projects = await client.listProjects();
    const monitoramento = projects.find(
      project =>
        project.projectDescription ===
        markerFor(organizationId!, 'm', 'Org Teste'),
    );
    const alertas = projects.find(
      project =>
        project.projectDescription ===
        markerFor(organizationId!, 'a', 'Org Teste'),
    );
    expect(monitoramento).toBeDefined();
    expect(alertas).toBeDefined();

    expect(hook.result.current.activeProjectId).toBe(monitoramento!.projectId);

    hook.unmount();
  });

  test('an empty name fails without creating any project', async () => {
    const hook = await renderHook(
      () => ({
        create: useCreateOrganization(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper()},
    );

    await waitFor(() => {
      expect(hook.result.current).not.toBeNull();
    });

    await act(async () => {
      await hook.result.current!.create.start('   ');
    });

    expect(hook.result.current.create.status).toBe('error');
    expect(hook.result.current.create.error).toBeInstanceOf(
      OrganizationOperationError,
    );
    expect(
      (hook.result.current.create.error as OrganizationOperationError).code,
    ).toBe('empty-name');
    expect(hook.result.current.activeProjectId).toBeUndefined();

    const projects = await client.listProjects();
    expect(projects).toHaveLength(0);

    hook.unmount();
  });

  test('retrying after a partial failure reuses the organization id and creates only the missing slot', async () => {
    const {clientApi, createProject, projects} = createFakeCreateClient();
    let createCalls = 0;
    createProject.mockImplementation(
      async (opts: {name: string; projectDescription?: string}) => {
        createCalls += 1;
        if (createCalls === 2) {
          // The slot-a create dies after slot m was already created.
          throw new Error('IPC_FAILURE');
        }
        const projectId = `project-${projects.length + 1}`;
        projects.push({
          projectId,
          projectDescription: opts.projectDescription,
          status: 'joined',
        });
        return projectId;
      },
    );

    const hook = await renderHook(() => useCreateOrganization(), {
      wrapper: createWrapper(clientApi),
    });

    await waitFor(() => {
      expect(hook.result.current).not.toBeNull();
    });

    await act(async () => {
      await hook.result.current!.start('Org Teste');
    });

    expect(hook.result.current!.status).toBe('error');
    const firstAttemptOrganizationId = hook.result.current!.organizationId;
    expect(firstAttemptOrganizationId).toMatch(/^[0-9a-f]{16}$/);

    await act(async () => {
      await hook.result.current!.start('Org Teste');
    });

    expect(hook.result.current!.status).toBe('success');
    expect(hook.result.current!.error).toBeUndefined();
    // Both attempts belong to the same organization (SPEC 5 / E7 resume).
    expect(hook.result.current!.organizationId).toBe(
      firstAttemptOrganizationId,
    );
    // Two created projects in total — the retry reused slot m and only
    // created slot a (the first slot-a create was the one that failed).
    expect(projects).toHaveLength(2);
    expect(createProject).toHaveBeenCalledTimes(3);

    const slots = projects.map(
      project => parseMarker(project.projectDescription ?? '')?.slot,
    );
    expect(slots).toStrictEqual(['m', 'a']);
    const organizationIds = new Set(
      projects.map(
        project =>
          parseMarker(project.projectDescription ?? '')?.organizationId,
      ),
    );
    expect([...organizationIds]).toStrictEqual([firstAttemptOrganizationId]);

    hook.unmount();
  });

  test('a caller-provided organization id is used as-is (restart recovery, SPEC 5/E7)', async () => {
    const {clientApi, createProject, projects} = createFakeCreateClient();

    const hook = await renderHook(() => useCreateOrganization(), {
      wrapper: createWrapper(clientApi),
    });

    await waitFor(() => {
      expect(hook.result.current).not.toBeNull();
    });

    const recoveredOrganizationId = '0123456789abcdef';
    await act(async () => {
      await hook.result.current!.start('Org Teste', recoveredOrganizationId);
    });

    expect(hook.result.current!.status).toBe('success');
    // The provided id is used verbatim — no generation.
    expect(hook.result.current!.organizationId).toBe(recoveredOrganizationId);
    const organizationIds = projects.map(
      project => parseMarker(project.projectDescription ?? '')?.organizationId,
    );
    expect(organizationIds).toStrictEqual([
      recoveredOrganizationId,
      recoveredOrganizationId,
    ]);
    expect(createProject).toHaveBeenCalledTimes(2);

    hook.unmount();
  });

  test('a mounted useOrganizations consumer sees the created organization without remounting', async () => {
    const {clientApi, projects} = createFakeCreateClient();

    const hook = await renderHook(
      () => ({
        create: useCreateOrganization(),
        organizations: useOrganizations(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await waitFor(() => {
      expect(hook.result.current).not.toBeNull();
    });
    expect(hook.result.current!.organizations).toHaveLength(0);

    await act(async () => {
      await hook.result.current!.create.start('Org Teste');
    });

    expect(hook.result.current!.create.status).toBe('success');
    // The cache invalidation, not a remount, is what refreshes the consumer.
    await waitFor(() => {
      expect(hook.result.current?.organizations).toHaveLength(1);
    });
    expect(hook.result.current!.organizations[0]).toMatchObject({
      state: 'ready',
      organizationId: hook.result.current!.create.organizationId,
      slots: {
        m: projects[0]!.projectId,
        a: projects[1]!.projectId,
      },
    });

    hook.unmount();
  });

  test('an errored fan-out still refreshes the mounted consumer (partial provisioning visible)', async () => {
    const {clientApi, createProject, projects} = createFakeCreateClient();
    let createCalls = 0;
    createProject.mockImplementation(
      async (opts: {name: string; projectDescription?: string}) => {
        createCalls += 1;
        if (createCalls === 2) {
          // The slot-a create dies after slot m was already created.
          throw new Error('IPC_FAILURE');
        }
        const projectId = `project-${projects.length + 1}`;
        projects.push({
          projectId,
          projectDescription: opts.projectDescription,
          status: 'joined',
        });
        return projectId;
      },
    );

    const hook = await renderHook(
      () => ({
        create: useCreateOrganization(),
        organizations: useOrganizations(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await waitFor(() => {
      expect(hook.result.current).not.toBeNull();
    });
    expect(hook.result.current!.organizations).toHaveLength(0);

    await act(async () => {
      await hook.result.current!.create.start('Org Teste');
    });

    expect(hook.result.current!.create.status).toBe('error');
    // The invalidation happens even on the errored attempt, so the
    // co-mounted consumer refetches and sees the partially provisioned
    // organization as `incomplete` — without any remount.
    await waitFor(() => {
      expect(hook.result.current!.organizations).toHaveLength(1);
    });
    expect(hook.result.current!.organizations[0]).toMatchObject({
      state: 'incomplete',
      organizationId: hook.result.current!.create.organizationId,
      slots: {m: projects[0]!.projectId},
    });

    hook.unmount();
  });
});
