import {act, renderHook, waitFor} from '@testing-library/react-native';
import React, {Suspense, type ReactNode} from 'react';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';

import {MapeoApiWrapper} from '../../../../tests/integration/helpers/MapeoApiWrapper';
import {
  createOrganizationInviteIdentityStore,
  OrganizationInviteIdentityStoreProvider,
  type OrganizationInviteIdentityStore,
} from '../../contexts/OrganizationInviteIdentityStoreContext';
import {
  CREATOR_ROLE_ID,
  type DiscardResult,
} from '../../lib/organization/fanout';
import {markerFor} from '../../lib/organization/marker';
import {
  organizationCreationProvenanceStore,
  recordOrganizationCreationProvenance,
} from '../../lib/organization/creationProvenance';
import {useDiscardIncompleteOrganization} from './useDiscardIncompleteOrganization';

type FakeProjectRow = {
  projectId: string;
  projectDescription?: string;
  status: 'joined' | 'joining' | 'left';
};

const DEVICE_ID = 'device-1';

/**
 * A fake client satisfying what `discardIncompleteOrganization` reads: the
 * project list, the creator role, the member list, the device id and the
 * leave call — enough of the real client for the discard fan-out and the
 * react-query cache.
 */
function createFakeDiscardClient() {
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
  const leaveProject = jest.fn(async (projectId: string) => {
    const index = projects.findIndex(
      project => project.projectId === projectId,
    );
    if (index !== -1) projects.splice(index, 1);
  });
  const clientApi = {
    listProjects: async () => [...projects],
    createProject,
    getProject: jest.fn(async () => ({
      $getOwnRole: async () => ({roleId: CREATOR_ROLE_ID}),
      $member: {getMany: async () => [{deviceId: DEVICE_ID}]},
    })),
    leaveProject,
    getDeviceInfo: async () => ({deviceId: DEVICE_ID}),
    invite: {addListener: jest.fn(), removeListener: jest.fn()},
    on: jest.fn(),
  } as unknown as ComapeoCoreClientApi;
  return {
    clientApi,
    createProject,
    getProject: clientApi.getProject as unknown as jest.Mock,
    leaveProject,
    projects,
  };
}

describe('useDiscardIncompleteOrganization', () => {
  let identityStore: OrganizationInviteIdentityStore;

  beforeEach(() => {
    // The provenance record is durable by design — it must not leak from
    // the test that wrote it into the next device state.
    organizationCreationProvenanceStore.setState({organizationIds: []});
    identityStore = createOrganizationInviteIdentityStore();
  });

  function createWrapper(clientApi: ComapeoCoreClientApi) {
    return ({children}: {children: ReactNode}) => (
      <MapeoApiWrapper mapeoApi={clientApi}>
        <OrganizationInviteIdentityStoreProvider store={identityStore}>
          <Suspense fallback={null}>{children}</Suspense>
        </OrganizationInviteIdentityStoreProvider>
      </MapeoApiWrapper>
    );
  }

  const IDENTITY = {invitorDeviceId: 'invitor-device', roleName: 'Member'};

  async function discardWithHook(
    clientApi: ComapeoCoreClientApi,
    organizationId: string,
  ) {
    const hook = await renderHook(() => useDiscardIncompleteOrganization(), {
      wrapper: createWrapper(clientApi),
    });
    await waitFor(() => {
      expect(hook.result.current).not.toBeNull();
    });
    await act(async () => {
      await hook.result.current!.discard(organizationId);
    });
    return hook;
  }

  test("a successful discard clears that organization's persisted invite identity, and only that one", async () => {
    // The identity pins a recovery accept of the organization; once the
    // organization is gone from the device it pins nothing, and a stale one
    // would reject a genuine future re-invite from another invitor.
    const {clientApi} = createFakeDiscardClient();
    const organizationId = '0123456789abcdef';
    const otherOrganizationId = 'fedcba9876543210';
    await clientApi.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(organizationId, 'm', 'Org Incompleta'),
    });
    identityStore.actions.setIdentity(organizationId, IDENTITY);
    identityStore.actions.setIdentity(otherOrganizationId, IDENTITY);

    const hook = await discardWithHook(clientApi, organizationId);

    expect(hook.result.current!.result?.ok).toBe(true);
    expect(identityStore.instance.getState()).toStrictEqual({
      [otherOrganizationId]: IDENTITY,
    });

    hook.unmount();
  });

  test('a partial discard keeps the persisted invite identity for the retry', async () => {
    const {clientApi, getProject} = createFakeDiscardClient();
    const organizationId = '0123456789abcdef';
    await clientApi.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(organizationId, 'm', 'Org Incompleta'),
    });
    getProject.mockImplementation(async () => ({
      $getOwnRole: async () => ({roleId: CREATOR_ROLE_ID}),
      $member: {
        getMany: async () => [{deviceId: DEVICE_ID}, {deviceId: 'device-2'}],
      },
    }));
    identityStore.actions.setIdentity(organizationId, IDENTITY);

    const hook = await discardWithHook(clientApi, organizationId);

    expect(hook.result.current!.status).toBe('success');
    expect(hook.result.current!.result?.ok).toBe(false);
    expect(identityStore.instance.getState()).toStrictEqual({
      [organizationId]: IDENTITY,
    });

    hook.unmount();
  });

  test('a successful discard removes the incomplete organization and clears its provenance record (F4)', async () => {
    // Review round 2 F4: the discard is the escape hatch of a refused
    // create, but the durable creation-provenance record used to survive
    // it — a permanent MMKV entry for an organization that no longer
    // exists on the device.
    const {clientApi, leaveProject} = createFakeDiscardClient();
    const organizationId = '0123456789abcdef';
    const mProjectId = await clientApi.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(organizationId, 'm', 'Org Incompleta'),
    });
    recordOrganizationCreationProvenance(organizationId);
    expect(
      organizationCreationProvenanceStore.getState().organizationIds,
    ).toContain(organizationId);

    const hook = await renderHook(() => useDiscardIncompleteOrganization(), {
      wrapper: createWrapper(clientApi),
    });

    await waitFor(() => {
      expect(hook.result.current).not.toBeNull();
    });

    await act(async () => {
      await hook.result.current!.discard(organizationId);
    });

    expect(hook.result.current!.status).toBe('success');
    expect(hook.result.current!.result).toMatchObject({
      ok: true,
      removed: [{slot: 'm', projectId: mProjectId}],
    } satisfies Partial<DiscardResult>);
    expect(leaveProject).toHaveBeenCalledWith(mProjectId);
    // The organization is gone from the device — its record must go too.
    expect(
      organizationCreationProvenanceStore.getState().organizationIds,
    ).toEqual([]);

    hook.unmount();
  });
});
