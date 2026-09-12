import {createStore, useStore} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import {MMKVStoreInitializer} from '../../hooks/persistedState/createPersistedState';

// NOTE: Do not change! The record has to survive the restart it exists for.
const STORAGE_KEY = 'OrganizationCreationProvenance' as const;

type OrganizationCreationProvenanceState = {
  /**
   * The organizations whose creation THIS device started and has not seen
   * complete. Written before the fan-out and cleared the moment it returns a
   * whole organization, so the record means exactly "a create was
   * interrupted here" — never "this device once created these projects".
   */
  organizationIds: string[];
};

/**
 * Durable creation provenance (Bug 46 follow-up): an `incomplete`
 * organization left by a leave or a remote removal is indistinguishable from
 * an interrupted create by local project state alone — both reconstruct as
 * `incomplete` with a name. Resuming the wrong one fabricates a brand-new
 * project in the missing slot and marks the organization ready without the
 * original slot's data or members, so the resume offer is gated on this
 * record and fails closed without it.
 */
function createInitialState(): OrganizationCreationProvenanceState {
  return {organizationIds: []};
}

export const organizationCreationProvenanceStore = createStore(
  persist(createInitialState, {
    name: STORAGE_KEY,
    storage: createJSONStorage(() => MMKVStoreInitializer),
    version: 0,
  }),
);

export function recordOrganizationCreationProvenance(organizationId: string) {
  const {organizationIds} = organizationCreationProvenanceStore.getState();
  if (organizationIds.includes(organizationId)) return;
  organizationCreationProvenanceStore.setState({
    organizationIds: [...organizationIds, organizationId],
  });
}

export function clearOrganizationCreationProvenance(organizationId: string) {
  const {organizationIds} = organizationCreationProvenanceStore.getState();
  if (!organizationIds.includes(organizationId)) return;
  organizationCreationProvenanceStore.setState({
    organizationIds: organizationIds.filter(id => id !== organizationId),
  });
}

/** Whether this device holds an unfinished creation for `organizationId`. */
export function useHasOrganizationCreationProvenance(
  organizationId: string | undefined,
): boolean {
  return useStore(
    organizationCreationProvenanceStore,
    state =>
      organizationId !== undefined &&
      state.organizationIds.includes(organizationId),
  );
}
