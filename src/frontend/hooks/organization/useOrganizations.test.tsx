import {act, renderHook, waitFor} from '@testing-library/react-native';
import React, {Suspense, type ReactNode} from 'react';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';

import {MapeoApiWrapper} from '../../../../tests/integration/helpers/MapeoApiWrapper';
import {
  createManager,
  setUpIPC,
} from '../../../../tests/integration/helpers/core';
import {
  ActiveProjectIdStoreProvider,
  createActiveProjectIdStore,
  useActiveProjectIdActions,
  type ActiveProjectIdStore,
} from '../../contexts/ActiveProjectIdStoreContext';
import {markerFor} from '../../lib/organization/marker';
import {useOrganizations, usePrimaryOrganization} from './useOrganizations';

const ORG_ONE_ID = '0000000000000001';
const ORG_TWO_ID = '0000000000000002';
const ORG_ONE_NAME = 'Org Um';
const ORG_TWO_NAME = 'Org Dois';

describe('useOrganizations', () => {
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

  function createWrapper() {
    return ({children}: {children: ReactNode}) => (
      <MapeoApiWrapper mapeoApi={client}>
        <ActiveProjectIdStoreProvider store={store}>
          <Suspense fallback={null}>{children}</Suspense>
        </ActiveProjectIdStoreProvider>
      </MapeoApiWrapper>
    );
  }

  test('returns the organizations reconstructed from the project list', async () => {
    const monitoramentoId = await client.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(ORG_ONE_ID, 'm', ORG_ONE_NAME),
    });
    const alertasId = await client.createProject({
      name: 'Alertas',
      projectDescription: markerFor(ORG_ONE_ID, 'a', ORG_ONE_NAME),
    });
    await client.createProject({name: 'not part of an organization'});

    const hook = await renderHook(() => useOrganizations(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(hook.result.current).toHaveLength(1);
    });

    expect(hook.result.current[0]).toStrictEqual({
      state: 'ready',
      organizationId: ORG_ONE_ID,
      organizationName: ORG_ONE_NAME,
      slots: {m: monitoramentoId, a: alertasId},
    });

    hook.unmount();
  });

  test('usePrimaryOrganization prefers the ready organization of the active project', async () => {
    const orgOneMonitoramentoId = await client.createProject({
      name: 'Org Um Monitoramento',
      projectDescription: markerFor(ORG_ONE_ID, 'm', ORG_ONE_NAME),
    });
    await client.createProject({
      name: 'Org Um Alertas',
      projectDescription: markerFor(ORG_ONE_ID, 'a', ORG_ONE_NAME),
    });
    const orgTwoMonitoramentoId = await client.createProject({
      name: 'Org Dois Monitoramento',
      projectDescription: markerFor(ORG_TWO_ID, 'm', ORG_TWO_NAME),
    });
    await client.createProject({
      name: 'Org Dois Alertas',
      projectDescription: markerFor(ORG_TWO_ID, 'a', ORG_TWO_NAME),
    });

    const hook = await renderHook(
      () => ({
        primary: usePrimaryOrganization(),
        actions: useActiveProjectIdActions(),
      }),
      {wrapper: createWrapper()},
    );

    // The suspense query has to resolve before the hook renders a value.
    await waitFor(() => {
      expect(hook.result.current).not.toBeNull();
    });

    // The store fallback picks projects[0]; point the active project at the
    // second organization's monitoramento slot explicitly.
    await act(async () =>
      hook.result.current!.actions.setActiveProjectId(orgTwoMonitoramentoId),
    );

    await waitFor(() => {
      expect(hook.result.current?.primary?.organizationId).toBe(ORG_TWO_ID);
    });

    // Back to the first organization's monitoramento slot.
    await act(async () =>
      hook.result.current!.actions.setActiveProjectId(orgOneMonitoramentoId),
    );

    await waitFor(() => {
      expect(hook.result.current?.primary?.organizationId).toBe(ORG_ONE_ID);
    });

    hook.unmount();
  });

  test('usePrimaryOrganization falls back to the first ready organization', async () => {
    await client.createProject({
      name: 'Org Um Monitoramento',
      projectDescription: markerFor(ORG_ONE_ID, 'm', ORG_ONE_NAME),
    });
    await client.createProject({
      name: 'Org Um Alertas',
      projectDescription: markerFor(ORG_ONE_ID, 'a', ORG_ONE_NAME),
    });
    await client.createProject({
      name: 'Org Dois Monitoramento',
      projectDescription: markerFor(ORG_TWO_ID, 'm', ORG_TWO_NAME),
    });
    await client.createProject({
      name: 'Org Dois Alertas',
      projectDescription: markerFor(ORG_TWO_ID, 'a', ORG_TWO_NAME),
    });
    const unaffiliatedId = await client.createProject({
      name: 'not part of an organization',
    });

    const hook = await renderHook(
      () => ({
        primary: usePrimaryOrganization(),
        actions: useActiveProjectIdActions(),
      }),
      {wrapper: createWrapper()},
    );

    // The suspense query has to resolve before the hook renders a value.
    await waitFor(() => {
      expect(hook.result.current).not.toBeNull();
    });

    await act(async () =>
      hook.result.current!.actions.setActiveProjectId(unaffiliatedId),
    );

    // No ready organization holds this project, so the first ready one
    // (organizations sort by id) is used.
    expect(hook.result.current!.primary?.organizationId).toBe(ORG_ONE_ID);
    expect(hook.result.current!.primary?.state).toBe('ready');

    hook.unmount();
  });

  test('usePrimaryOrganization matches the active project against either slot', async () => {
    await client.createProject({
      name: 'Org Um Monitoramento',
      projectDescription: markerFor(ORG_ONE_ID, 'm', ORG_ONE_NAME),
    });
    await client.createProject({
      name: 'Org Um Alertas',
      projectDescription: markerFor(ORG_ONE_ID, 'a', ORG_ONE_NAME),
    });
    await client.createProject({
      name: 'Org Dois Monitoramento',
      projectDescription: markerFor(ORG_TWO_ID, 'm', ORG_TWO_NAME),
    });
    // A reactivation (SPEC 8.6 fallback) can land on the Alertas project;
    // the active project must still resolve to its own organization.
    const orgTwoAlertasId = await client.createProject({
      name: 'Org Dois Alertas',
      projectDescription: markerFor(ORG_TWO_ID, 'a', ORG_TWO_NAME),
    });

    const hook = await renderHook(
      () => ({
        primary: usePrimaryOrganization(),
        actions: useActiveProjectIdActions(),
      }),
      {wrapper: createWrapper()},
    );

    // The suspense query has to resolve before the hook renders a value.
    await waitFor(() => {
      expect(hook.result.current).not.toBeNull();
    });

    await act(async () =>
      hook.result.current!.actions.setActiveProjectId(orgTwoAlertasId),
    );

    await waitFor(() => {
      expect(hook.result.current?.primary?.organizationId).toBe(ORG_TWO_ID);
    });

    hook.unmount();
  });

  test('usePrimaryOrganization falls back to an incomplete organization', async () => {
    await client.createProject({
      name: 'Org Um Monitoramento',
      projectDescription: markerFor(ORG_ONE_ID, 'm', ORG_ONE_NAME),
    });

    const hook = await renderHook(() => usePrimaryOrganization(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(hook.result.current).toMatchObject({
        state: 'incomplete',
        organizationId: ORG_ONE_ID,
      });
    });

    hook.unmount();
  });
});
