import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import {CREATOR_ROLE_ID} from './fanout';
import {
  AREAS,
  type Area,
  type EstadoOrganizacoes,
  type OrganizacaoLocal,
  type TemplateRef,
} from './documento';

export type OrganizationRepository = {
  read(): EstadoOrganizacoes;
  /** Must persist before publishing; throwing leaves the previous document intact. */
  write(document: EstadoOrganizacoes): void;
};
export type TemplatePackage = {ref: TemplateRef; filePath: string};
export type CreationProject = {
  $member: {
    getById(
      id: string,
    ): Promise<{name?: string; deviceType?: string; role: {roleId: string}}>;
  };
  $importCategories(options: {filePath: string}): Promise<unknown>;
  $setProjectSettings(settings: {
    name: string;
    sendStats: boolean;
  }): Promise<unknown>;
  /** SPEC B §5.4 step 6: the final conferência reads the settings back. */
  $getProjectSettings(): Promise<{name?: string; sendStats?: boolean}>;
};
export type CreationClient<P extends CreationProject> = {
  getDeviceInfo: ComapeoCoreClientApi['getDeviceInfo'];
  setDeviceInfo: ComapeoCoreClientApi['setDeviceInfo'];
  listProjects(): Promise<Array<{projectId: string}>>;
  createProject(options: {name: string; configPath: string}): Promise<string>;
  getProject(id: string): Promise<P>;
};
/**
 * Injectable template-package adapter — the wire point for the REAL #30
 * validation, implemented in `./pacotes` (`criarTemplateSourceDePacotes`):
 * `prepare` opens both canonical packages with `abrirPacote` BEFORE any
 * project is created — existence, size > 0, SHA-256 against the pinned
 * distribution ref and canonical content with `versao === ref.versao`
 * (SPEC B §5.2/CA5) — and `verify` delegates to `verificarImportacao`, which
 * reopens the package and compares the imported categories against its
 * canonical content after `$importCategories`. Typed `ErroPacote`
 * (`{codigo, filePath}`) failures propagate out of `start` before anything is
 * created or persisted, and turn a resumed `preparando` document into
 * `falha_recuperavel` via `fail()` (§3.2), keeping exclusion and the journal
 * below untouched.
 */
export type TemplateSource<P, T extends TemplatePackage> = {
  prepare(refs?: Record<Area, TemplateRef | null>): Promise<Record<Area, T>>;
  verify(project: P, template: T, projectId: string): Promise<boolean>;
};
const NAMES = {monitoramento: 'Monitoramento', alertas: 'Alertas'} as const;

// Shared across hook instances/remounts, scoped to the native client process.
const running = new WeakMap<object, Promise<void>>();
const runningRepositories = new WeakMap<object, Promise<void>>();

/**
 * Identity of a creation operation (SPEC B §5.4): every operation started
 * through `exclusive()` carries the organization it belongs to. The object
 * REFERENCE is the operation token; the repository-keyed registry below makes
 * only the active operation on a journal alive, so a late Core callback from
 * an externally replaced journal can never be attributed to the new journal.
 */
type Operacao = {organizacaoId: string | null};
const operacoes = new WeakMap<object, Operacao>();

/** Internal signal: the operation was superseded — exit without writing. */
class OperacaoExpirada extends Error {
  constructor() {
    super('operacao-expirada');
    this.name = 'OperacaoExpirada';
  }
}

export function organizationNameError(
  name: string,
): 'required' | 'tooLong' | 'singleLine' | null {
  if (!name.trim()) return 'required';
  if (name.length > 60) return 'tooLong';
  if (
    [...name].some(
      char =>
        char.charCodeAt(0) < 32 ||
        (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159),
    ) ||
    // U+2028/U+2029 (line/paragraph separator) — written via charCode so the
    // source stays pure ASCII while matching the same forbidden characters.
    name.includes(String.fromCharCode(8232)) ||
    name.includes(String.fromCharCode(8233))
  )
    return 'singleLine';
  return null;
}

export function createMaterializer<
  P extends CreationProject,
  T extends TemplatePackage,
>({
  client,
  templates,
  repository,
  generateId,
}: {
  client: CreationClient<P>;
  templates: TemplateSource<P, T>;
  repository: OrganizationRepository;
  generateId(): string;
}) {
  const current = () => repository.read().organizacoes[0]!;
  const save = (org: OrganizacaoLocal) =>
    repository.write({...repository.read(), organizacoes: [org]});

  /**
   * An operation is alive ONLY while it is the latest one registered for this
   * repository AND the persisted journal still belongs to its organization —
   * checkpoints confirm the identity of the journal they are about to alter.
   */
  function operacaoViva(op: Operacao): boolean {
    return (
      operacoes.get(repository) === op &&
      op.organizacaoId !== null &&
      repository.read().organizacoes[0]?.id === op.organizacaoId
    );
  }
  function assertViva(op: Operacao): void {
    if (!operacaoViva(op)) throw new OperacaoExpirada();
  }

  /** Journal checkpoint: refuses to write for a superseded operation. */
  const checkpoint = (
    op: Operacao,
    area: Area,
    patch: Partial<OrganizacaoLocal['materializacao'][Area]>,
  ) => {
    assertViva(op);
    const org = current();
    save({
      ...org,
      areaEmExecucao: patch.etapa === 'verificado' ? null : area,
      materializacao: {
        ...org.materializacao,
        [area]: {...org.materializacao[area], ...patch},
      },
    });
  };

  /**
   * SPEC B §5.4 step 6 — the final conferência executed BEFORE `pronta` is
   * published, both on a fresh creation and on a resumed document whose areas
   * are already verified. It is a LIGHT read verification, never a re-import:
   * both projects are reopened in Core by their public ids, the ids must be
   * distinct, each project's settings are read back ($getProjectSettings:
   * canonical name + sendStats off), the imported categories are re-verified
   * against the package (`templates.verify`) and the own member is confirmed
   * initialized with the creator role. Any divergence throws and routes to
   * `falha_recuperavel` with the journal preserved.
   */
  async function conferenciaFinal(op: Operacao, packages: Record<Area, T>) {
    assertViva(op);
    const ids = {} as Record<Area, string>;
    for (const area of AREAS) {
      const projectId = current().materializacao[area].projectId;
      if (!projectId) throw new Error('conference-missing-projects');
      ids[area] = projectId;
    }
    if (ids.monitoramento === ids.alertas) {
      throw new Error('conference-duplicate-projects');
    }
    for (const area of AREAS) {
      const projectId = ids[area];
      const project = await client.getProject(projectId);
      assertViva(op);
      const settings = await project.$getProjectSettings();
      assertViva(op);
      if (settings.name !== NAMES[area] || settings.sendStats !== false) {
        throw new Error('conference-settings');
      }
      if (!(await templates.verify(project, packages[area], projectId))) {
        throw new Error('conference-categories');
      }
      assertViva(op);
      const device = await client.getDeviceInfo();
      assertViva(op);
      const member = await project.$member.getById(device.deviceId);
      assertViva(op);
      if (
        member.name !== device.name ||
        member.deviceType !== device.deviceType ||
        member.role.roleId !== CREATOR_ROLE_ID
      ) {
        throw new Error('conference-device');
      }
    }
  }

  async function materialize(op: Operacao, packages: Record<Area, T>) {
    try {
      for (const area of AREAS) {
        assertViva(op);
        const entry = current().materializacao[area];
        let projectId = entry.projectId;
        if (entry.etapa === 'verificado') {
          // §242: a completed area is never re-created or re-imported. A
          // resume/retry still re-applies the idempotent project settings and
          // re-verifies the import, so settings that drifted after the
          // `verificado` checkpoint (external interference) get repaired here
          // instead of failing conferenciaFinal on every retry forever.
          if (!projectId) throw new Error('verified-area-missing-project');
          const verified = await client.getProject(projectId);
          assertViva(op);
          await verified.$setProjectSettings({
            name: NAMES[area],
            sendStats: false,
          });
          assertViva(op);
          if (!(await templates.verify(verified, packages[area], projectId))) {
            throw new Error('template-incomplete');
          }
          assertViva(op);
          checkpoint(op, area, {etapa: 'verificado'});
          continue;
        }
        if (!projectId) {
          const ids = (await client.listProjects()).map(
            project => project.projectId,
          );
          assertViva(op);
          const candidates =
            entry.idsAntesDaCriacao === null
              ? []
              : ids.filter(id => !entry.idsAntesDaCriacao!.includes(id));
          if (candidates.length > 1) throw new Error('ambiguous-projects');
          if (candidates.length === 1) {
            projectId = candidates[0]!;
          } else {
            checkpoint(op, area, {etapa: 'criando', idsAntesDaCriacao: ids});
            projectId = await client.createProject({
              name: NAMES[area],
              configPath: '',
            });
            assertViva(op);
          }
          checkpoint(op, area, {etapa: 'criado', projectId});
        }
        if (
          AREAS.some(
            other =>
              other !== area &&
              current().materializacao[other].projectId === projectId,
          )
        )
          throw new Error('duplicate-project-id');
        const project = await client.getProject(projectId);
        assertViva(op);
        if (!(await templates.verify(project, packages[area], projectId))) {
          assertViva(op);
          checkpoint(op, area, {etapa: 'importando'});
          await project.$importCategories({filePath: packages[area].filePath});
          assertViva(op);
          if (!(await templates.verify(project, packages[area], projectId)))
            throw new Error('template-incomplete');
        }
        assertViva(op);
        await project.$setProjectSettings({
          name: NAMES[area],
          sendStats: false,
        });
        assertViva(op);
        const device = await client.getDeviceInfo();
        assertViva(op);
        const initialized = async () => {
          try {
            const member = await project.$member.getById(device.deviceId);
            assertViva(op);
            return (
              member.name === device.name &&
              member.deviceType === device.deviceType &&
              member.role.roleId === CREATOR_ROLE_ID
            );
          } catch (error) {
            // A stale operation must not be masked as "not initialized" —
            // that would route it into further Core writes.
            if (error instanceof OperacaoExpirada) throw error;
            return false;
          }
        };
        if (!(await initialized())) {
          assertViva(op);
          try {
            await client.setDeviceInfo({
              // getDeviceInfo() types `name` as optional; device naming is a
              // product precondition (§3.3), so reapply the saved value and
              // fall back to empty — `initialized()` still gates publication.
              name: device.name ?? '',
              deviceType: device.deviceType,
            });
          } catch {
            /* Peer notification can fail after the local write. Read it back. */
          }
          assertViva(op);
          if (!(await initialized())) throw new Error('device-not-initialized');
        }
        checkpoint(op, area, {etapa: 'verificado'});
      }
      // §5.4 step 6: the final conferência gates publication on BOTH paths.
      await conferenciaFinal(op, packages);
      assertViva(op);
      save({...current(), estado: 'pronta', confirmacaoPendente: true});
    } catch (error) {
      // A superseded operation exits silently: the journal now belongs to
      // another operation and must not be touched by this one.
      if (error instanceof OperacaoExpirada) return;
      fail(op);
    }
  }
  function fail(op: Operacao) {
    // A stale operation never rewrites a journal that is no longer its own.
    if (!operacaoViva(op)) return;
    save({
      ...current(),
      estado: 'falha_recuperavel',
      ultimoErro: {
        codigo: 'preparation-failed',
        area: current().areaEmExecucao,
        ocorridoEm: new Date().toISOString(),
      },
    });
  }

  async function start(name: string, op: Operacao) {
    if (current()) return;
    const error = organizationNameError(name);
    if (error) throw new Error(error);
    const packages = await templates.prepare();
    // A concurrent operation may have persisted an intent (or superseded this
    // one) while the packages were being prepared — never write on its behalf.
    if (operacoes.get(repository) !== op) return;
    if (repository.read().organizacoes[0]) return;
    const emptyArea = (area: Area) => ({
      etapa: 'ausente' as const,
      projectId: null,
      template: packages[area].ref,
      idsAntesDaCriacao: null,
    });
    const id = generateId();
    save({
      id,
      nome: name.trim(),
      estado: 'preparando',
      confirmacaoPendente: false,
      materializacao: {
        monitoramento: emptyArea('monitoramento'),
        alertas: emptyArea('alertas'),
      },
      areaEmExecucao: null,
      ultimoErro: null,
    });
    op.organizacaoId = id;
    await materialize(op, packages);
  }
  async function resume(op: Operacao) {
    if (current()?.estado !== 'preparando') return;
    op.organizacaoId = current().id;
    try {
      assertViva(op);
      const packages = await templates.prepare({
        monitoramento: current().materializacao.monitoramento.template,
        alertas: current().materializacao.alertas.template,
      });
      assertViva(op);
      await materialize(op, packages);
    } catch (error) {
      if (error instanceof OperacaoExpirada) return;
      fail(op);
    }
  }

  async function retry(op: Operacao) {
    if (current()?.estado !== 'falha_recuperavel') return;
    op.organizacaoId = current().id;
    // Mirrors resume(): a superseded operation exits silently and a failed
    // "preparando" checkpoint (e.g. an MMKV write error) routes to fail()
    // instead of rejecting the exclusive operation.
    try {
      assertViva(op);
      save({...current(), estado: 'preparando', ultimoErro: null});
    } catch (error) {
      if (error instanceof OperacaoExpirada) return;
      fail(op);
    }
    await resume(op);
  }
  function exclusive(work: (op: Operacao) => Promise<void>) {
    const existing = running.get(client) ?? runningRepositories.get(repository);
    if (existing) return existing;
    // Different client wrappers over the same journal share this operation;
    // none may supersede its token while a native write is still in flight.
    const op: Operacao = {organizacaoId: null};
    const operation = Promise.resolve()
      .then(() => work(op))
      .finally(() => {
        if (running.get(client) === operation) running.delete(client);
        if (runningRepositories.get(repository) === operation) {
          runningRepositories.delete(repository);
        }
        if (operacoes.get(repository) === op) operacoes.delete(repository);
      });
    running.set(client, operation);
    runningRepositories.set(repository, operation);
    operacoes.set(repository, op);
    return operation;
  }
  return {
    start: (name: string) => exclusive(op => start(name, op)),
    resume: () => exclusive(op => resume(op)),
    retry: () => exclusive(op => retry(op)),
  };
}
