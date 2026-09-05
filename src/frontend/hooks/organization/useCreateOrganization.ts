import {useEffect, useRef, useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useClientApi} from '@comapeo/core-react';

import {useActiveProjectIdActions} from '../../contexts/ActiveProjectIdStoreContext';
import {createOrganization} from '../../lib/organization/fanout';
import {projectsQueryKey} from '../../lib/organization/queryKeys';
import {getOrganizationCreationCompletion} from './useOrganizationCreationCompletion';
import {generateOrganizationId} from '../../lib/organization/orgId';

export type CreateOrganizationStatus =
  'idle' | 'creating' | 'success' | 'error';

/**
 * SPEC 5: "Criar organização" — provisions the two internal projects of a
 * new Organization and makes the Monitoramento project the active one.
 *
 * Multi-step fan-out with per-slot progress, so this is a plain async
 * function + status instead of a react-query mutation.
 */
export function useCreateOrganization() {
  const clientApi = useClientApi();
  const queryClient = useQueryClient();
  const {setActiveProjectId} = useActiveProjectIdActions();

  const [status, setStatus] = useState<CreateOrganizationStatus>('idle');
  const [error, setError] = useState<unknown>(undefined);
  const [organizationId, setOrganizationId] = useState<string | undefined>(
    undefined,
  );

  // A synchronous re-entry guard: a status check alone would let a second
  // call slip through before the rerender publishes 'creating'.
  const busyRef = useRef(false);
  // Attempts publish state only while their token is current, so a
  // completion from before a reset() or an unmount publishes nothing.
  const attemptRef = useRef(0);

  useEffect(() => {
    return () => {
      attemptRef.current += 1;
      busyRef.current = false;
    };
  }, []);

  /**
   * Reset to idle. A no-op while an attempt is running: a mid-flight reset
   * can no longer duplicate side effects nor leave `busy` permanently true —
   * the running attempt keeps its token, so it settles normally and clears
   * its own busy flag. When idle, clears the published state (any late
   * completion from before the reset stays suppressed by the token).
   */
  const reset = () => {
    if (busyRef.current) return;
    attemptRef.current += 1;
    busyRef.current = false;
    setStatus('idle');
    setError(undefined);
    setOrganizationId(undefined);
  };

  /**
   * `organizationId` is optional: when the caller passes one (recovered from
   * a reconstructed `incomplete` organization after a restart, SPEC 5/E7) it
   * is used as-is; without it the errored-attempt reuse / fresh-generation
   * logic applies unchanged.
   */
  const start = async (
    organizationName: string,
    providedOrganizationId?: string,
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;
    attemptRef.current += 1;
    const attempt = attemptRef.current;

    // Retry semantics (SPEC 5 / E7 create-side): an errored attempt keeps
    // its organizationId so the fan-out's reconstruction reuses the slots
    // that were already created, and only the missing ones get created.
    // Any other status is a fresh organization.
    const nextOrganizationId =
      providedOrganizationId ??
      (status === 'error' && organizationId !== undefined
        ? organizationId
        : generateOrganizationId());
    setOrganizationId(nextOrganizationId);
    setStatus('creating');
    setError(undefined);

    let createdProjectId: string | undefined;
    try {
      const {projectIds} = await createOrganization(clientApi, {
        organizationId: nextOrganizationId,
        organizationName,
      });
      createdProjectId = projectIds.m;
    } catch (e) {
      if (attemptRef.current !== attempt) return;
      setError(e);
      setStatus('error');
    } finally {
      // Direct clientApi calls bypass core-react's own invalidation, so the
      // project-list queries (useOrganizations, the startup gate) must be
      // invalidated by hand — in a finally, regardless of success or error:
      // even a partially provisioned organization must show up as
      // `incomplete` to mounted consumers. Cache repair is never
      // token-gated; only the React state above is.
      await queryClient.invalidateQueries({queryKey: projectsQueryKey});
      if (attemptRef.current === attempt) {
        if (createdProjectId) {
          // Publish the handoff before switching providers: either entry path
          // can lose its local success effect when the screen remounts.
          getOrganizationCreationCompletion(queryClient).setState({
            projectId: createdProjectId,
          });
          // SPEC 8.6: every organization entry point lands on slot m.
          setActiveProjectId(createdProjectId);
          setStatus('success');
        }
        busyRef.current = false;
      }
    }
  };

  return {
    start,
    reset,
    status,
    error,
    /**
     * The organization id used for the create — set once `start` begins and
     * kept across retries of an errored attempt, until `reset()`.
     */
    organizationId,
  };
}
