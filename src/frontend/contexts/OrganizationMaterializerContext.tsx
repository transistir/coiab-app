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
import {clienteDeCriacao} from '../lib/organization/clienteDeCriacao';
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
import {SLOTS, type Slot} from '../lib/organization/marker';
import {membersQueryKey, projectsQueryKey} from '../lib/organization/queryKeys';
import {repositorioDoStore} from '../lib/organization/repositorio';
import {normalizeRemoteArchiveUrl} from '../utils/normalizeRemoteArchiveUrl';
import {useCoiabOrganizationsStoreContext} from './CoiabOrganizationsStoreContext';

const AREA_DO_SLOT: Record<Slot, 'monitoramento' | 'alertas'> = {
  m: 'monitoramento',
  a: 'alertas',
};

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
    const executorArquivoRemoto = createArquivoRemotoExecutor({
      repository,
      rede: redeArquivoRemoto,
    });
    const materializer = createMaterializer({
      client: clienteDeCriacao(clientApi),
      templates: fonte,
      repository,
      generateId: generateOrganizationId,
      arquivoRemoto: redeArquivoRemoto,
    });
    /** Invalidate the member list of every slot this organization owns. */
    const invalidarMembros = async (organizacaoId: string) => {
      const organizacao = store.instance
        .getState()
        .organizacoes.find(o => o.id === organizacaoId);
      if (!organizacao) return;
      await Promise.all(
        SLOTS.map(slot => {
          const projectId =
            organizacao.materializacao[AREA_DO_SLOT[slot]].projectId;
          return projectId
            ? queryClient.invalidateQueries({
                queryKey: membersQueryKey(projectId),
              })
            : undefined;
        }),
      );
    };
    /**
     * The shared archive operation: re-reads the target by id, delegates to
     * the journal executor (never the materializer) and refreshes only that
     * organization's member queries.
     */
    const executarArquivo = async (
      organizacaoId: string,
      modo: ModoArquivoRemoto,
    ): Promise<ResultadoArquivoRemoto> => {
      const resultado = await executorArquivoRemoto.executar(organizacaoId, {
        modo,
      });
      await invalidarMembros(organizacaoId);
      return resultado;
    };
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
      const documento = repository.read();
      const organizacao = documento.organizacoes.find(
        item => item.id === organizacaoId,
      );
      if (!organizacao) throw new Error('organization-not-found');
      const atual = organizacao.arquivoRemoto;
      const mesmaUrl = atual?.url === normalizada;
      // #142 review P2: the journal must not be replaced while a pass is
      // alive. A second URL is REFUSED by the shared lock, preserving the
      // live attempt's URL, tentativaId and slot states; a refusal is never
      // a journal write that the executor will not run.
      if (!mesmaUrl && executorArquivoRemoto.emAndamento(organizacaoId)) {
        return {
          estado: 'em-andamento',
          slots: atual ? {...atual.slots} : {},
        };
      }
      if (!mesmaUrl) {
        repository.write({
          ...documento,
          organizacoes: documento.organizacoes.map(item =>
            item.id === organizacaoId
              ? {
                  ...item,
                  arquivoRemoto: criarArquivoRemotoPendente(normalizada),
                }
              : item,
          ),
        });
      }
      // An interrupted/in-flight pass keeps its replay budget and joins the
      // live execution; anything else is the user's explicit retry.
      const modo: ModoArquivoRemoto =
        mesmaUrl && atual?.estado === 'aplicando' ? 'automatico' : 'retry';
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
        organizacao.arquivoRemoto.estado !== 'concluido'
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
          queryClient.invalidateQueries({queryKey: projectsQueryKey}),
        );
      } else {
        await materializer
          .resume(organizacaoId)
          .finally(() =>
            queryClient.invalidateQueries({queryKey: projectsQueryKey}),
          );
      }
    };
    const handle: OrganizationMaterializerHandle = {
      iniciar: (nome, opcoes) =>
        acompanhar(() =>
          materializer
            .start(nome, opcoes)
            .finally(() =>
              queryClient.invalidateQueries({queryKey: projectsQueryKey}),
            ),
        ),
      retomar: organizacaoId => acompanhar(() => retomar(organizacaoId)),
      retomarArquivo: organizacaoId => executarArquivo(organizacaoId, 'retry'),
      solicitarArquivo: (organizacaoId, url) =>
        solicitarArquivo(organizacaoId, url),
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
      if (arquivo.estado === 'concluido') continue;
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
