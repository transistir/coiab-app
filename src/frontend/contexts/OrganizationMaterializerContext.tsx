import {createContext, ReactNode, useContext, useMemo, useState} from 'react';
import {useClientApi} from '@comapeo/core-react';
import {useQueryClient} from '@tanstack/react-query';
import {createStore, useStore, type StoreApi} from 'zustand';

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
import {projectsQueryKey} from '../lib/organization/queryKeys';
import {repositorioDoStore} from '../lib/organization/repositorio';
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
  iniciar(nome: string): Promise<void>;
  retomar(organizacaoId: string): Promise<void>;
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
  const materializador = useMemo<OrganizationMaterializerHandle>(() => {
    const acompanhar = (operacao: () => Promise<void>) => {
      vivas.setState(n => n + 1, true);
      return operacao().finally(() => vivas.setState(n => n - 1, true));
    };
    const fonte = templates ?? criarTemplateSourceInstalado();
    const materializer = createMaterializer({
      client: clienteDeCriacao(clientApi),
      templates: fonte,
      repository: repositorioDoStore(store),
      generateId: generateOrganizationId,
    });
    const retomar = async (organizacaoId: string) => {
      const organizacao = store.instance
        .getState()
        .organizacoes.find(o => o.id === organizacaoId);
      if (!organizacao) {
        throw new Error('organization-not-resumable');
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
    return {
      iniciar: nome =>
        acompanhar(() =>
          materializer
            .start(nome)
            .finally(() =>
              queryClient.invalidateQueries({queryKey: projectsQueryKey}),
            ),
        ),
      retomar: organizacaoId => acompanhar(() => retomar(organizacaoId)),
    };
  }, [store, clientApi, templates, queryClient, vivas]);

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
