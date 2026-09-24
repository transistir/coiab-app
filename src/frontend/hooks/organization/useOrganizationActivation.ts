import {useContext, useEffect, useMemo, useRef} from 'react';
import {useClientApi} from '@comapeo/core-react';
import type {ComapeoProjectClientApi} from '@comapeo/ipc';
import * as Sentry from '@sentry/react-native';
import {useQueryClient} from '@tanstack/react-query';
import {useStore} from 'zustand';

import {
  useCoiabOrganizationsStoreContext,
  type CoiabOrganizationsStore,
} from '../../contexts/CoiabOrganizationsStoreContext';
import {
  useMaterializacaoViva,
  useOrganizationMaterializer,
} from '../../contexts/OrganizationMaterializerContext';
import {useDraftObservationState} from '../../contexts/DraftObservationContext';
import {TrackStoreContext} from '../../contexts/TrackStoreContext';
import {
  createOrganizationActivation,
  type ActivationProject,
  type ActivationState,
  type OrganizationActivation,
} from '../../lib/organization/activation';
import {hasPendingOrganizationWork} from '../../lib/organization/pendingWork';
import {haOperacoesEmAndamento} from '../../lib/organization/operacoesEmAndamento';

type EngineSetState = CoiabOrganizationsStore['instance']['setState'];
type EngineState = CoiabOrganizationsStore['instance'] extends {
  getState: () => infer State;
}
  ? State
  : never;
/**
 * What the startup driver publishes to its consumers: the engine's observable
 * state plus the operations the UI may request. The engine itself stays
 * private — nothing outside this hook can rebuild or replace it.
 */
export type OrganizationActivationHandle = Pick<
  ActivationState,
  'status' | 'projectId' | 'generation' | 'error' | 'pendingWorkOrigin'
> & {
  /**
   * Review fronteira P1: a materialization is alive in this session. An
   * organization in `preparando` without one was interrupted, and its
   * surface must offer the resume and a way back instead of a spinner.
   */
  preparacaoViva: boolean;
  activate: OrganizationActivation['activate'];
  revalidate: OrganizationActivation['revalidate'];
  retryPreparation: OrganizationActivation['retryPreparation'];
  recoverPendingWork: OrganizationActivation['recoverPendingWork'];
};

/**
 * Per-engine write gate (P2-4), keyed by the engine itself — the same
 * registry pattern `materializar.ts` uses to signal a superseded operation.
 * The engine keeps running through its awaits after unmount and its
 * `document-changed` guard compares the document object it captured at
 * entry, so it cannot see the unmount; the effect arms the writes of the
 * store the engine holds and disarms them on cleanup. Disarm/rearm stays
 * inside the effect pair, so StrictMode's synchronous cleanup → re-run
 * sequence never blocks a live engine.
 *
 * #88: the gate also refuses STARTS of the materializer. The background
 * resume writes through the ORIGINAL store (`repositorioDoStore`), not the
 * gated `engineStore` wrapper, so disarming writes alone would still let a
 * post-unmount release record B's materialization durably.
 */
const engineWriteGates = new WeakMap<
  OrganizationActivation,
  {armed: boolean}
>();

/**
 * The engine validates a candidate by checking the device's role and ending
 * the project's sync (SPEC A §4.2 regra 9, §5.2): the role comes from the
 * project's own `$getOwnRole` API, the sync teardown from `$sync.stop` — the
 * adapter maps both onto the flat `ActivationProject` shape the engine asks
 * for — same calls, no substitutes.
 */
function toActivationProject(
  project: ComapeoProjectClientApi,
): ActivationProject {
  return {
    $getOwnRole: () => project.$getOwnRole(),
    $sync: {stop: async () => project.$sync.stop()},
    disconnectServers: async () => project.$sync.disconnectServers(),
  };
}

/**
 * Startup activation driver (SPEC A §5.2): builds the activation engine
 * against the durable organization document and the live core client, runs
 * the persisted selection once, and republishes the engine state for UI
 * consumers.
 *
 * The engine is memoized on its real dependencies — the store instance, the
 * client API, the query client and the track store — so a re-render never
 * rebuilds it and the startup `initialize()` runs exactly once per engine. A
 * double-invoked mount (StrictMode) joins the in-flight initialization
 * through the engine's own intent lock instead of activating twice.
 */
export function useOrganizationActivation(): OrganizationActivationHandle {
  const store = useCoiabOrganizationsStoreContext();
  const clientApi = useClientApi();
  const queryClient = useQueryClient();
  // `null` outside the root materializer provider: the engine then publishes
  // `preparation-adapter-required` instead of resuming (P3-8 degradation).
  const materializador = useOrganizationMaterializer();
  const preparacaoViva = useMaterializacaoViva();
  // Trilha e rascunho são os trabalhos que o guard observa além dos convites
  // (Fase 8a); os provedores ficam acima do driver raiz (AppProviders :143/:160).
  const trackStore = useContext(TrackStoreContext);
  if (!trackStore) {
    throw new Error('Must set up the TrackStoreContext first');
  }
  // O rascunho é lido por assinatura (zustand) e espelhado em ref: o motor é
  // construído uma única vez, mas o guard precisa ver o estado do render MAIS
  // RECENTE no momento de cada `activate`, não o do boot do motor. O espelho
  // vive num efeito — escrever ref no render é proibido pelo react-hooks/refs,
  // e todo read do guard acontece após o commit, quando o efeito já rodou.
  const draftValue = useDraftObservationState(state => state.value);
  const draftProjectId = useDraftObservationState(state => state.projectId);
  const draftStateRef = useRef({value: draftValue, projectId: draftProjectId});
  useEffect(() => {
    draftStateRef.current = {value: draftValue, projectId: draftProjectId};
  }, [draftValue, draftProjectId]);

  const activation = useMemo(() => {
    // Writes the engine attempts while disarmed are dropped: post-unmount
    // nothing consumes the engine's report, and the durable document must
    // never record the intent of a screen that is no longer there.
    const gate = {armed: false};
    const gateAction =
      <A extends unknown[]>(action: (...args: A) => void) =>
      (...args: A): void => {
        if (gate.armed) action(...args);
      };
    const engineStore: CoiabOrganizationsStore = {
      instance: {
        ...store.instance,
        setState: (partial, replace) => {
          if (!gate.armed) return;
          // The persist wrapper narrowed `store.instance.setState`; the
          // full zustand overload view needs an explicit dispatch — a union
          // call cannot pick between the two signatures on its own.
          const publish = store.instance.setState as EngineSetState;
          if (replace) publish(partial as EngineState, true);
          else publish(partial);
        },
      },
      actions: {
        confirmarAbertura: gateAction(store.actions.confirmarAbertura),
        ativar: gateAction(store.actions.ativar),
        publicarPronta: gateAction(store.actions.publicarPronta),
        // Boolean result: a disarmed gate refuses the registration
        // (returning `false`, no write) instead of voiding it.
        registrarEntradaPorConvite: (
          ...args: Parameters<typeof store.actions.registrarEntradaPorConvite>
        ) =>
          gate.armed
            ? store.actions.registrarEntradaPorConvite(...args)
            : false,
        resolverFalhaHidratacao: gateAction(
          store.actions.resolverFalhaHidratacao,
        ),
      },
    };
    const retomar = materializador?.retomar;
    const activation = createOrganizationActivation({
      store: engineStore,
      getProject: async id =>
        toActivationProject(await clientApi.getProject(id)),
      // #88: like the writes above, the START of a background resume is
      // refused while disarmed — post-unmount, nothing consumes its report
      // and the materializer writes through the original store, invisible
      // to the gated wrapper.
      resumePreparation: retomar
        ? id =>
            gate.armed
              ? retomar(id)
              : Promise.reject(new Error('activation-disarmed'))
        : undefined,
      // Fase 8a: o guard deixa de ser inerte. Trabalho pendente no app —
      // rascunho, trilha, mutações em voo e convites — bloqueia TODA mudança
      // de contexto, inclusive troca de área (SPEC A §5.2:172/§5.3:180).
      hasPendingWork: () =>
        hasPendingOrganizationWork({
          draft: draftStateRef.current,
          track: trackStore.instance.getState(),
          mutations: queryClient.isMutating(),
          invites: haOperacoesEmAndamento(),
        }),
      getPendingWorkProjectId: () =>
        trackStore.instance.getState().projectId ??
        draftStateRef.current.projectId ??
        null,
      cancelPresentation: ids =>
        queryClient.cancelQueries({
          predicate: q =>
            ids.some(id => JSON.stringify(q.queryKey).includes(id)),
        }),
    });
    engineWriteGates.set(activation, gate);
    return activation;
  }, [store, clientApi, materializador, queryClient, trackStore]);

  const state = useStore(activation.instance);

  useEffect(() => {
    const gate = engineWriteGates.get(activation)!;
    gate.armed = true;
    void activation.initialize().then(initialized => {
      if (initialized) return;
      // A degraded boot publishes itself in the UI, but nothing would say
      // WHY on the observability side (P3-8): surface it through the repo's
      // error-reporting convention. Routine false outcomes — selection,
      // confirmation, preparing, absent — stay silent.
      const {status, error} = activation.instance.getState();
      if (status !== 'recovery' && status !== 'unavailable') return;
      Sentry.captureException(
        new Error(
          `organization-activation degraded boot: status=${status}${error ? ` error=${error}` : ''}`,
        ),
      );
    });
    return () => {
      gate.armed = false;
    };
  }, [activation]);

  // Memoized: a provider re-render must not hand consumers a new object and
  // re-render every one of them (P3-10).
  return useMemo(
    () => ({
      status: state.status,
      projectId: state.projectId,
      generation: state.generation,
      error: state.error,
      pendingWorkOrigin: state.pendingWorkOrigin,
      preparacaoViva,
      activate: activation.activate,
      revalidate: activation.revalidate,
      retryPreparation: activation.retryPreparation,
      recoverPendingWork: activation.recoverPendingWork,
    }),
    [
      state.status,
      state.projectId,
      state.generation,
      state.error,
      state.pendingWorkOrigin,
      preparacaoViva,
      activation.activate,
      activation.revalidate,
      activation.retryPreparation,
      activation.recoverPendingWork,
    ],
  );
}
