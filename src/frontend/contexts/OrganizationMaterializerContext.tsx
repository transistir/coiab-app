import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {useClientApi} from '@comapeo/core-react';
import {useQueryClient} from '@tanstack/react-query';
import {createStore, useStore, type StoreApi} from 'zustand';

import {
  createArquivoRemotoExecutor,
  criarArquivoRemotoPendente,
  criarRedeArquivoRemoto,
  type ModoArquivoRemoto,
  type ResultadoArquivoRemoto,
} from '../lib/organization/arquivoRemoto';
import {consultarArquivoRemotoAtivo} from '../lib/organization/archiveServer';
import {clienteDeCriacao} from '../lib/organization/clienteDeCriacao';
import type {EstadoSlotArquivoRemoto} from '../lib/organization/documento';
import type {IdentidadeArquivoRemoto} from '../lib/organization/identidadeArquivo';
import {
  confirmarEntrada,
  origemDaOrganizacao,
} from '../lib/organization/entrada';
import {
  createMaterializer,
  type CreationProject,
  type TemplatePackage,
  type TemplateSource,
} from '../lib/organization/materializar';
import {generateOrganizationId} from '../lib/organization/orgId';
import {criarTemplateSourceInstalado} from '../lib/organization/pacotesInstalados';
import {membersQueryKey, projectsQueryKey} from '../lib/organization/queryKeys';
import {repositorioDoStore} from '../lib/organization/repositorio';
import {normalizeRemoteArchiveUrl} from '../utils/normalizeRemoteArchiveUrl';
import {useCoiabOrganizationsStoreContext} from './CoiabOrganizationsStoreContext';

/**
 * The root-owned materialization engine (SPEC B §5.4), mounted once at the
 * root next to the activation driver: `iniciar` registers a new organization
 * (never used to resume) and `retomar` continues the persisted `preparando`
 * journal — the resume adapter `useOrganizationActivation` injects into the
 * activation engine. `retomar` refuses any id absent from the document, and
 * forwards the id to the materializer, which resumes the `preparando` journal
 * of THAT organization — never the first `preparando` entry (#85). An id that
 * exists but is not `preparando` settles as a no-op resume.
 */
export type OrganizationMaterializerHandle = {
  /**
   * #142 fase B: the archive URL is part of the SAME `preparando` write the
   * engine already owns. Omitted means "no archive was requested".
   */
  iniciar(nome: string, opcoes?: {arquivoRemotoUrl?: string}): Promise<void>;
  retomar(organizacaoId: string): Promise<void>;
  /**
   * Explicit archive retry by organization id — the shared journal executor,
   * never a second materialization. It re-reads the target's own project ids
   * from the journal, so it cannot recreate a project, re-import categories
   * or re-confirm the organization.
   */
  retomarArquivo(organizacaoId: string): Promise<ResultadoArquivoRemoto>;
  /**
   * Journalizes a MANUAL request and runs it through the SAME executor/lock.
   * A different URL (or a missing journal entry) resets the archive step to
   * `pendente`; the executor then decides which slots still need a send, so a
   * manual submission can never race an automatic pass.
   */
  solicitarArquivo(
    organizacaoId: string,
    url: string,
  ): Promise<ResultadoArquivoRemoto>;
  /**
   * Durable removal intent, written BEFORE `useRemoveServerPeer` reaches
   * Core. Throws when the journal cannot persist it, so the screen aborts the
   * Core removal instead of removing without a registered intent.
   */
  marcarRemocao(
    projectId: string,
    identidade: IdentidadeArquivoRemoto,
  ): EstadoSlotArquivoRemoto | undefined;
  /**
   * Finalizes a Core removal that succeeded. Returns false while the slot is
   * still `removendo` (checkpoint write failed); the executor keeps retrying
   * and reconciles against Core, so this is never a false success.
   */
  removerArquivo(
    projectId: string,
    identidade: IdentidadeArquivoRemoto,
  ): boolean;
  /**
   * Reconciles a removal whose Core call REJECTED. Core blocks the peer
   * before syncing, so the error alone does not say whether the file became
   * inactive. The journal keeps `removendo` until a Core read decides
   * (`removido` / `concluido`, or stays `removendo` while unreachable).
   */
  reconciliarRemocao(projectId: string): Promise<boolean>;
  /**
   * Restores the pre-removal slot after a PRE-FLIGHT failure, before Core was
   * called. Never used for a Core rejection (see `reconciliarRemocao`).
   */
  cancelarRemocao(
    projectId: string,
    anterior: EstadoSlotArquivoRemoto | undefined,
  ): boolean;
};

const OrganizationMaterializerContext =
  createContext<OrganizationMaterializerHandle | null>(null);

/**
 * Review fronteira P1: how many `iniciar`/`retomar` calls are alive in this
 * session. A document in `preparando` with none alive was interrupted — the
 * provisioning surface must offer a way out instead of a spinner that never
 * ends.
 */
const MaterializacoesVivasContext = createContext<StoreApi<number> | null>(
  null,
);

export function OrganizationMaterializerProvider({
  children,
  templates,
}: {
  children: ReactNode;
  /**
   * Template-package source; omitted in production, where the INSTALLED
   * source (Phase 3) is built. Constructing the installed source does no
   * I/O — every touch happens inside `prepare` — so mounting the provider
   * never reads the filesystem or the asset system.
   */
  templates?: TemplateSource<CreationProject, TemplatePackage>;
}) {
  const store = useCoiabOrganizationsStoreContext();
  const clientApi = useClientApi();
  const queryClient = useQueryClient();
  const [vivas] = useState(() => createStore<number>(() => 0));
  const motor = useMemo(() => {
    const acompanhar = (operacao: () => Promise<void>) => {
      vivas.setState(n => n + 1, true);
      return operacao().finally(() => vivas.setState(n => n - 1, true));
    };
    const fonte = templates ?? criarTemplateSourceInstalado();
    // One repository object and one network adapter feed BOTH the
    // materializer and the root executor: the journal's live-promise guards
    // are keyed by the repository object, so a remount joins the same sends
    // instead of duplicating them.
    const repository = repositorioDoStore(store);
    const redeArquivoRemoto = criarRedeArquivoRemoto(projectId =>
      clientApi.getProject(projectId),
    );
    const consultarArquivo = (
      projectId: string,
      identidade: IdentidadeArquivoRemoto,
    ) =>
      consultarArquivoRemotoAtivo(
        id => clientApi.getProject(id),
        projectId,
        identidade,
      );
    const executorArquivoRemoto = createArquivoRemotoExecutor({
      repository,
      rede: redeArquivoRemoto,
      // Same Core read `useActiveArchiveServer` exposes: only a durable
      // `removendo` slot uses it, at boot or on the checkpoint timer.
      consultarArquivo,
      // The member cache of a project changes when the server REALLY applies
      // the archive — even if that response lands after the 60 s deadline.
      // Invalidate per slot on the real settlement; the executor's return is
      // no longer a cache signal (a timeout is not a server effect).
      onEnvioConcluido: ({projectId}) => {
        void queryClient.invalidateQueries({
          queryKey: membersQueryKey(projectId),
        });
      },
    });
    const materializer = createMaterializer({
      client: clienteDeCriacao(clientApi),
      templates: fonte,
      repository,
      generateId: generateOrganizationId,
      // The SAME configured executor the manual/boot paths use: the creation
      // path's late settlement must refresh members exactly like an explicit
      // retry. A second executor here would silently skip that callback.
      executorArquivoRemoto,
    });
    /**
     * The shared archive operation: re-reads the target by id and delegates to
     * the journal executor (never the materializer). Member queries are
     * refreshed by the executor's per-send callback, not here: returning from
     * a deadline-expired pass must not claim the server already applied it.
     */
    const executarArquivo = (
      organizacaoId: string,
      modo: ModoArquivoRemoto,
    ): Promise<ResultadoArquivoRemoto> =>
      executorArquivoRemoto.executar(organizacaoId, {modo});
    /**
     * #142 fase C1: the manual screen's request is journalized before it runs.
     * The journal URL is the single source of truth for the executor, and the
     * shared repository-keyed lock makes a concurrent automatic pass join or
     * refuse instead of doubling the network calls.
     */
    const solicitarArquivo = async (
      organizacaoId: string,
      url: string,
    ): Promise<ResultadoArquivoRemoto> => {
      const normalizada = normalizeRemoteArchiveUrl(url);
      const lerAtual = () => {
        const documento = repository.read();
        const organizacao = documento.organizacoes.find(
          item => item.id === organizacaoId,
        );
        if (!organizacao) throw new Error('organization-not-found');
        return {documento, arquivo: organizacao.arquivoRemoto};
      };
      const inicial = lerAtual();
      const mesmaUrl = inicial.arquivo?.url === normalizada;
      const remocaoPendente =
        inicial.arquivo !== undefined &&
        (inicial.arquivo.slots.m.estado === 'removendo' ||
          inicial.arquivo.slots.a.estado === 'removendo');
      // #142 review P2 (5ª rodada): the journal must not be replaced while an
      // archive operation is unresolved. This is checked on the DURABLE slots,
      // not only on a live promise: after a failed Core read the removal stays
      // `removendo`, and after a restart every in-memory guard is gone. A new
      // URL is refused until the removal is reconciled — the old intention is
      // never erased and can never turn into a false `concluido`.
      if (!mesmaUrl) {
        // A durable `removendo` may have reached Core before the checkpoint
        // write failed. Resolve it first; this does NOT select or send a slot.
        await executorArquivoRemoto.reconciliar(organizacaoId);
        if (executorArquivoRemoto.emAndamento(organizacaoId)) {
          const atual = lerAtual();
          return {
            estado: 'em-andamento',
            slots: atual.arquivo ? {...atual.arquivo.slots} : {},
          };
        }
        // Re-read AFTER the reconciliation: it may have written the resolved
        // slot, and the replacement must start from the current document.
        const atual = lerAtual();
        repository.write({
          ...atual.documento,
          organizacoes: atual.documento.organizacoes.map(item =>
            item.id === organizacaoId
              ? {
                  ...item,
                  arquivoRemoto: criarArquivoRemotoPendente(normalizada),
                }
              : item,
          ),
        });
      } else if (remocaoPendente) {
        // Re-adding the SAME URL while a removal is unresolved: Core may have
        // blocked before failing, so reconcile first. If it cannot be
        // resolved, the new request is refused and the intent stays untouched.
        await executorArquivoRemoto.reconciliar(organizacaoId);
        if (executorArquivoRemoto.emAndamento(organizacaoId)) {
          const atual = lerAtual();
          return {
            estado: 'em-andamento',
            slots: atual.arquivo ? {...atual.arquivo.slots} : {},
          };
        }
      }
      const atual = lerAtual().arquivo;
      // An interrupted/in-flight pass keeps its replay budget and joins the
      // live execution; anything else is the user's explicit retry. A pending
      // removal is always explicit: the user is deliberately re-adding the
      // archive, so the automatic selector must not swallow it.
      const temRemocaoPendente =
        atual !== undefined &&
        (atual.slots.m.estado === 'removendo' ||
          atual.slots.a.estado === 'removendo');
      const modo: ModoArquivoRemoto =
        mesmaUrl && atual?.estado === 'aplicando' && !temRemocaoPendente
          ? 'automatico'
          : 'retry';
      return executarArquivo(organizacaoId, modo);
    };
    const retomar = async (organizacaoId: string) => {
      const organizacao = store.instance
        .getState()
        .organizacoes.find(o => o.id === organizacaoId);
      if (!organizacao) {
        throw new Error('organization-not-resumable');
      }
      // #142 fase B: a `pronta` organization whose archive step is still
      // pending is resumed through the SAME entry point — but only the
      // archive step runs. Re-dispatching it as a creation resume would be a
      // second materialization loop (and `resume` would no-op anyway).
      if (
        organizacao.estado === 'pronta' &&
        organizacao.arquivoRemoto !== undefined &&
        organizacao.arquivoRemoto.estado !== 'concluido' &&
        organizacao.arquivoRemoto.estado !== 'removido'
      ) {
        await executarArquivo(organizacaoId, 'retry');
        return;
      }
      // SPEC B §5.5 dispatch: a journal whose BOTH areas are accepted
      // invites (no creation snapshot, no template) is an INVITE entry —
      // the resume must CONFIRM it (`verificarEntrada`, through the real
      // creation adapter so the icon proof rides along), never create.
      // Anything else is a creation journal and keeps resuming.
      if (origemDaOrganizacao(organizacao) === 'convite') {
        await confirmarEntrada({
          store,
          client: clienteDeCriacao(clientApi),
          templates: fonte,
          organizacaoId,
        }).finally(() =>
          queryClient.invalidateQueries({
            queryKey: projectsQueryKey,
            exact: true,
          }),
        );
      } else {
        await materializer.resume(organizacaoId).finally(() =>
          queryClient.invalidateQueries({
            queryKey: projectsQueryKey,
            exact: true,
          }),
        );
      }
    };
    const handle: OrganizationMaterializerHandle = {
      iniciar: (nome, opcoes) =>
        acompanhar(() =>
          materializer.start(nome, opcoes).finally(() =>
            queryClient.invalidateQueries({
              queryKey: projectsQueryKey,
              exact: true,
            }),
          ),
        ),
      retomar: organizacaoId => acompanhar(() => retomar(organizacaoId)),
      retomarArquivo: organizacaoId => executarArquivo(organizacaoId, 'retry'),
      solicitarArquivo: (organizacaoId, url) =>
        solicitarArquivo(organizacaoId, url),
      marcarRemocao: (projectId, identidade) =>
        executorArquivoRemoto.marcarRemocao(projectId, identidade),
      removerArquivo: (projectId, identidade) =>
        executorArquivoRemoto.removerArquivo(projectId, identidade),
      reconciliarRemocao: projectId =>
        executorArquivoRemoto.reconciliarRemocao(projectId),
      cancelarRemocao: (projectId, anterior) =>
        executorArquivoRemoto.cancelarRemocao(projectId, anterior),
    };
    return {handle, executarArquivo};
  }, [store, clientApi, templates, queryClient, vivas]);

  const materializador = motor.handle;
  const {executarArquivo} = motor;

  // An interrupted `aplicando` keeps its durable replay budget, so it is
  // resumed in automatic mode. A recorded failure is NOT retried by the boot:
  // `retry` is user-paced and only ever reaches the executor through an
  // explicit action (the provisioning button / manual request). Otherwise a
  // boot would reset `replayConsumido` and resend a budget the durable
  // journal had already spent. Every write is patched by organization id, so
  // a late conclusion never touches another organization nor the active
  // selection.
  useEffect(() => {
    const organizacoes = store.instance.getState().organizacoes;
    for (const organizacao of organizacoes) {
      const arquivo = organizacao.arquivoRemoto;
      if (organizacao.estado !== 'pronta' || !arquivo) continue;
      // Terminal aggregate states are never reopened by a boot. `removido`
      // means the user removed the archive; only an explicit request re-adds.
      if (arquivo.estado === 'concluido' || arquivo.estado === 'removido')
        continue;
      // The executor already bounds and catches its own sends; a repository
      // read/write failure must not surface as an unhandled rejection.
      void executarArquivo(organizacao.id, 'automatico').catch(() => {});
    }
  }, [executarArquivo, store]);

  return (
    <OrganizationMaterializerContext value={materializador}>
      <MaterializacoesVivasContext value={vivas}>
        {children}
      </MaterializacoesVivasContext>
    </OrganizationMaterializerContext>
  );
}

/**
 * Whether a materialization (creation or resume) is alive in this session;
 * `false` outside the root provider, where nothing can materialize.
 */
export function useMaterializacaoViva(): boolean {
  const vivas = useContext(MaterializacoesVivasContext);
  return useStore(vivas ?? SEM_MATERIALIZADOR, n => n > 0);
}
const SEM_MATERIALIZADOR = createStore<number>(() => 0);

/**
 * `null` outside the root provider: consumers must treat absence as "no
 * materialization capability" — the activation engine does exactly that by
 * publishing `preparation-adapter-required` instead of resuming.
 */
export function useOrganizationMaterializer(): OrganizationMaterializerHandle | null {
  return useContext(OrganizationMaterializerContext);
}
