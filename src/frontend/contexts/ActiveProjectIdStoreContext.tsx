import {createContext, ReactNode, useContext} from 'react';
import {createStore, useStore, type StoreApi} from 'zustand';
import {
  createJSONStorage,
  persist as createPersistedState,
} from 'zustand/middleware';

import {MMKVStoreInitializer} from '../hooks/persistedState/createPersistedState';

type ActiveProjectIdState = {
  projectId?: string;
};

// NOTE: Do not change!
const STORAGE_KEY = 'ActiveProjectId' as const;

// Zustand's persist middleware and using `createJSONStorage()` assumes that states are represented as objects.
// Using a scalar value requires tedious workarounds that are more trouble than shaping the state according to Zustand's assumptions.
// https://github.com/pmndrs/zustand/blob/17e281fd75a8200e3598658e732b8b4a3055f0b1/src/middleware/persist.ts#L181-L184
function createInitialState(): ActiveProjectIdState {
  return {};
}

export function createActiveProjectIdStore({persist} = {persist: false}) {
  let store: StoreApi<ActiveProjectIdState>;

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
    projetar: (projectId: string | undefined) => {
      store.setState({projectId});
    },
  };

  return {
    instance: store,
    actions,
  };
}

export interface ActiveProjectIdStore {
  instance: StoreApi<ActiveProjectIdState>;
  actions: {
    projetar: (projectId: string | undefined) => void;
  };
}

const ActiveProjectIdStoreContext = createContext<ActiveProjectIdStore | null>(
  null,
);

export const ActiveProjectIdStoreProvider = ({
  children,
  store,
}: {
  children: ReactNode;
  store: ActiveProjectIdStore;
}) => {
  // The active id is a PROJECTION (Phase 11): the provider renders children
  // immediately and owns no selection authority of its own — whoever holds
  // a validated selection projects it.
  return (
    <ActiveProjectIdStoreContext value={store}>
      {children}
    </ActiveProjectIdStoreContext>
  );
};

function useActiveProjectIdStoreContext() {
  const value = useContext(ActiveProjectIdStoreContext);

  if (!value) {
    throw new Error('Must set up the ActiveProjectIdStoreContext');
  }

  return value;
}

export function useActiveProjectId(): string | undefined {
  const {instance} = useActiveProjectIdStoreContext();
  return useStore(instance).projectId;
}

export function useProjetarProjectIdAtivo(): (id: string | undefined) => void {
  const {actions} = useActiveProjectIdStoreContext();
  return actions.projetar;
}
