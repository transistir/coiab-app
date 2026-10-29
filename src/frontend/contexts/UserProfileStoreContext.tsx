import {createContext, ReactNode, useContext} from 'react';
import {createStore, useStore} from 'zustand';

import {MMKVStoreInitializer} from '../hooks/persistedState/createPersistedState';

/**
 * Perfil local de onboarding (#128): etnia e aldeia em texto livre. É um
 * documento pequeno e versionado — a mesma forma de envelope usada pelo
 * documento de organizações — para que uma mudança futura de esquema possa
 * reconhecer a versão em vez de adivinhar o formato.
 */

// NOTE: Do not change!
export const COIAB_USER_PROFILE_STORAGE_KEY = 'CoiabUserProfile' as const;

export type UserProfileState = {
  ethnicity: string | null;
  village: string | null;
};

const PROFILE_VERSION = 2;

function emptyProfile(): UserProfileState {
  return {ethnicity: null, village: null};
}

function normalizeText(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  return value.trim() || null;
}

/**
 * Hidratação tolerante: storage quebrado, JSON ilegível ou envelope de outra
 * versão/forma resultam no perfil vazio, nunca em exceção. Etnia e aldeia são
 * texto livre — não há validação contra o dataset, que só alimenta o
 * autocomplete.
 */
function parseUserProfile(raw: string | null | undefined): UserProfileState {
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

  const {ethnicity, village} = state as {
    ethnicity?: unknown;
    village?: unknown;
  };

  if (ethnicity !== null && typeof ethnicity !== 'string') {
    return emptyProfile();
  }

  if (village !== null && typeof village !== 'string') {
    return emptyProfile();
  }

  return {
    ethnicity: normalizeText(ethnicity),
    village: normalizeText(village),
  };
}

/** Perfil completo = etnia e aldeia não vazias após trim. */
export function isProfileComplete(state: UserProfileState): boolean {
  return !!state.ethnicity?.trim() && !!state.village?.trim();
}

export function createUserProfileStore({
  persist = false,
}: {
  persist?: boolean;
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
          string | null | undefined,
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
    const next = replace ? (value as UserProfileState) : {...current, ...value};
    if (persist) {
      MMKVStoreInitializer.setItem(
        COIAB_USER_PROFILE_STORAGE_KEY,
        JSON.stringify({
          state: {
            ethnicity: next.ethnicity,
            village: next.village,
          },
          version: PROFILE_VERSION,
        }),
      );
    }
    publish(next, true);
  };

  const actions = {
    setEthnicity: (text: string) => {
      store.setState({ethnicity: text.trim() || null});
    },
    setVillage: (text: string) => {
      store.setState({village: text.trim() || null});
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
    <UserProfileStoreContext value={store}>{children}</UserProfileStoreContext>
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
