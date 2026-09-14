import {
  COIAB_ORGANIZATIONS_STORAGE_KEY,
  type CoiabOrganizationsStore,
} from '../../contexts/CoiabOrganizationsStoreContext';
import {
  parseEstadoOrganizacoes,
  type EstadoOrganizacoes,
} from './coiabOrganizations';
import type {OrganizationRepository} from './materializar';

/**
 * Production `OrganizationRepository` over the persisted COIAB store
 * (SPEC A §4.2/D3). The store's guarded `setState` writes MMKV first and
 * publishes second, so a failed disk write can never expose an uncommitted
 * document — but it also no-ops silently while a hydration failure is
 * unresolved. The materializer's contract is "throwing leaves the previous
 * document intact" (`materializar.ts`): a silent no-op would lose the
 * `criando` checkpoint, let `createProject` run anyway, and the next resume
 * would create a duplicate — so every guard here THROWS, never swallows.
 */

// Identity must be stable: the materializer's lock registry keys on the
// repository object (materializar.ts `runningRepositories`), so two
// `repositorioDoStore(store)` calls for one store MUST return one object —
// otherwise concurrent operations would not share their exclusive token.
const repositorios = new WeakMap<
  CoiabOrganizationsStore,
  OrganizationRepository
>();

function estadoAtual(store: CoiabOrganizationsStore): EstadoOrganizacoes {
  const state = store.instance.getState();
  if (state.hidratacaoFalhou) throw 'hydration-failed';
  if (state.organizacoes.length > 1) {
    throw 'multiple-organizations-unsupported';
  }
  return {
    versao: state.versao,
    organizacoes: state.organizacoes,
    ativa: state.ativa,
  };
}

function criarRepositorio(
  store: CoiabOrganizationsStore,
): OrganizationRepository {
  return {
    read: () => estadoAtual(store),
    write(document: EstadoOrganizacoes): void {
      estadoAtual(store);
      // Never persist a document the §4.2 parser would reject on the next
      // open (SPEC A §5.3) — a corrupt write would brick the registry.
      if (!parseEstadoOrganizacoes(document)) throw 'invalid-document';
      store.instance.setState({
        versao: document.versao,
        organizacoes: document.organizacoes,
        ativa: document.ativa,
      });
      // The guarded setState writes MMKV BEFORE publishing; only a write
      // that landed can make the published array the very same reference.
      if (store.instance.getState().organizacoes !== document.organizacoes) {
        throw 'organization-write-rejected';
      }
    },
  };
}
export function repositorioDoStore(
  store: CoiabOrganizationsStore,
): OrganizationRepository {
  let repositorio = repositorios.get(store);
  if (!repositorio) {
    repositorio = criarRepositorio(store);
    repositorios.set(store, repositorio);
  }
  return repositorio;
}
