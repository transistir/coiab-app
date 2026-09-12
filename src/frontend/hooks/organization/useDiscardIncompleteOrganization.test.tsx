import {act, renderHook, waitFor} from '@testing-library/react-native';
import React, {Suspense, type ReactNode} from 'react';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';

import {MapeoApiWrapper} from '../../../../tests/integration/helpers/MapeoApiWrapper';
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
  return {clientApi, createProject, leaveProject, projects};
}

describe('useDiscardIncompleteOrganization', () => {
  beforeEach(() => {
    // The provenance record is durable by design — it must not leak from
    // the test that wrote it into the next device state.
    organizationCreationProvenanceStore.setState({organizationIds: []});
  });

  function createWrapper(clientApi: ComapeoCoreClientApi) {
    return ({children}: {children: ReactNode}) => (
      <MapeoApiWrapper mapeoApi={clientApi}>
        <Suspense fallback={null}>{children}</Suspense>
      </MapeoApiWrapper>
    );
  }

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
