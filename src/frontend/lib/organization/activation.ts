import {createStore} from 'zustand';
import type {CoiabOrganizationsStore} from '../../contexts/CoiabOrganizationsStoreContext';
import {
  COORDINATOR_ROLE_ID,
  CREATOR_ROLE_ID,
  MEMBER_ROLE_ID,
} from '../../sharedTypes';
import {
  AREAS,
  parseEstadoOrganizacoes,
  type Area,
  type OrganizacaoLocal,
} from './coiabOrganizations';

export type ActivationStatus =
  | 'loading'
  | 'absent'
  | 'preparing'
  | 'failure'
  | 'confirmation'
  | 'selection'
  | 'unavailable'
  | 'opening'
  | 'ready'
  | 'recovery';
export type ActivationState = {
  status: ActivationStatus;
  projectId?: string;
  generation: number;
  error?: string;
  pendingWorkOrigin?: {organizacaoId: string; area: Area; projectId: string};
};
export type ActivationProject = {
  $getOwnRole(): Promise<{roleId: string}>;
  $sync?: {stop(): Promise<unknown>};
  disconnectServers?: () => Promise<unknown>;
};
export type ActivationOptions = {area?: Area; acknowledge?: boolean};

export function createOrganizationActivation({
  store,
  getProject,
  hasPendingWork = () => false,
  getPendingWorkProjectId = () => null,
  cancelPresentation = async () => {},
  resumePreparation = async () => {
    throw new Error('preparation-adapter-required');
  },
}: {
  store: CoiabOrganizationsStore;
  hasPendingWork?: () => boolean;
  getPendingWorkProjectId?: () => string | null;
  resumePreparation?: (id: string) => Promise<void>;
  cancelPresentation?: (projectIds: string[]) => Promise<unknown>;
  getProject: (id: string) => Promise<ActivationProject>;
}) {
  const instance = createStore<ActivationState>(() => ({
    status: 'loading',
    generation: 0,
  }));

  function pendingWorkOrigin(
    organizacoes: OrganizacaoLocal[],
  ): ActivationState['pendingWorkOrigin'] {
    const projectId = getPendingWorkProjectId();
    if (!projectId) return undefined;
    for (const org of organizacoes) {
      for (const area of AREAS) {
        if (org.materializacao[area].projectId === projectId)
          return {organizacaoId: org.id, area, projectId};
      }
    }
    return undefined;
  }

  // Restoration can reopen only the exact origin project, including its area.
  function pendingWorkBlocks(
    organizacoes: OrganizacaoLocal[],
    targetId?: string,
    area: Area = 'monitoramento',
  ): boolean {
    if (!hasPendingWork()) return false;
    const origin = pendingWorkOrigin(organizacoes);
    return !origin || origin.organizacaoId !== targetId || origin.area !== area;
  }

  // A-v4-2 (SPEC A §4.2 regra 3 / §6.2:215): snapshot of the context last
  // published 'ready' AFTER a successful 2/2 revalidation in this session.
  // Recorded ONLY at that publication; cleared when entering recovery. The
  // failure path decides exclusively by it — never by the previous.projectId
  // carried in the instance state, which survives recovery (FIX-D) and would
  // republish 'ready' without any revalidation in the failing attempt.
  let origemValidada: {projectId: string; generation: number} | undefined;
  let inFlight: Promise<boolean> | undefined;
  let inFlightKey: string | undefined;
  // A-v4-4 (M-2): EVERY entry point — activate, initialize, retryPreparation
  // and the pending-work recovery — shares this single lock. `perform` runs
  // synchronously up to its first await: its entry guards must decide on the
  // state that exists when the caller asks for the change, not a later one.
  //
  // review round 2 (§5.2): the lock distinguishes by intent identity. A
  // concurrent call with the SAME key (double-tap: same target + operation)
  // JOINS the running operation. A DIFFERENT key is a distinct intent and is
  // rejected outright with `false` — it must never be silently aliased to the
  // in-flight result (which would drop the second request and report the
  // first one's outcome as if it were the second's).
  function runExclusive(
    key: string,
    perform: () => Promise<boolean>,
  ): Promise<boolean> {
    if (inFlight) {
      return inFlightKey === key ? inFlight : Promise.resolve(false);
    }
    const operation = perform();
    inFlight = operation;
    inFlightKey = key;
    void operation.finally(() => {
      if (inFlight === operation) {
        inFlight = undefined;
        inFlightKey = undefined;
      }
    });
    return operation;
  }

  function activate(
    id: string,
    options: ActivationOptions = {},
  ): Promise<boolean> {
    return runExclusive(`activate:${id}`, () => performActivation(id, options));
  }

  async function performActivation(
    id: string,
    options: ActivationOptions,
    restoring = false,
  ) {
    const previous = instance.getState();
    const document = store.instance.getState();
    const sameOrganization = document.ativa?.organizacaoId === id;
    const area = options.acknowledge
      ? 'monitoramento'
      : (options.area ?? 'monitoramento');
    // The restoration allowance belongs only to this operation. Even here,
    // work that changes origin during an await must block publication.
    const workBlocks = () =>
      restoring
        ? pendingWorkBlocks(document.organizacoes, id, area)
        : hasPendingWork();
    if (
      previous.status === 'ready' &&
      sameOrganization &&
      (!options.area || options.area === document.ativa?.area)
    )
      return true;
    // A-v4-1 (SPEC A §5.2:172/§5.3:180): the pending-work guard applies to
    // EVERY context change — including an area switch with `organizacaoId`
    // unchanged. The predicate is global ("is there work in progress?"): the
    // draft's origin is NOT compared with the destination, because the MVP
    // keeps a single work in progress and blocks the switch until it is
    // concluded. The canonical 'pending-work' code maps to the single §4.4
    // string, with no area variant (CA15). Only the cold-start restoration
    // path is exempt: reopening the persisted origin is what concludes the
    // work, and initialize() already applied the FIX-B origin comparison.
    if (workBlocks()) {
      instance.setState({error: 'pending-work'});
      return false;
    }
    let stopped = false;
    // A-v4-2a + FIX-C: the attempt is marked at the ENTRY, before the first
    // core call — this closes the pre-loop window where a failure with an
    // already OPEN, validated organization could be mistaken for a
    // non-revalidation failure. Any failure of the attempt over the open
    // organization is a recovery situation, not just 'access-unavailable'.
    let revalidating = true;
    instance.setState({status: 'opening', error: undefined});
    try {
      const org = document.organizacoes.find(item => item.id === id);
      if (
        !parseEstadoOrganizacoes(document) ||
        !org ||
        org.estado !== 'pronta' ||
        (org.confirmacaoPendente && !options.acknowledge)
      )
        throw new Error('invalid-organization');
      for (const area of AREAS) {
        const project = await getProject(org.materializacao[area].projectId!);
        const {roleId} = await project.$getOwnRole();
        if (
          ![CREATOR_ROLE_ID, COORDINATOR_ROLE_ID, MEMBER_ROLE_ID].includes(
            roleId,
          )
        )
          throw new Error('access-unavailable');
      }
      revalidating = false;
      // A-v4-1: the same global predicate re-checked before the commit — work
      // that appeared during validation still blocks it (§5.2:164).
      if (workBlocks()) throw new Error('pending-work');
      const origin = document.organizacoes.find(
        item => item.id === document.ativa?.organizacaoId,
      );
      if (previous.projectId && origin) {
        const originIds = sameOrganization
          ? [previous.projectId]
          : AREAS.map(area => origin.materializacao[area].projectId!);
        for (const projectId of originIds) {
          const project = await getProject(projectId);
          stopped = true;
          await project.$sync?.stop();
          await project.disconnectServers?.();
        }
        await cancelPresentation(originIds);
      }
      if (workBlocks()) throw new Error('pending-work');
      if (store.instance.getState() !== document)
        throw new Error('document-changed');
      // SPEC A §4.2 regra 9 / FIX-A: the acknowledgment records the area
      // Monitoramento in the SAME single write as confirmacaoPendente:false —
      // recognition never chooses an area, so any requested area is ignored
      // on this path. The persisted area and the published operational
      // projectId can never diverge. Without acknowledge, options.area stands.
      if (options.acknowledge) store.actions.confirmarAbertura(id, area);
      else store.actions.ativar({organizacaoId: id, area});
      const projectId = org.materializacao[area].projectId!;
      const generation = previous.generation + 1;
      instance.setState(
        {status: 'ready', projectId, generation, error: undefined},
        true,
      );
      // A-v4-2b: the snapshot is recorded ONLY here — 'ready' published after
      // a successful 2/2 revalidation in THIS attempt (§4.2 regra 3).
      origemValidada = {projectId, generation};
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      // FIX-C: ANY failure of the attempt (A-v4-2a: marked from the entry)
      // over the organization that is currently OPEN and validated is a
      // recovery situation — the context must not stay usable as 'ready'
      // (isCurrent requires 'ready').
      const accessLost = revalidating && sameOrganization && !!origemValidada;
      // A-v4-2c: the decision uses origemValidada — NEVER the persisted
      // previous.projectId. No origin validated in this session (cold start,
      // or already in recovery, where the snapshot is empty) → recovery,
      // preserving `ativa` in the document (§4.2 regra 8) and the origin
      // identity for the next activation's cleanup (FIX-D). Recovery is only
      // exited through a successful revalidation (A-v4-3, §5.3:189).
      if (accessLost || !origemValidada) {
        origemValidada = undefined;
        instance.setState(
          {
            ...previous,
            status: 'recovery',
            error:
              message === 'pending-work'
                ? 'pending-work'
                : accessLost
                  ? 'access-unavailable'
                  : stopped
                    ? 'sync-restart-required'
                    : 'unavailable',
          },
          true,
        );
        return false;
      }
      // A validated origin exists: keep it (A) and report the blocked/failed
      // switch (§6.2:215 — "Tentar novamente"/"Voltar"). The ready context is
      // restored from the snapshot, not from previous state; failures after
      // revalidation (sync cleanup with `stopped`) keep the sync-restart
      // treatment. A blocked switch to ANOTHER organization is not a loss —
      // it rolls back to the still-accessible open one.
      instance.setState(
        {
          status: 'ready',
          projectId: origemValidada.projectId,
          generation: origemValidada.generation,
          error:
            message === 'pending-work'
              ? 'pending-work'
              : stopped
                ? 'sync-restart-required'
                : 'unavailable',
        },
        true,
      );
      return false;
    }
  }

  const automaticallyResumed = new Set<string>();
  function retryPreparation(id: string) {
    return runExclusive(`retryPreparation:${id}`, () => performPreparation(id));
  }

  async function performPreparation(id: string) {
    const org = store.instance
      .getState()
      .organizacoes.find(item => item.id === id);
    if (!org || org.estado === 'pronta') return false;
    store.instance.setState(state => ({
      organizacoes: state.organizacoes.map(item =>
        item.id === id ? {...item, estado: 'preparando' as const} : item,
      ),
    }));
    instance.setState({status: 'preparing'});
    try {
      await resumePreparation(id);
      const completed = store.instance
        .getState()
        .organizacoes.find(item => item.id === id);
      if (completed?.estado !== 'pronta')
        throw new Error('preparation-incomplete');
      instance.setState({status: 'confirmation'});
      return true;
    } catch {
      // Publication may have succeeded before the adapter's late rejection.
      // Never persist failure over pronta + pending confirmation: that pair
      // is durable success and downgrading it would invalidate hydration.
      const completed = store.instance
        .getState()
        .organizacoes.find(item => item.id === id);
      if (completed?.estado === 'pronta') {
        instance.setState({status: 'confirmation', error: undefined});
        return true;
      }
      store.instance.setState(state => ({
        organizacoes: state.organizacoes.map(item =>
          item.id === id
            ? {
                ...item,
                estado: 'falha_recuperavel' as const,
                ultimoErro: {
                  codigo: 'preparation-failed',
                  area: item.areaEmExecucao,
                  ocorridoEm: new Date().toISOString(),
                },
                areaEmExecucao: null,
              }
            : item,
        ),
      }));
      instance.setState({status: 'failure'});
      return false;
    }
  }

  function initialize() {
    return runExclusive('initialize', performInitialization);
  }

  async function performInitialization() {
    const {organizacoes, ativa, hidratacaoFalhou} = store.instance.getState();
    if (hidratacaoFalhou) {
      origemValidada = undefined;
      instance.setState({
        status: 'recovery',
        error: 'hydration-failed',
        projectId: undefined,
        pendingWorkOrigin: undefined,
      });
      return false;
    }
    if (!organizacoes.length) {
      origemValidada = undefined;
      instance.setState({
        status: 'absent',
        error: undefined,
        projectId: undefined,
        pendingWorkOrigin: undefined,
      });
      return false;
    }
    const selected = ativa
      ? organizacoes.find(org => org.id === ativa.organizacaoId)
      : organizacoes.length === 1
        ? organizacoes[0]
        : undefined;
    // FIX-B: persisted pending work blocks startup only when its origin
    // differs from the selection being restored — reopening the origin is
    // what concludes/clears the work. An unidentifiable origin still blocks:
    // a fresh instance must never strand persisted work.
    if (
      pendingWorkBlocks(
        organizacoes,
        selected?.id,
        ativa?.area ?? 'monitoramento',
      )
    ) {
      instance.setState({
        status: 'unavailable',
        error: 'pending-work',
        pendingWorkOrigin: pendingWorkOrigin(organizacoes),
      });
      return false;
    }
    if (!selected) {
      instance.setState({status: ativa ? 'unavailable' : 'selection'});
    } else if (selected.estado !== 'pronta') {
      instance.setState({
        status: selected.estado === 'preparando' ? 'preparing' : 'failure',
      });
      if (
        selected.estado === 'preparando' &&
        !automaticallyResumed.has(selected.id)
      ) {
        automaticallyResumed.add(selected.id);
        return performPreparation(selected.id);
      }
    } else if (selected.confirmacaoPendente) {
      instance.setState({status: 'confirmation'});
    } else {
      return performActivation(
        selected.id,
        {area: ativa?.area ?? 'monitoramento'},
        true,
      );
    }
    return false;
  }

  // Explicit recovery revalidates the origin pair and selects its exact area.
  // It cannot be used as a general bypass of the in-session pending-work guard.
  function recoverPendingWork() {
    return runExclusive('recoverPendingWork', async () => {
      const state = instance.getState();
      const origin = pendingWorkOrigin(store.instance.getState().organizacoes);
      if (
        state.status !== 'unavailable' ||
        state.error !== 'pending-work' ||
        !hasPendingWork() ||
        !origin ||
        origin.projectId !== state.pendingWorkOrigin?.projectId
      )
        return false;
      return performActivation(origin.organizacaoId, {area: origin.area}, true);
    });
  }
  const captureContext = () => ({
    projectId: instance.getState().projectId,
    generation: instance.getState().generation,
  });
  const isCurrent = (context: ReturnType<typeof captureContext>) =>
    instance.getState().status === 'ready' &&
    context.generation === instance.getState().generation &&
    context.projectId === instance.getState().projectId;
  return {
    instance,
    activate,
    initialize,
    retryPreparation,
    recoverPendingWork,
    captureContext,
    isCurrent,
  };
}
export type OrganizationActivation = ReturnType<
  typeof createOrganizationActivation
>;
