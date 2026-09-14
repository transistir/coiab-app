import {useEffect, useMemo} from 'react';
import {useClientApi} from '@comapeo/core-react';
import type {ComapeoProjectClientApi} from '@comapeo/ipc';
import {useStore} from 'zustand';

import {useCoiabOrganizationsStoreContext} from '../../contexts/CoiabOrganizationsStoreContext';
import {
  createOrganizationActivation,
  type ActivationProject,
  type ActivationState,
  type OrganizationActivation,
} from '../../lib/organization/activation';

/**
 * What the startup driver publishes to its consumers: the engine's observable
 * state plus the three operations the UI may request. The engine itself stays
 * private — nothing outside this hook can rebuild or replace it.
 */
export type OrganizationActivationHandle = Pick<
  ActivationState,
  'status' | 'projectId' | 'generation' | 'error' | 'pendingWorkOrigin'
> & {
  activate: OrganizationActivation['activate'];
  retryPreparation: OrganizationActivation['retryPreparation'];
  recoverPendingWork: OrganizationActivation['recoverPendingWork'];
};

/**
 * The engine reasons about an origin project by ending its sync and checking
 * the device's role (SPEC A §4.2 regra 9, §5.2). Both live on the project's
 * `$sync` API in `@comapeo/core`, so the adapter maps them onto the flat
 * `ActivationProject` shape the engine asks for — same calls, no substitutes.
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
 * The engine is memoized on its two real dependencies — the store instance
 * and the client API — so a re-render never rebuilds it and the startup
 * `initialize()` runs exactly once per engine. A double-invoked mount
 * (StrictMode) joins the in-flight initialization through the engine's own
 * intent lock instead of activating twice.
 */
export function useOrganizationActivation(): OrganizationActivationHandle {
  const store = useCoiabOrganizationsStoreContext();
  const clientApi = useClientApi();

  const activation = useMemo(
    () =>
      createOrganizationActivation({
        store,
        getProject: async id =>
          toActivationProject(await clientApi.getProject(id)),
      }),
    [store, clientApi],
  );

  const state = useStore(activation.instance);

  useEffect(() => {
    void activation.initialize();
  }, [activation]);

  return {
    status: state.status,
    projectId: state.projectId,
    generation: state.generation,
    error: state.error,
    pendingWorkOrigin: state.pendingWorkOrigin,
    activate: activation.activate,
    retryPreparation: activation.retryPreparation,
    recoverPendingWork: activation.recoverPendingWork,
  };
}
