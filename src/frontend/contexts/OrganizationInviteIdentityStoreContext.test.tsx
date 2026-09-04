import {act, renderHook} from '@testing-library/react-native';
import React, {type ReactNode} from 'react';

import {
  createOrganizationInviteIdentityStore,
  OrganizationInviteIdentityStoreProvider,
  useOrganizationInviteIdentities,
  useOrganizationInviteIdentityActions,
  type OrganizationInviteIdentityStore,
} from './OrganizationInviteIdentityStoreContext';

describe('OrganizationInviteIdentityStore', () => {
  let store: OrganizationInviteIdentityStore;

  beforeEach(() => {
    store = createOrganizationInviteIdentityStore();
  });

  function createWrapper() {
    return ({children}: {children: ReactNode}) => (
      <OrganizationInviteIdentityStoreProvider store={store}>
        {children}
      </OrganizationInviteIdentityStoreProvider>
    );
  }

  async function renderStore() {
    return renderHook(
      () => ({
        identities: useOrganizationInviteIdentities(),
        actions: useOrganizationInviteIdentityActions(),
      }),
      {wrapper: createWrapper()},
    );
  }

  test('starts empty', async () => {
    const hook = await renderStore();

    expect(hook.result.current.identities).toStrictEqual({});

    hook.unmount();
  });

  test('setIdentity pins the identity of an organization, and can overwrite it', async () => {
    const hook = await renderStore();

    await act(async () =>
      hook.result.current.actions.setIdentity('a1b2c3d4e5f60718', {
        invitorDeviceId: 'invitor-1',
        roleName: 'Coordinator',
      }),
    );

    expect(hook.result.current.identities).toStrictEqual({
      a1b2c3d4e5f60718: {invitorDeviceId: 'invitor-1', roleName: 'Coordinator'},
    });

    await act(async () =>
      hook.result.current.actions.setIdentity('a1b2c3d4e5f60718', {
        invitorDeviceId: 'invitor-2',
        roleName: 'Participant',
      }),
    );

    expect(hook.result.current.identities).toStrictEqual({
      a1b2c3d4e5f60718: {invitorDeviceId: 'invitor-2', roleName: 'Participant'},
    });

    hook.unmount();
  });

  test('identities of different organizations are independent', async () => {
    const hook = await renderStore();

    await act(async () => {
      hook.result.current.actions.setIdentity('a1b2c3d4e5f60718', {
        invitorDeviceId: 'invitor-1',
        roleName: 'Coordinator',
      });
      hook.result.current.actions.setIdentity('b2c3d4e5f6071808', {
        invitorDeviceId: 'invitor-2',
        roleName: 'Participant',
      });
    });

    expect(hook.result.current.identities).toStrictEqual({
      a1b2c3d4e5f60718: {invitorDeviceId: 'invitor-1', roleName: 'Coordinator'},
      b2c3d4e5f6071808: {
        invitorDeviceId: 'invitor-2',
        roleName: 'Participant',
      },
    });

    hook.unmount();
  });

  test('clearIdentity removes only the given organization', async () => {
    const hook = await renderStore();

    await act(async () => {
      hook.result.current.actions.setIdentity('a1b2c3d4e5f60718', {
        invitorDeviceId: 'invitor-1',
        roleName: 'Coordinator',
      });
      hook.result.current.actions.setIdentity('b2c3d4e5f6071808', {
        invitorDeviceId: 'invitor-2',
        roleName: 'Participant',
      });
    });

    await act(async () =>
      hook.result.current.actions.clearIdentity('a1b2c3d4e5f60718'),
    );

    expect(hook.result.current.identities).toStrictEqual({
      b2c3d4e5f6071808: {
        invitorDeviceId: 'invitor-2',
        roleName: 'Participant',
      },
    });

    // Clearing an unknown organization is a no-op.
    await act(async () =>
      hook.result.current.actions.clearIdentity('ffffffffffffffff'),
    );

    expect(hook.result.current.identities).toStrictEqual({
      b2c3d4e5f6071808: {
        invitorDeviceId: 'invitor-2',
        roleName: 'Participant',
      },
    });

    hook.unmount();
  });
});
