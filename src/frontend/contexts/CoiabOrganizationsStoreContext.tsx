import {createContext, ReactNode, useContext} from 'react';
import {createStore, useStore} from 'zustand';

import {MMKVStoreInitializer} from '../hooks/persistedState/createPersistedState';
import {
  Area,
  EstadoOrganizacoes,
  EtapaArea,
  OrganizacaoLocal,
  TemplateRef,
  criarEstadoInicialOrganizacoes,
  parseEstadoOrganizacoes,
} from '../lib/organization/coiabOrganizations';

/**
 * The single durable COIAB organization document (SPEC A §4.2/D3). Every
 * mutation is one atomic write of the whole document: registration, creation
 * state, materialization journal and pending confirmation are fields of it.
 */

// NOTE: Do not change!
export const COIAB_ORGANIZATIONS_STORAGE_KEY = 'CoiabOrganizations' as const;

type CoiabOrganizationsState = EstadoOrganizacoes & {
  /**
   * True when the persisted document failed rehydration (SPEC A §5.3): the
   * failure is exposed instead of silently swallowed, and normal writes stay
   * blocked until the explicit `resolverFalhaHidratacao()` resolution.
   * Optional so a plain `EstadoOrganizacoes` satisfies the state type; the
   * runtime default is always `false` via `createInitialState()`.
   */
  hidratacaoFalhou?: boolean;
};

function createInitialState(): CoiabOrganizationsState {
  return {...criarEstadoInicialOrganizacoes(), hidratacaoFalhou: false};
}

/** Ready organizations the activation rules may legally select. */
export function encontrarOrganizacaoPronta(
  state: CoiabOrganizationsState,
  organizacaoId: string,
): OrganizacaoLocal | undefined {
  return state.organizacoes.find(
    organizacao =>
      organizacao.id === organizacaoId && organizacao.estado === 'pronta',
  );
}

type ParMaterializado = {
  monitoramento: {projectId: string; template: TemplateRef | null};
  alertas: {projectId: string; template: TemplateRef | null};
};

/**
 * A pinned template must survive the §4.2 parser on the next open: null or
 * empty/whitespace-only hash/versao are rejected before writing `pronta`.
 */
function templateFixado(template: TemplateRef | null): boolean {
  return !!template && !!template.hash?.trim() && !!template.versao?.trim();
}

/**
 * Every project already associated with a local organization occupies one
 * area of one organization (SPEC A §4.2 rule 2) — a project cannot join a
 * second organization or appear in both areas.
 */
function projetoSemAssociacao(
  state: CoiabOrganizationsState,
  organizacaoId: string,
  projectId: string,
): boolean {
  return !state.organizacoes.some(
    organizacao =>
      organizacao.id !== organizacaoId &&
      (organizacao.materializacao.monitoramento.projectId === projectId ||
        organizacao.materializacao.alertas.projectId === projectId),
  );
}

export function createCoiabOrganizationsStore({persist} = {persist: false}) {
  let initial = createInitialState();
  if (persist) {
    const raw = MMKVStoreInitializer.getItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
    if (typeof raw === 'string') {
      try {
        const parsed = parseEstadoOrganizacoes(JSON.parse(raw).state);
        // A present raw that fails parsing is never silently replaced (SPEC A
        // §5.3): expose the failure and block normal writes until resolved.
        initial = parsed
          ? {...parsed, hidratacaoFalhou: false}
          : {...initial, hidratacaoFalhou: true};
      } catch {
        // Preserve unreadable storage; never migrate or clear legacy/core data.
        initial = {...initial, hidratacaoFalhou: true};
      }
    }
  }
  const store = createStore<CoiabOrganizationsState>(() => initial);
  const publish = store.setState;
  // MMKV is synchronous. Write before notifying Zustand subscribers so a
  // failed disk write cannot expose an uncommitted context to consumers.
  store.setState = (partial, replace = false) => {
    const current = store.getState();
    // A hydration failure blocks every normal write (SPEC A §5.3): the raw
    // document stays preserved in MMKV until the explicit resolution.
    if (current.hidratacaoFalhou) return;
    const value = typeof partial === 'function' ? partial(current) : partial;
    if (value === current) return;
    // The flag survives every write because it is carried by `current`; a
    // transition that must reset it assigns `next.hidratacaoFalhou` explicitly
    // after the spread instead of relying on a duplicated literal.
    const next: CoiabOrganizationsState = {
      ...current,
      ...(replace
        ? (value as CoiabOrganizationsState)
        : {...current, ...value}),
    };
    if (persist) {
      // The durable document keeps the exact §4.2 shape; the hydration flag
      // is runtime-only state and is never written to MMKV.
      const documento: EstadoOrganizacoes = {
        versao: next.versao,
        organizacoes: next.organizacoes,
        ativa: next.ativa,
      };
      MMKVStoreInitializer.setItem(
        COIAB_ORGANIZATIONS_STORAGE_KEY,
        JSON.stringify({state: documento, version: 1}),
      );
    }
    publish(next, true);
  };

  const actions = {
    /**
     * Acknowledges the pending confirmation and selects the organization in
     * one atomic write (SPEC A §4.2 rule 4). The acknowledged area is the one
     * persisted as active — confirmation never publishes a different area
     * than the one the caller acknowledged.
     */
    confirmarAbertura: (
      organizacaoId: string,
      area: Area = 'monitoramento',
    ) => {
      const state = store.getState();
      // Blocked while a hydration failure is unresolved (SPEC A §5.3).
      if (state.hidratacaoFalhou) return;
      const org = encontrarOrganizacaoPronta(state, organizacaoId);
      if (!org || !parseEstadoOrganizacoes(state))
        throw new Error('invalid-organization');
      store.setState(
        {
          ...state,
          organizacoes: state.organizacoes.map(item =>
            item.id === organizacaoId
              ? {...item, confirmacaoPendente: false}
              : item,
          ),
          ativa: {organizacaoId, area},
        },
        true,
      );
    },
    /**
     * Confirms the selection in one write (SPEC A §4.2 rule 4/§5.2 step 5).
     * Only a ready organization whose confirmation was already acknowledged
     * may be selected — anything else leaves the document untouched.
     */
    ativar: ({organizacaoId, area}: {organizacaoId: string; area: Area}) => {
      store.setState(state => {
        const organizacao = encontrarOrganizacaoPronta(state, organizacaoId);
        if (
          !organizacao ||
          organizacao.confirmacaoPendente ||
          !organizacao.materializacao[area].projectId
        ) {
          return state;
        }
        return {...state, ativa: {organizacaoId, area}};
      });
    },

    /**
     * Publishes preparation as complete (SPEC A §4.2 rules 2, 3 and 9) in
     * one write: `pronta` + `confirmacaoPendente: true`, both areas
     * journaled as `verificado`. The pair must be complete and exclusive —
     * a missing or duplicated projectId (here or in another local
     * organization) leaves the document untouched.
     */
    publicarPronta: (organizacaoId: string, par: ParMaterializado) => {
      store.setState(state => {
        const organizacao = state.organizacoes.find(
          candidata => candidata.id === organizacaoId,
        );
        if (!organizacao || organizacao.estado === 'pronta') {
          return state;
        }

        const projectIds = [par.monitoramento.projectId, par.alertas.projectId];
        if (projectIds.some(projectId => !projectId)) return state;
        if (par.monitoramento.projectId === par.alertas.projectId) {
          return state;
        }
        // Rule 3: both templates must be pinned with a real hash/versao — an
        // empty one would be rejected by the §4.2 parser on the next open.
        if (
          !templateFixado(par.monitoramento.template) ||
          !templateFixado(par.alertas.template)
        ) {
          return state;
        }
        if (
          !projetoSemAssociacao(
            state,
            organizacaoId,
            par.monitoramento.projectId,
          ) ||
          !projetoSemAssociacao(state, organizacaoId, par.alertas.projectId)
        ) {
          return state;
        }

        const comAreaVerificada = (area: Area): EtapaArea => ({
          ...organizacao.materializacao[area],
          etapa: 'verificado',
          projectId: par[area].projectId,
          template: par[area].template,
        });

        return {
          ...state,
          organizacoes: state.organizacoes.map(candidata =>
            candidata.id === organizacaoId
              ? {
                  ...candidata,
                  estado: 'pronta',
                  confirmacaoPendente: true,
                  materializacao: {
                    monitoramento: comAreaVerificada('monitoramento'),
                    alertas: comAreaVerificada('alertas'),
                  },
                  areaEmExecucao: null,
                  ultimoErro: null,
                }
              : candidata,
          ),
        };
      });
    },

    /**
     * Explicit resolution of a hydration failure (SPEC A §5.3): resets to the
     * initial document and clears the MMKV key — a conscious loss of the
     * unreadable registry — and unblocks normal writes. This is the only path
     * through the write block, so it bypasses the guarded setState on purpose.
     */
    resolverFalhaHidratacao: () => {
      // Only an actual hydration failure may be resolved: on a healthy
      // registry this is a no-op, so it can never wipe a valid document.
      if (!store.getState().hidratacaoFalhou) return;
      // A non-persisted store never wrote the durable key; only clear MMKV
      // when this store is the persisted one.
      if (persist) {
        MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
      }
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

export function useCoiabOrganizationsStoreContext() {
  const value = useContext(CoiabOrganizationsStoreContext);

  if (!value) {
    throw new Error('Must set up the CoiabOrganizationsStoreContext');
  }

  return value;
}

export function useCoiabOrganizationsState(): CoiabOrganizationsState {
  const {instance} = useCoiabOrganizationsStoreContext();
  return useStore(instance);
}

export function useCoiabOrganizationsActions() {
  const {actions} = useCoiabOrganizationsStoreContext();
  return actions;
}
