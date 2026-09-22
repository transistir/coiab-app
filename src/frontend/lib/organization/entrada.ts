import type {CoiabOrganizationsStore} from '../../contexts/CoiabOrganizationsStoreContext';
import {
  COORDINATOR_ROLE_ID,
  CREATOR_ROLE_ID,
  MEMBER_ROLE_ID,
} from '../../sharedTypes';
import {
  AREAS,
  type Area,
  type OrganizacaoLocal,
  type TemplateRef,
} from './documento';
import type {
  CreationClient,
  CreationProject,
  TemplatePackage,
  TemplateSource,
} from './materializar';
import type {ProjetoComPresets} from './pacotes';
import type {LocalProjectRow} from './reconstruct';

/**
 * Invite acceptance on a JOINED organization (SPEC B §5.5): the document
 * already holds the organization as `preparando` — registered by
 * `registrarEntradaPorConvite` with both accepted projectIds journaled as
 * `criado` — and this module CONFIRMS the entry against the live device
 * before `publicarPronta` publishes `pronta`. It never creates anything:
 * the projects already exist in Core (the inviter's), so `createProject`,
 * `$importCategories` and `$setProjectSettings` must never run here.
 */

/** A joined project exposes Core's own-role read plus the creation surface. */
export type ProjetoDeEntrada = CreationProject &
  ProjetoComPresets & {
    readonly $getOwnRole: () => Promise<{roleId: string}>;
  };

/**
 * Where a journal came from (SPEC B §5.5 dispatch): `'convite'` iff BOTH
 * areas hold an accepted project (projectId ≠ null) with NO creation
 * snapshot (`idsAntesDaCriacao === null`) and NO local template yet. A
 * creation can never satisfy that: the materializer snapshots the project
 * ids BEFORE creating (`criando`/`criado` keep `idsAntesDaCriacao` as a
 * non-null array) and a verified area carries a template, so at least one
 * area always fails the predicate.
 */
export function origemDaOrganizacao(
  organizacao: OrganizacaoLocal,
): 'criacao' | 'convite' {
  const areaPorConvite = (area: Area): boolean => {
    const etapa = organizacao.materializacao[area];
    return (
      etapa.projectId !== null &&
      etapa.idsAntesDaCriacao === null &&
      etapa.template === null
    );
  };
  return AREAS.every(areaPorConvite) ? 'convite' : 'criacao';
}

/** Invite-acceptance client: rows carry the join status (SPEC B §5.5). */
export type ClienteDeEntrada = Omit<
  CreationClient<ProjetoDeEntrada>,
  'listProjects'
> & {
  listProjects(): Promise<Array<LocalProjectRow>>;
};

/**
 * Confirms an invite entry (SPEC B §5.5). Per area, in order: the Core row
 * must be `joined` (`'join-pending'` while the accepted invite still
 * syncs), the device must hold a real role on it (`'access-unavailable'`)
 * and the inviter's categories must match the canonical package
 * (`'categories-not-synced'` — verified, never re-imported). With both
 * areas confirmed, `publicarPronta` publishes `pronta` + pending
 * confirmation in one write with the EMBEDDED refs; the postcondition
 * (`estado === 'pronta'`) is asserted, so a refused publication surfaces
 * instead of a silently stuck document.
 */
export async function verificarEntrada({
  store,
  client,
  templates,
  organizacaoId,
}: {
  store: CoiabOrganizationsStore;
  client: ClienteDeEntrada;
  templates: TemplateSource<ProjetoDeEntrada, TemplatePackage>;
  organizacaoId: string;
}): Promise<void> {
  const organizacao = store.instance
    .getState()
    .organizacoes.find(candidata => candidata.id === organizacaoId);
  // Already `pronta`: the confirmation published once — nothing to verify,
  // and `publicarPronta` refuses an already-ready organization.
  if (!organizacao || organizacao.estado === 'pronta') {
    throw new Error('organization-not-found');
  }

  const rows = await client.listProjects();
  const pacotes = await templates.prepare();
  const par = {} as Record<Area, {projectId: string; template: TemplateRef}>;
  for (const area of AREAS) {
    const projectId = organizacao.materializacao[area].projectId;
    if (!projectId) throw new Error('join-pending');
    const row = rows.find(candidata => candidata.projectId === projectId);
    // Core keeps exposing a non-left row while the accepted invite is
    // still `joining` — the entry may only be confirmed once the device
    // actually holds the project.
    if (!row || row.status !== 'joined') throw new Error('join-pending');
    const project = await client.getProject(projectId);
    const {roleId} = await project.$getOwnRole();
    if (
      roleId !== CREATOR_ROLE_ID &&
      roleId !== COORDINATOR_ROLE_ID &&
      roleId !== MEMBER_ROLE_ID
    ) {
      throw new Error('access-unavailable');
    }
    // The categories were imported by the INVITER: verify against the
    // package, never `$importCategories` over them.
    if (!(await templates.verify(project, pacotes[area], projectId))) {
      throw new Error('categories-not-synced');
    }
    par[area] = {projectId, template: pacotes[area].ref};
  }

  store.actions.publicarPronta(organizacaoId, par);
  const publicado = store.instance
    .getState()
    .organizacoes.find(candidata => candidata.id === organizacaoId);
  if (!publicado || publicado.estado !== 'pronta') {
    throw new Error('publicar-pronta-recusado');
  }
}

export const PRAZO_JOIN_MS = 60_000;
export const INTERVALO_JOIN_MS = 500;

/**
 * Core resolves `invite.accept` while the accepted rows can still read
 * `joining`, so an entry confirmed right after the accept would record a
 * `falha_recuperavel` for an organization that is merely still syncing.
 * Only `'join-pending'` is waited out — re-checked every `INTERVALO_JOIN_MS`
 * up to `PRAZO_JOIN_MS`, after which it surfaces like any other failure (the
 * provisioning surface offers the retry). Every other refusal surfaces at
 * once. The packages are prepared ONCE for the whole wait (`prepare` opens
 * and hashes both packages); only the cheap row check is repeated.
 */
export async function confirmarEntrada(
  deps: Parameters<typeof verificarEntrada>[0],
): Promise<void> {
  const {templates} = deps;
  let pacotes: ReturnType<typeof templates.prepare> | undefined;
  const templatesPreparadosUmaVez: typeof templates = {
    prepare: () => (pacotes ??= templates.prepare()),
    verify: (project, pacote, projectId) =>
      templates.verify(project, pacote, projectId),
  };
  const inicio = Date.now();
  for (;;) {
    try {
      return await verificarEntrada({
        ...deps,
        templates: templatesPreparadosUmaVez,
      });
    } catch (error) {
      const pendente =
        error instanceof Error && error.message === 'join-pending';
      if (!pendente || Date.now() - inicio >= PRAZO_JOIN_MS) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, INTERVALO_JOIN_MS));
  }
}
