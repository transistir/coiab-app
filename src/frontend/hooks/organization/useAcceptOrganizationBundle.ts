import {useCallback, useEffect, useRef, useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useClientApi} from '@comapeo/core-react';

import {useActiveProjectIdActions} from '../../contexts/ActiveProjectIdStoreContext';
import type {OrganizationInviteBundle} from '../../lib/organization/bundle';
import {acceptOrganizationBundle} from '../../lib/organization/fanout';
import {
  invitesQueryKey,
  projectsQueryKey,
} from '../../lib/organization/queryKeys';
import {reconstructOrganizations} from '../../lib/organization/reconstruct';

export type AcceptOrganizationBundleStatus =
  'idle' | 'accepting' | 'success' | 'error';

type PersistedIdentity = {invitorDeviceId: string; roleName: string};

/**
 * SPEC 8: "Entrar na organização" — accept an Organization invite bundle
 * (validation and slot skipping are `acceptOrganizationBundle`'s job) and
 * make the Monitoramento project of the organization the active one
 * (SPEC 8.6: slot m wins, from the freshest source that sees it — the
 * post-accept reconstruction, the pre-accept local one, or this accept's
 * own result — before any slot-a fallback).
 */
export function useAcceptOrganizationBundle() {
  const clientApi = useClientApi();
  const queryClient = useQueryClient();
  const {setActiveProjectId} = useActiveProjectIdActions();

  const [status, setStatus] = useState<AcceptOrganizationBundleStatus>('idle');
  const [error, setError] = useState<unknown>(undefined);

  // A synchronous re-entry guard: a status check alone would let a second
  // call slip through before the rerender publishes 'accepting'.
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
  const reset = useCallback(() => {
    if (busyRef.current) return;
    attemptRef.current += 1;
    busyRef.current = false;
    setStatus('idle');
    setError(undefined);
  }, []);

  const start = useCallback(
    async (
      bundle: OrganizationInviteBundle,
      opts?: {persistedIdentity?: PersistedIdentity},
    ) => {
      if (busyRef.current) return;
      busyRef.current = true;
      attemptRef.current += 1;
      const attempt = attemptRef.current;

      setStatus('accepting');
      setError(undefined);
      try {
        // SPEC 8.6: capture the pre-accept local reconstruction — the read
        // after the accept can lag behind core, and local state known
        // before the accept must still outrank this accept's own result.
        const preAcceptOrg = reconstructOrganizations(
          await clientApi.listProjects(),
        ).find(org => org.organizationId === bundle.organizationId);

        const accepted = await acceptOrganizationBundle(clientApi, bundle, {
          persistedIdentity: opts?.persistedIdentity,
        });

        // SPEC 8.6: activate the Monitoramento project of the organization,
        // slot m first, from the freshest source that sees it — the
        // post-accept reconstruction (so a slot accepted in an earlier
        // attempt counts), then the pre-accept local one, then this
        // accept's own result; only then the same ladder over slot a.
        const freshOrg = reconstructOrganizations(
          await clientApi.listProjects(),
        ).find(org => org.organizationId === bundle.organizationId);
        const activeProjectId =
          freshOrg?.slots.m ??
          preAcceptOrg?.slots.m ??
          accepted.find(({slot}) => slot === 'm')?.projectId ??
          freshOrg?.slots.a ??
          preAcceptOrg?.slots.a ??
          accepted.find(({slot}) => slot === 'a')?.projectId;

        if (attemptRef.current !== attempt) return;

        if (activeProjectId !== undefined) {
          setActiveProjectId(activeProjectId);
        }
        setStatus('success');
      } catch (e) {
        if (attemptRef.current !== attempt) return;
        setError(e);
        setStatus('error');
      } finally {
        // Direct clientApi calls bypass core-react's own invalidation, so
        // the project-list and invite-list queries must be invalidated by
        // hand for mounted consumers to see the joins — in a finally,
        // regardless of outcome: a failed attempt may still have joined a
        // slot, and cache repair is never token-gated; only the React state
        // above is.
        await queryClient.invalidateQueries({queryKey: projectsQueryKey});
        await queryClient.invalidateQueries({queryKey: invitesQueryKey});
        if (attemptRef.current === attempt) {
          busyRef.current = false;
        }
      }
    },
    [clientApi, queryClient, setActiveProjectId],
  );

  return {start, reset, status, error};
}
