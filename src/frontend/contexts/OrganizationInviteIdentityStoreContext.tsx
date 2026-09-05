import {createContext, ReactNode, useContext} from 'react';
import {createStore, useStore, type StoreApi} from 'zustand';
import {
  createJSONStorage,
  persist as createPersistedState,
} from 'zustand/middleware';

import {MMKVStoreInitializer} from '../hooks/persistedState/createPersistedState';

/**
 * Identity pinned at the FIRST accept of an Organization invite bundle
 * (PLAN-46 decision 6): which device invited this organization, and with
 * which role. A later RECOVERY accept of a partial bundle (a slot lost to an
 * interruption) is validated against it — `acceptOrganizationBundle` fails
 * closed with `identity-required`/`identity-mismatch` without it.
 */
export type OrganizationInviteIdentity = {
  invitorDeviceId: string;
  roleName: string;
};

type OrganizationInviteIdentityState = Record<
  string,
  OrganizationInviteIdentity
>;

// NOTE: Do not change!
const STORAGE_KEY = 'OrganizationInviteIdentity' as const;

function createInitialState(): OrganizationInviteIdentityState {
  return {};
}

export function createOrganizationInviteIdentityStore(
  {persist} = {persist: false},
) {
  let store: StoreApi<OrganizationInviteIdentityState>;

  if (persist) {
    store = createStore(
      createPersistedState(createInitialState, {
        name: STORAGE_KEY,
        storage: createJSONStorage(() => MMKVStoreInitializer),
        version: 0,
      }),
    );
  } else {
    store = createStore(createInitialState);
  }

  const actions = {
    setIdentity: (
      organizationId: string,
      identity: OrganizationInviteIdentity,
    ) => {
      store.setState(state => ({...state, [organizationId]: identity}));
    },
    clearIdentity: (organizationId: string) => {
      // `replace: true` — a merged partial can never REMOVE a key.
      const next = {...store.getState()};
      delete next[organizationId];
      store.setState(next, true);
    },
  };

  return {
    instance: store,
    actions,
  };
}

export type OrganizationInviteIdentityStore = ReturnType<
  typeof createOrganizationInviteIdentityStore
>;

const OrganizationInviteIdentityStoreContext =
  createContext<OrganizationInviteIdentityStore | null>(null);

export const OrganizationInviteIdentityStoreProvider = ({
  children,
  store,
}: {
  children: ReactNode;
  store: OrganizationInviteIdentityStore;
}) => {
  return (
    <OrganizationInviteIdentityStoreContext value={store}>
      {children}
    </OrganizationInviteIdentityStoreContext>
  );
};

function useOrganizationInviteIdentityStoreContext() {
  const value = useContext(OrganizationInviteIdentityStoreContext);

  if (!value) {
    throw new Error('Must set up the OrganizationInviteIdentityStoreContext');
  }

  return value;
}

export function useOrganizationInviteIdentityActions() {
  const {actions} = useOrganizationInviteIdentityStoreContext();
  return actions;
}

export function useOrganizationInviteIdentities(): OrganizationInviteIdentityState {
  const {instance} = useOrganizationInviteIdentityStoreContext();
  return useStore(instance);
}
