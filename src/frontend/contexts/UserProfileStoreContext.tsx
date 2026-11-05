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

export type CoordinationRole = 'coordinator' | 'participant' | null;

/**
 * #129: one remote-archive URL that still has to be applied to ONE territory.
 * It lives here — not in the creation screen — so a recoverable materialization
 * failure, an interrupted creation or an unmount cannot lose it.
 *
 * A LIST, not a single slot: two creations can overlap (a second organization
 * starts while the first one's archive is still in flight), and a completion
 * must never overwrite the other intent.
 *
 * - `id` is the identity every write uses: updates and removals address an
 *   entry by id and are always functional (`setState(prev => …)`), so a stale
 *   closure can never resurrect or delete a sibling intent.
 * - `organizationId` is filled as soon as the provisioning screen of THIS
 *   creation sees the organization in preparation. While null the intent is
 *   ORPHAN and is never applied: falling back to "the organization currently
 *   in preparation" would leak the URL into another territory.
 * - `createdAt` lets an orphan be discarded once the organization had its
 *   chance to leave `preparando` (see `usePendingArchiveResume`).
 * - `sendingSince` is written immediately BEFORE a send. A mount that sees a
 *   mark younger than 60 s does not send again (remount protection); a mark
 *   older than 60 s is an interrupted attempt and is allowed to resend once.
 * - `appliedFor` records the organization whose BOTH slots already received
 *   the URL. It is written before the entry is removed and is what prevents a
 *   second application if that removal fails.
 */
export type PendingArchiveIntent = {
  id: string;
  /** Already normalized by `normalizeRemoteArchiveUrl`. */
  url: string;
  organizationId: string | null;
  createdAt: number;
  sendingSince: number | null;
  appliedFor: string | null;
};

export type UserProfileState = {
  ethnicity: string | null;
  village: string | null;
  coordinationRole: CoordinationRole;
  pendingArchives: PendingArchiveIntent[];
};

const PROFILE_VERSION = 6;
// v2 carried ethnicity/village only; hydrating it must not discard the user's
// profile — the missing role is simply `null` (not answered yet). v3 added
// the coordination role; v4 added the old `pendingArchiveUrl`; v5 replaced it
// with a single `pendingArchive`; v6 replaced that slot with the
// `pendingArchives` list. Every legacy version hydrates the missing/new
// fields as null/empty; the v4 URL and the v5 single intent are intentionally
// NOT migrated (they were never shipped, and a stale single slot has no
// identity to scope by).
const LEGACY_PROFILE_VERSION = 2;
const V3_PROFILE_VERSION = 3;
const V4_PROFILE_VERSION = 4;
const V5_PROFILE_VERSION = 5;

function emptyProfile(): UserProfileState {
  return {
    ethnicity: null,
    village: null,
    coordinationRole: null,
    pendingArchives: [],
  };
}

function normalizeCoordinationRole(
  value: unknown,
): CoordinationRole | undefined {
  if (value === null) {
    return null;
  }
  if (value === 'coordinator' || value === 'participant') {
    return value;
  }
  return undefined;
}

function normalizeText(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  return value.trim() || null;
}

function normalizeOptionalId(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  return typeof value === 'string' ? value.trim() || null : undefined;
}

/**
 * v6's pending archive list. `undefined` means the value is corrupt and the
 * whole profile must be discarded (matching the other fields' contract); a
 * missing value is simply an empty list. Individual entries tolerate missing
 * `sendingSince`/`appliedFor` (older v6 writes), but an entry without a usable
 * id/url/createdAt is corruption.
 */
function normalizePendingArchiveIntents(
  value: unknown,
): PendingArchiveIntent[] | undefined {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const intents: PendingArchiveIntent[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return undefined;
    }
    const {id, url, organizationId, createdAt, sendingSince, appliedFor} =
      entry as {
        id?: unknown;
        url?: unknown;
        organizationId?: unknown;
        createdAt?: unknown;
        sendingSince?: unknown;
        appliedFor?: unknown;
      };
    if (typeof id !== 'string' || !id.trim()) {
      return undefined;
    }
    if (typeof url !== 'string' || !url.trim()) {
      return undefined;
    }
    if (
      typeof createdAt !== 'number' ||
      !Number.isFinite(createdAt) ||
      createdAt < 0
    ) {
      return undefined;
    }
    const organization = normalizeOptionalId(organizationId);
    const applied = normalizeOptionalId(appliedFor);
    if (organization === undefined || applied === undefined) {
      return undefined;
    }
    const sending =
      sendingSince === undefined || sendingSince === null
        ? null
        : typeof sendingSince === 'number' && Number.isFinite(sendingSince)
          ? sendingSince
          : undefined;
    if (sending === undefined) {
      return undefined;
    }
    intents.push({
      id: id.trim(),
      url: url.trim(),
      organizationId: organization,
      createdAt,
      sendingSince: sending,
      appliedFor: applied,
    });
  }
  return intents;
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

  if (
    version !== PROFILE_VERSION &&
    version !== V5_PROFILE_VERSION &&
    version !== V4_PROFILE_VERSION &&
    version !== V3_PROFILE_VERSION &&
    version !== LEGACY_PROFILE_VERSION
  ) {
    return emptyProfile();
  }

  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    return emptyProfile();
  }

  const {ethnicity, village, coordinationRole, pendingArchives} = state as {
    ethnicity?: unknown;
    village?: unknown;
    coordinationRole?: unknown;
    pendingArchives?: unknown;
  };

  if (ethnicity !== null && typeof ethnicity !== 'string') {
    return emptyProfile();
  }

  if (village !== null && typeof village !== 'string') {
    return emptyProfile();
  }

  const role =
    coordinationRole === undefined
      ? null
      : normalizeCoordinationRole(coordinationRole);

  if (role === undefined) {
    return emptyProfile();
  }

  // v2–v5 have no `pendingArchives`; the old v4 `pendingArchiveUrl` and the
  // v5 single `pendingArchive` are intentionally not migrated. A corrupt v6
  // value wipes the profile, matching every other field's contract.
  const pending =
    version === PROFILE_VERSION
      ? normalizePendingArchiveIntents(pendingArchives)
      : [];

  if (pending === undefined) {
    return emptyProfile();
  }

  return {
    ethnicity: normalizeText(ethnicity),
    village: normalizeText(village),
    coordinationRole: role,
    pendingArchives: pending,
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
            coordinationRole: next.coordinationRole,
            pendingArchives: next.pendingArchives,
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
    setCoordinationRole: (role: CoordinationRole) => {
      store.setState({coordinationRole: role});
    },
    /**
     * #129: records a NEW intent before materialization starts. Appending is
     * functional and id-addressed: a completion that lands later can only
     * touch its own entry, never this one.
     */
    addPendingArchiveIntent: (intent: {
      id: string;
      url: string;
      organizationId?: string | null;
      createdAt?: number;
      sendingSince?: number | null;
      appliedFor?: string | null;
    }) => {
      const id = intent.id.trim();
      const url = intent.url.trim();
      if (!id || !url) return;
      store.setState(prev => {
        if (prev.pendingArchives.some(item => item.id === id)) {
          return prev;
        }
        return {
          pendingArchives: [
            ...prev.pendingArchives,
            {
              id,
              url,
              organizationId: intent.organizationId?.trim() || null,
              createdAt: intent.createdAt ?? Date.now(),
              sendingSince: intent.sendingSince ?? null,
              appliedFor: intent.appliedFor?.trim() || null,
            },
          ],
        };
      });
    },
    /**
     * #129/P1-B: every write is functional and addresses ONE id. The previous
     * state is read inside `setState`, so a completion captured in a stale
     * closure cannot overwrite an intent created after it started.
     */
    updatePendingArchiveIntent: (
      id: string,
      patch: Partial<
        Pick<
          PendingArchiveIntent,
          'organizationId' | 'sendingSince' | 'appliedFor'
        >
      >,
    ) => {
      store.setState(prev => ({
        pendingArchives: prev.pendingArchives.map(item => {
          if (item.id !== id) return item;
          const next: PendingArchiveIntent = {...item};
          if (patch.organizationId !== undefined) {
            next.organizationId = patch.organizationId?.trim() || null;
          }
          if (patch.sendingSince !== undefined) {
            next.sendingSince = patch.sendingSince;
          }
          if (patch.appliedFor !== undefined) {
            next.appliedFor = patch.appliedFor?.trim() || null;
          }
          return next;
        }),
      }));
    },
    /** #129: removes only the addressed intent; siblings are untouched. */
    removePendingArchiveIntent: (id: string) => {
      store.setState(prev => ({
        pendingArchives: prev.pendingArchives.filter(item => item.id !== id),
      }));
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
