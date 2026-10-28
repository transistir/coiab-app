import {createContext, ReactNode, useContext} from 'react';
import {createStore, useStore} from 'zustand';

import {MMKVStoreInitializer} from '../hooks/persistedState/createPersistedState';
import {ETHNIC_GROUPS, type EthnicGroup} from '../lib/ethnicGroups';

/**
 * Perfil local de onboarding (#128): etnia do catálogo local e aldeia. É um
 * documento pequeno e versionado — a mesma forma de envelope usada pelo
 * documento de organizações — para que uma mudança futura de esquema possa
 * reconhecer a versão em vez de adivinhar o formato.
 */

// NOTE: Do not change!
export const COIAB_USER_PROFILE_STORAGE_KEY = 'CoiabUserProfile' as const;

export type UserProfileState = {
  ethnicGroupId: string | null;
  village: string | null;
};

const PROFILE_VERSION = 1;

function emptyProfile(): UserProfileState {
  return {ethnicGroupId: null, village: null};
}

/**
 * Hidratação tolerante: storage quebrado, JSON ilegível ou envelope de outra
 * versão/forma resultam no perfil vazio, nunca em exceção. Um ethnicGroupId
 * que não existe no catálogo é descartado; a aldeia já digitada é preservada.
 */
function parseUserProfile(
  raw: string | null | undefined,
  catalog: EthnicGroup[],
): UserProfileState {
  if (typeof raw !== 'string') {
    return emptyProfile();
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return emptyProfile();
  }

  if (
    typeof envelope !== 'object' ||
    envelope === null ||
    Array.isArray(envelope)
  ) {
    return emptyProfile();
  }

  const {state, version} = envelope as {state?: unknown; version?: unknown};

  if (version !== PROFILE_VERSION) {
    return emptyProfile();
  }

  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    return emptyProfile();
  }

  const {ethnicGroupId, village} = state as {
    ethnicGroupId?: unknown;
    village?: unknown;
  };

  if (ethnicGroupId !== null && typeof ethnicGroupId !== 'string') {
    return emptyProfile();
  }

  if (village !== null && typeof village !== 'string') {
    return emptyProfile();
  }

  const aldeia = village === null ? null : village.trim() || null;

  return {
    ethnicGroupId:
      ethnicGroupId !== null && catalog.some(group => group.id === ethnicGroupId)
        ? ethnicGroupId
        : null,
    village: aldeia,
  };
}

/** Perfil completo = etnia válida no catálogo + aldeia não vazia. */
export function isProfileComplete(
  state: UserProfileState,
  catalog: EthnicGroup[] = ETHNIC_GROUPS,
): boolean {
  return (
    !!state.ethnicGroupId &&
    catalog.some(group => group.id === state.ethnicGroupId) &&
    !!state.village?.trim()
  );
}

export function createUserProfileStore({
  persist = false,
  catalog = ETHNIC_GROUPS,
}: {
  persist?: boolean;
  catalog?: EthnicGroup[];
} = {}) {
  let initial = emptyProfile();
  if (persist) {
    // Uma leitura que lança (adaptador quebrado) é hidratação vazia: o
    // onboarding começa do zero em vez de derrubar a construção do store.
    // Diferente do documento de organizações, NÃO há bloqueio de escrita
    // depois da falha — o perfil é dado do usuário, não um registro a
    // preservar, e uma próxima ação regrava o envelope.
    try {
      initial = parseUserProfile(
        MMKVStoreInitializer.getItem(COIAB_USER_PROFILE_STORAGE_KEY) as
          | string
          | null
          | undefined,
        catalog,
      );
    } catch {
      initial = emptyProfile();
    }
  }

  const store = createStore<UserProfileState>(() => initial);
  const publish = store.setState;
  // MMKV é síncrono. Grava ANTES de notificar os subscribers: uma falha de
  // disco não pode expor um perfil que não foi persistido.
  store.setState = (partial, replace = false) => {
    const current = store.getState();
    const value = typeof partial === 'function' ? partial(current) : partial;
    const next = replace
      ? (value as UserProfileState)
      : {...current, ...value};
    if (persist) {
      MMKVStoreInitializer.setItem(
        COIAB_USER_PROFILE_STORAGE_KEY,
        JSON.stringify({
          state: {
            ethnicGroupId: next.ethnicGroupId,
            village: next.village,
          },
          version: PROFILE_VERSION,
        }),
      );
    }
    publish(next, true);
  };

  const actions = {
    setEthnicGroup: (id: string) => {
      // Um id fora do catálogo nunca entra no perfil persistido.
      if (!catalog.some(group => group.id === id)) {
        throw new Error('invalid-ethnic-group');
      }
      store.setState({ethnicGroupId: id});
    },
    setVillage: (text: string) => {
      const village = text.trim();
      if (!village) {
        throw new Error('invalid-village');
      }
      store.setState({village});
    },
  };

  return {
    instance: store,
    actions,
  };
}

export type UserProfileStore = ReturnType<typeof createUserProfileStore>;

const UserProfileStoreContext = createContext<UserProfileStore | null>(null);

export const UserProfileStoreProvider = ({
  children,
  store,
}: {
  children: ReactNode;
  store: UserProfileStore;
}) => {
  return (
    <UserProfileStoreContext value={store}>
      {children}
    </UserProfileStoreContext>
  );
};

export function useUserProfileStoreContext() {
  const value = useContext(UserProfileStoreContext);

  if (!value) {
    throw new Error('Must set up the UserProfileStoreContext');
  }

  return value;
}

export function useUserProfileState(): UserProfileState {
  const {instance} = useUserProfileStoreContext();
  return useStore(instance);
}

export function useUserProfileActions() {
  const {actions} = useUserProfileStoreContext();
  return actions;
}
