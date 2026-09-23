import {createContext, ReactNode, useContext} from 'react';
import {createStore, useStore} from 'zustand';

import {MMKVStoreInitializer} from '../hooks/persistedState/createPersistedState';
import {
  AREAS,
  Area,
  EstadoOrganizacoes,
  EtapaArea,
  OrganizacaoLocal,
  TemplateRef,
  criarEstadoInicialOrganizacoes,
  parseEstadoOrganizacoes,
} from '../lib/organization/coiabOrganizations';
import {ORGANIZATION_ID_PATTERN} from '../lib/organization/marker';

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
    // A read that THROWS (a broken storage adapter) is a hydration failure
    // like an unreadable document (SPEC A §5.3): the failure is exposed on
    // the store so the recovery flow renders — it must never crash the
    // construction itself and take the recovery UI down with it.
    let raw: string | null | undefined;
    try {
      raw = MMKVStoreInitializer.getItem(COIAB_ORGANIZATIONS_STORAGE_KEY) as
        string | null | undefined;
    } catch {
      raw = undefined;
      initial = {...initial, hidratacaoFalhou: true};
    }
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
     * Registers an organization entered by ACCEPTING an invite (SPEC A §4.2
     * rule 9) in ONE write. Decision #25 keeps the MVP open to multiple
     * organizations per device: the accepted entry is appended to the
     * document, or replaces its own entry in place when the same
     * organization id is re-delivered and that entry is still `preparando`
     * or `falha_recuperavel` (the re-preparation path, idempotent for an
     * identical bundle) — every other entry survives, and the `ativa` slot
     * never changes here (only an explicit activation moves it).
     * Refusals return `false` with NO write — a half-registered entry
     * is never published: the organization id must match the marker
     * pattern, ids must be pairwise distinct within the bundle (the
     * organization id must differ from both project ids and the two project
     * ids must differ — otherwise the §4.2 parser would reject the document
     * on the next open), and a projectId already associated with a
     * DIFFERENT local organization is a collision (§4.2 rule 2), and an
     * organization that already reached `pronta` refuses any re-delivery —
     * its journal already holds the true projectIds, so accepting again
     * could only downgrade the entry. The
     * journal carries the accepted projectIds as `criado` with
     * `template: null` and no creation snapshot — this device created
     * nothing; `verificarEntrada` (SPEC B §5.5) confirms the join, role and
     * categories before `publicarPronta` publishes `pronta`.
     */
    registrarEntradaPorConvite: (p: {
      organizacaoId: string;
      nome: string;
      projectIds: Record<Area, string>;
    }): boolean => {
      const state = store.getState();
      // Blocked while a hydration failure is unresolved (SPEC A §5.3).
      if (state.hidratacaoFalhou) return false;
      if (!ORGANIZATION_ID_PATTERN.test(p.organizacaoId)) return false;
      const nome = p.nome.trim();
      if (nome === '') return false;
      // Each project id is globally unique across the document (§4.2 rule 2)
      // and never equals the organization id (the §4.2 parser rejects it).
      const associados = new Set<string>([p.organizacaoId]);
      for (const area of AREAS) {
        const projectId = p.projectIds[area];
        if (!projectId || associados.has(projectId)) return false;
        associados.add(projectId);
      }
      // §4.2 rule 2: a projectId already associated with a DIFFERENT local
      // organization is a collision — the invite is refused before any
      // write, so the document is never half-registered or corrupted.
      for (const area of AREAS) {
        if (!projetoSemAssociacao(state, p.organizacaoId, p.projectIds[area])) {
          return false;
        }
      }
      // A re-delivery for an organization that already reached `pronta` is
      // refused with NO write: its journal already holds the true
      // projectIds — accepting again would only downgrade the entry
      // (estado back to `preparando`, pinned templates reset to `criado`,
      // pending confirmation reset). `preparando` and `falha_recuperavel`
      // keep the in-place replace as the re-preparation path.
      const existente = state.organizacoes.find(
        item => item.id === p.organizacaoId,
      );
      if (existente?.estado === 'pronta') return false;
      const novaEntrada: OrganizacaoLocal = {
        id: p.organizacaoId,
        nome,
        estado: 'preparando',
        confirmacaoPendente: false,
        materializacao: {
          monitoramento: {
            etapa: 'criado',
            projectId: p.projectIds.monitoramento,
            template: null,
            idsAntesDaCriacao: null,
          },
          alertas: {
            etapa: 'criado',
            projectId: p.projectIds.alertas,
            template: null,
            idsAntesDaCriacao: null,
          },
        },
        areaEmExecucao: null,
        ultimoErro: null,
      };
      store.setState(current => ({
        ...current,
        // N-safe upsert: append the accepted entry, or replace its own entry
        // in place on a re-delivery of the same organization id. Every other
        // entry — and `ativa` — is carried over untouched by the spread.
        organizacoes: current.organizacoes.some(
          existente => existente.id === p.organizacaoId,
        )
          ? current.organizacoes.map(existente =>
              existente.id === p.organizacaoId ? novaEntrada : existente,
            )
          : [...current.organizacoes, novaEntrada],
      }));
      return true;
    },

    /**
     * Publishes preparation as complete (SPEC A §4.2 rules 2, 3 and 9) in
     * one write: `pronta` + `confirmacaoPendente: true`, both areas
     * journaled as `verificado`. The pair must be complete and exclusive —
     * a missing or duplicated projectId (here or in another local
     * organization) leaves the document untouched, and so does an id that
     * contradicts a non-null journaled one.
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

        // An area whose journal already holds a projectId is bound to the
        // project created in core: publishing a different id for it would
        // overwrite the journal, orphan that project and lose the recovery
        // link. Only an area with a null journal accepts the supplied id.
        const journalDivergente = (area: Area): boolean => {
          const journalizado = organizacao.materializacao[area].projectId;
          return !!journalizado && journalizado !== par[area].projectId;
        };
        if (
          journalDivergente('monitoramento') ||
          journalDivergente('alertas')
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
