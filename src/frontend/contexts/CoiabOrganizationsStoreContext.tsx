import {createContext, ReactNode, useContext} from 'react';
import {createStore, useStore} from 'zustand';

import {MMKVStoreInitializer} from '../hooks/persistedState/createPersistedState';
import {
  AREAS,
  documentoInicial,
  type Area,
  type EstadoOrganizacoes,
  type EtapaArea,
  type OrganizacaoLocal,
  type TemplateRef,
} from '../lib/organization/documento';
import {organizationNameError} from '../lib/organization/materializar';

/**
 * The single durable COIAB organization document (SPEC B §5.3). One versioned
 * MMKV record holds registration, creation state, the materialization journal
 * (`materializacao`) and the pending confirmation — every mutation is one
 * atomic write of the whole document, persisted before subscribers see it.
 */

// NOTE: Do not change!
export const STORAGE_KEY = 'CoiabOrganizations' as const;

const ESTADOS: readonly OrganizacaoLocal['estado'][] = [
  'preparando',
  'falha_recuperavel',
  'pronta',
];
const ETAPAS: readonly EtapaArea['etapa'][] = [
  'ausente',
  'criando',
  'criado',
  'importando',
  'verificado',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTemplateRef(value: unknown): value is TemplateRef {
  return (
    isRecord(value) &&
    typeof value.versao === 'string' &&
    typeof value.hash === 'string'
  );
}

function isEtapaArea(value: unknown): value is EtapaArea {
  return (
    isRecord(value) &&
    ETAPAS.includes(value.etapa as EtapaArea['etapa']) &&
    (value.projectId === null || typeof value.projectId === 'string') &&
    (value.template === null || isTemplateRef(value.template)) &&
    (value.idsAntesDaCriacao === null ||
      (Array.isArray(value.idsAntesDaCriacao) &&
        value.idsAntesDaCriacao.every(id => typeof id === 'string')))
  );
}

function isOrganizacaoLocal(value: unknown): value is OrganizacaoLocal {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || typeof value.nome !== 'string') {
    return false;
  }
  if (!ESTADOS.includes(value.estado as OrganizacaoLocal['estado'])) {
    return false;
  }
  if (typeof value.confirmacaoPendente !== 'boolean') return false;
  const materializacao = value.materializacao;
  if (!isRecord(materializacao)) return false;
  if (!AREAS.every(area => isEtapaArea(materializacao[area]))) {
    return false;
  }
  if (
    value.areaEmExecucao !== null &&
    !AREAS.includes(value.areaEmExecucao as Area)
  ) {
    return false;
  }
  return (
    value.ultimoErro === null ||
    (isRecord(value.ultimoErro) &&
      typeof value.ultimoErro.codigo === 'string' &&
      (value.ultimoErro.area === null ||
        AREAS.includes(value.ultimoErro.area as Area)) &&
      typeof value.ultimoErro.ocorridoEm === 'string')
  );
}

/**
 * Validates a rehydrated document (SPEC B §5.3). Returns null for anything
 * unreadable, corrupted or from another version — never migrates, and never
 * clears storage on its own (SPEC B §6: an invalid record is preserved and
 * the failure is surfaced, not silently replaced).
 */
function parseEstadoOrganizacoes(value: unknown): EstadoOrganizacoes | null {
  if (!isRecord(value)) return null;
  if (value.versao !== 1) return null;
  if (!Array.isArray(value.organizacoes)) return null;
  if (!value.organizacoes.every(isOrganizacaoLocal)) return null;
  if (value.ativa !== null) {
    if (!isRecord(value.ativa)) return null;
    if (typeof value.ativa.organizacaoId !== 'string') return null;
    if (!AREAS.includes(value.ativa.area as Area)) return null;
  }
  // A `pronta` record must still satisfy the D9 activation invariant it was
  // published under: both areas `verificado` with two distinct, real project
  // ids. A shape-valid but semantically broken `pronta` doc (null/identical
  // ids, an unverified area) surfaces as a hydration failure with storage
  // preserved (SPEC B §6) — never rehydrated as something the confirmation
  // flow can activate.
  for (const org of value.organizacoes as OrganizacaoLocal[]) {
    if (org.estado !== 'pronta') continue;
    const {monitoramento, alertas} = org.materializacao;
    if (
      monitoramento.etapa !== 'verificado' ||
      alertas.etapa !== 'verificado' ||
      !monitoramento.projectId ||
      !alertas.projectId ||
      monitoramento.projectId === alertas.projectId
    ) {
      return null;
    }
  }
  return value as unknown as EstadoOrganizacoes;
}

/**
 * Runtime document state: the durable §5.3 document plus `hidratacaoFalhou`,
 * a runtime-only flag (never persisted) exposing an unresolved hydration
 * failure (SPEC B §6).
 */
export type CoiabOrganizationsState = EstadoOrganizacoes & {
  hidratacaoFalhou?: boolean;
};

function createInitialState(): CoiabOrganizationsState {
  return {...documentoInicial(), hidratacaoFalhou: false};
}

/**
 * Reads the persisted document. An unreadable, corrupted or unknown-version
 * record is NEVER silently replaced by the initial state (SPEC B §6): the
 * initial document is exposed in memory with `hidratacaoFalhou: true`, the
 * MMKV record is preserved untouched, and normal writes stay blocked until an
 * explicit `resolverFalhaHidratacao()`.
 */
function rehydrate(): CoiabOrganizationsState {
  const initial = createInitialState();
  try {
    const raw = MMKVStoreInitializer.getItem(STORAGE_KEY);
    if (typeof raw !== 'string') return initial;
    const parsed = parseEstadoOrganizacoes(JSON.parse(raw));
    if (!parsed) return {...initial, hidratacaoFalhou: true};
    return {...parsed, hidratacaoFalhou: false};
  } catch {
    return {...initial, hidratacaoFalhou: true};
  }
}

export function createCoiabOrganizationsStore({persist} = {persist: false}) {
  const store = createStore<CoiabOrganizationsState>(() =>
    persist ? rehydrate() : createInitialState(),
  );
  const publish = store.setState;
  /**
   * MMKV is synchronous. Write the whole document before notifying Zustand
   * subscribers so a failed disk write cannot expose an uncommitted document
   * in memory (SPEC B §5.3: "se uma gravação necessária falhar, interromper o
   * avanço; estado apenas em memória não autoriza sucesso").
   *
   * While `hidratacaoFalhou` is active every normal write is refused (SPEC B
   * §6) — the persisted record can only change through the explicit resolver.
   */
  const atomicSetState = (
    partial:
      | CoiabOrganizationsState
      | Partial<CoiabOrganizationsState>
      | ((
          state: CoiabOrganizationsState,
        ) => CoiabOrganizationsState | Partial<CoiabOrganizationsState>),
    replace?: boolean,
  ): void => {
    const current = store.getState();
    if (current.hidratacaoFalhou) return;
    const value = typeof partial === 'function' ? partial(current) : partial;
    if (Object.is(value, current)) return;
    // `replace` truly replaces the document — an omitted key is cleared, not
    // merged over from `current`. Only `hidratacaoFalhou` (runtime-only, never
    // in the payload) is carried across, always taken from `current`.
    const next: CoiabOrganizationsState = replace
      ? {
          ...(value as CoiabOrganizationsState),
          hidratacaoFalhou: current.hidratacaoFalhou,
        }
      : {...current, ...value};
    if (persist) {
      // The durable record keeps the exact §5.3 document shape.
      const documento = {...next};
      delete (documento as Partial<typeof next>).hidratacaoFalhou;
      MMKVStoreInitializer.setItem(STORAGE_KEY, JSON.stringify(documento));
    }
    publish(next, true);
  };
  store.setState = atomicSetState as typeof store.setState;

  const salvaOrganizacao = (organizacao: OrganizacaoLocal) => {
    const state = store.getState();
    atomicSetState(
      {
        ...state,
        organizacoes: state.organizacoes.map(item =>
          item.id === organizacao.id ? organizacao : item,
        ),
      },
      true,
    );
  };

  /** Journal patch for the single organization being created (one at a time). */
  const patchArea = (
    area: Area,
    patch: Partial<EtapaArea>,
    orgPatch: Partial<OrganizacaoLocal> = {},
  ) => {
    const org = store.getState().organizacoes[0];
    if (!org) return;
    salvaOrganizacao({
      ...org,
      ...orgPatch,
      materializacao: {
        ...org.materializacao,
        [area]: {...org.materializacao[area], ...patch},
      },
    });
  };

  const actions = {
    /**
     * Persists the creation intent with `estado: 'preparando'` before any
     * project exists (SPEC B §5.4 step 2). Refused while an organization
     * already exists — uma criação por vez (D8) — or with an invalid name
     * (§6): the refusal persists nothing.
     */
    iniciarOrganizacao: ({
      id,
      nome,
      templates,
    }: {
      id: string;
      nome: string;
      templates: Record<Area, TemplateRef>;
    }): boolean => {
      const state = store.getState();
      if (state.hidratacaoFalhou) return false;
      if (state.organizacoes.length > 0) return false;
      if (organizationNameError(nome)) return false;
      const areaVazia = (area: Area): EtapaArea => ({
        etapa: 'ausente',
        projectId: null,
        template: templates[area],
        idsAntesDaCriacao: null,
      });
      atomicSetState(
        {
          ...state,
          organizacoes: [
            {
              id,
              nome: nome.trim(),
              estado: 'preparando',
              confirmacaoPendente: false,
              materializacao: {
                monitoramento: areaVazia('monitoramento'),
                alertas: areaVazia('alertas'),
              },
              areaEmExecucao: null,
              ultimoErro: null,
            },
          ],
        },
        true,
      );
      return true;
    },

    /** Records the listProjects() snapshot and the running area (§5.4 step 3). */
    iniciarEtapaCriacao: (area: Area, idsAntesDaCriacao: string[]) => {
      patchArea(
        area,
        {etapa: 'criando', idsAntesDaCriacao},
        {areaEmExecucao: area},
      );
    },

    /** Persists the public id immediately, before any import (§5.4 step 3). */
    registrarProjetoCriado: (area: Area, projectId: string) => {
      patchArea(area, {etapa: 'criado', projectId});
    },

    iniciarImportacao: (area: Area) => {
      patchArea(area, {etapa: 'importando'}, {areaEmExecucao: area});
    },

    registrarAreaVerificada: (area: Area) => {
      patchArea(area, {etapa: 'verificado'}, {areaEmExecucao: null});
    },

    /**
     * Keeps the journal intact and records `ultimoErro` WITHOUT the
     * organization name (§5.3) — recovery reuses ids and templates.
     */
    registrarFalha: ({codigo, area}: {codigo: string; area: Area | null}) => {
      const org = store.getState().organizacoes[0];
      if (!org) return;
      salvaOrganizacao({
        ...org,
        estado: 'falha_recuperavel',
        ultimoErro: {codigo, area, ocorridoEm: new Date().toISOString()},
      });
    },

    /** "Tentar novamente": back to `preparando`, journal preserved (§3.2). */
    retomarPreparacao: () => {
      const org = store.getState().organizacoes[0];
      if (!org) return;
      salvaOrganizacao({...org, estado: 'preparando', ultimoErro: null});
    },

    /**
     * Publishes `pronta` + `confirmacaoPendente: true` in one write, only
     * with both areas verified and two distinct project ids (D9). A refused
     * publication leaves the document — and storage — untouched.
     */
    publicarPronta: (): boolean => {
      const state = store.getState();
      if (state.hidratacaoFalhou) return false;
      const org = state.organizacoes[0];
      if (!org || org.estado === 'pronta') return false;
      const {monitoramento, alertas} = org.materializacao;
      if (
        monitoramento.etapa !== 'verificado' ||
        alertas.etapa !== 'verificado'
      ) {
        return false;
      }
      const ids = [monitoramento.projectId, alertas.projectId];
      if (ids.some(projectId => !projectId)) return false;
      if (monitoramento.projectId === alertas.projectId) return false;
      atomicSetState(
        {
          ...state,
          organizacoes: state.organizacoes.map(item =>
            item.id === org.id
              ? {
                  ...item,
                  estado: 'pronta' as const,
                  confirmacaoPendente: true,
                  areaEmExecucao: null,
                  ultimoErro: null,
                }
              : item,
          ),
        },
        true,
      );
      return true;
    },

    /**
     * "Abrir organização": acknowledgement (`confirmacaoPendente: false`) and
     * activation (`ativa`) are written in a SINGLE write (SPEC A §4.2 rule 9,
     * SPEC B §3.3) — refused, without any notification, before `pronta`.
     */
    reconhecerConfirmacao: () => {
      const state = store.getState();
      const org = state.organizacoes[0];
      if (!org || org.estado !== 'pronta' || !org.confirmacaoPendente) return;
      atomicSetState(
        {
          ...state,
          organizacoes: state.organizacoes.map(item =>
            item.id === org.id ? {...item, confirmacaoPendente: false} : item,
          ),
          ativa: {organizacaoId: org.id, area: 'monitoramento'},
        },
        true,
      );
    },

    /**
     * Explicit resolution of an unresolved hydration failure (SPEC B §6):
     * removes the unreadable record (only when persisting, and only while the
     * failure is active) and resets to the initial document, unblocking normal
     * writes. A no-op on a healthy store — a good record is never deleted.
     * Bypasses `atomicSetState` via the raw `publish` because that setter is
     * blocked while the flag is active.
     */
    resolverFalhaHidratacao: () => {
      if (!store.getState().hidratacaoFalhou) return;
      if (persist) MMKVStoreInitializer.removeItem(STORAGE_KEY);
      publish(createInitialState(), true);
    },
  };

  return {
    instance: store,
    actions,
  };
}

export type CoiabOrganizationsStore = ReturnType<
  typeof createCoiabOrganizationsStore
>;

const CoiabOrganizationsStoreContext =
  createContext<CoiabOrganizationsStore | null>(null);

export const CoiabOrganizationsStoreProvider = ({
  children,
  store,
}: {
  children: ReactNode;
  store: CoiabOrganizationsStore;
}) => {
  return (
    <CoiabOrganizationsStoreContext value={store}>
      {children}
    </CoiabOrganizationsStoreContext>
  );
};

function useCoiabOrganizationsStoreContext() {
  const value = useContext(CoiabOrganizationsStoreContext);

  if (!value) {
    throw new Error('Must set up the CoiabOrganizationsStoreContext');
  }

  return value;
}

export function useCoiabOrganizationsDocument(): CoiabOrganizationsState {
  const {instance} = useCoiabOrganizationsStoreContext();
  return useStore(instance);
}

export function useCoiabOrganizationsActions() {
  const {actions} = useCoiabOrganizationsStoreContext();
  return actions;
}
