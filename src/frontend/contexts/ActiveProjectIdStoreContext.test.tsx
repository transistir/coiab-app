import {act, renderHook, waitFor} from '@testing-library/react-native';
import React, {type ReactNode} from 'react';
import type {MapeoManager} from '@comapeo/core';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';

import {
  ActiveProjectIdStoreProvider,
  createActiveProjectIdStore,
  useProjetarProjectIdAtivo,
  useActiveProjectId,
  type ActiveProjectIdStore,
} from './ActiveProjectIdStoreContext';
import {createManager, setUpIPC} from '../../../tests/integration/helpers/core';
import {MapeoApiWrapper} from '../../../tests/integration/helpers/MapeoApiWrapper';

function createWrapper(
  store: ActiveProjectIdStore,
  client: ComapeoCoreClientApi,
) {
  return ({children}: {children: ReactNode}) => {
    return (
      <MapeoApiWrapper mapeoApi={client}>
        <ActiveProjectIdStoreProvider store={store}>
          {children}
        </ActiveProjectIdStoreProvider>
      </MapeoApiWrapper>
    );
  };
}

describe('ActiveProjectIdStore', () => {
  let manager: MapeoManager;
  let client: ComapeoCoreClientApi;
  let onTeardown: Array<() => unknown> = [];

  beforeEach(async () => {
    onTeardown = [];

    const managerSetup = await createManager({
      name: 'test',
      deviceType: 'mobile',
    });
    ({manager} = managerSetup);
    const {fastifyController} = managerSetup;

    const ipcSetup = setUpIPC({manager});
    ({client} = ipcSetup);
    const {stop} = ipcSetup;
    onTeardown.push(stop);

    await fastifyController.start();
    onTeardown.push(() => fastifyController.stop());
  });

  afterEach(async () => {
    for (const fn of onTeardown) await fn();
  });

  test('if no project is available, store will be empty', async () => {
    const activeProjectStore = createActiveProjectIdStore();

    const wrapper = createWrapper(activeProjectStore, client);

    const stateHook = await renderHook(() => useActiveProjectId(), {
      wrapper,
    });

    await waitFor(() => {
      expect(stateHook.result.current).toBeUndefined();
    });

    stateHook.unmount();
  });

  test('with no persisted id and one core project, children mount immediately and the projection invents nothing', async () => {
    await client.createProject({name: 'test project'});

    const activeProjectStore = createActiveProjectIdStore();

    const wrapper = createWrapper(activeProjectStore, client);

    // renderHook itself asserts the immediate mount: behind the deleted
    // children gate this hook would never run (result stays null); with
    // the gate gone it renders at once.
    const stateHook = await renderHook(() => useActiveProjectId(), {
      wrapper,
    });

    expect(stateHook.result.current).not.toBeNull();

    // A core project exists, but the provider owns no selection authority:
    // the projection invents nothing from what the core has.
    await waitFor(() => {
      expect(stateHook.result.current).toBeUndefined();
    });

    expect(stateHook.result.current).toBeUndefined();

    stateHook.unmount();
  });

  test('projetar sets and clears the projected active project ID', async () => {
    //empty store
    const activeProjectStore = createActiveProjectIdStore();

    const wrapper = createWrapper(activeProjectStore, client);

    const stateHook = await renderHook(() => useActiveProjectId(), {
      wrapper,
    });

    const actionsHook = await renderHook(() => useProjetarProjectIdAtivo(), {
      wrapper,
    });

    await waitFor(() => {
      expect(stateHook.result.current).toBeUndefined();
    });

    await act(async () => actionsHook.result.current('12345'));

    expect(stateHook.result.current).toBe('12345');

    await act(async () => actionsHook.result.current(undefined));

    expect(stateHook.result.current).toBeUndefined();

    actionsHook.unmount();
    stateHook.unmount();
  });
});
