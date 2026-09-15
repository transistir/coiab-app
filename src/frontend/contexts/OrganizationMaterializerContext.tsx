import {createContext, ReactNode, useContext, useMemo} from 'react';
import {useClientApi} from '@comapeo/core-react';
import {useQueryClient} from '@tanstack/react-query';

import {clienteDeCriacao} from '../lib/organization/clienteDeCriacao';
import {
  origemDaOrganizacao,
  verificarEntrada,
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
 * activation engine. `retomar` refuses any id other than the first (and only)
 * organization of the document, so a stale caller can never resume a journal
 * that no longer belongs to it.
 */
export type OrganizationMaterializerHandle = {
  iniciar(nome: string): Promise<void>;
  retomar(organizacaoId: string): Promise<void>;
};

const OrganizationMaterializerContext =
  createContext<OrganizationMaterializerHandle | null>(null);

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
  const materializador = useMemo<OrganizationMaterializerHandle>(() => {
    const fonte = templates ?? criarTemplateSourceInstalado();
    const materializer = createMaterializer({
      client: clienteDeCriacao(clientApi),
      templates: fonte,
      repository: repositorioDoStore(store),
      generateId: generateOrganizationId,
    });
    return {
      iniciar: nome =>
        materializer
          .start(nome)
          .finally(() =>
            queryClient.invalidateQueries({queryKey: projectsQueryKey}),
          ),
      retomar: async organizacaoId => {
        const organizacao = store.instance.getState().organizacoes[0];
        if (!organizacao || organizacao.id !== organizacaoId) {
          throw new Error('organization-not-resumable');
        }
        // SPEC B §5.5 dispatch: a journal whose BOTH areas are accepted
        // invites (no creation snapshot, no template) is an INVITE entry —
        // the resume must CONFIRM it (`verificarEntrada`, through the real
        // creation adapter so the icon proof rides along), never create.
        // Anything else is a creation journal and keeps resuming.
        if (origemDaOrganizacao(organizacao) === 'convite') {
          await verificarEntrada({
            store,
            client: clienteDeCriacao(clientApi),
            templates: fonte,
            organizacaoId,
          }).finally(() =>
            queryClient.invalidateQueries({queryKey: projectsQueryKey}),
          );
        } else {
          await materializer
            .resume()
            .finally(() =>
              queryClient.invalidateQueries({queryKey: projectsQueryKey}),
            );
        }
      },
    };
  }, [store, clientApi, templates, queryClient]);

  return (
    <OrganizationMaterializerContext value={materializador}>
      {children}
    </OrganizationMaterializerContext>
  );
}

/**
 * `null` outside the root provider: consumers must treat absence as "no
 * materialization capability" — the activation engine does exactly that by
 * publishing `preparation-adapter-required` instead of resuming.
 */
export function useOrganizationMaterializer(): OrganizationMaterializerHandle | null {
  return useContext(OrganizationMaterializerContext);
}
