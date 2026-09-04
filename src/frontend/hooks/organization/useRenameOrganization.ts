import {useCallback, useEffect, useRef, useState} from 'react';
import {useClientApi} from '@comapeo/core-react';
import {useQueryClient} from '@tanstack/react-query';

import {SLOTS, type Slot} from '../../lib/organization/marker';
import {
  projectSettingsQueryKey,
  projectsQueryKey,
} from '../../lib/organization/queryKeys';
import {renameOrganization} from '../../lib/organization/fanout';

export type RenameOrganizationStatus =
  'idle' | 'renaming' | 'success' | 'error';

type RenameArgs = {
  organizationId: string;
  newName: string;
  slots: Partial<Record<Slot, string>>;
};

/**
 * SPEC 4.4: "Renomear organização" — rewrites the marker name segment in
 * every existing slot of the organization with one call (`renameOrganization`
 * carries the fan-out). Matches the accept-hook lifecycle (P6 Q2): a
 * synchronous busy guard against re-entry, an attempt token so a superseded
 * or unmounted attempt publishes nothing, invalidations that settle before
 * the terminal status is published, and a reset that is inert while busy.
 */
export function useRenameOrganization() {
  const clientApi = useClientApi();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<RenameOrganizationStatus>('idle');
  const [error, setError] = useState<unknown>(undefined);

  // A synchronous re-entry guard: a status check alone would let a second
  // call slip through before the rerender publishes 'renaming'.
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

  const rename = useCallback(
    async (args: RenameArgs) => {
      if (busyRef.current) return;
      busyRef.current = true;
      attemptRef.current += 1;
      const attempt = attemptRef.current;

      setStatus('renaming');
      setError(undefined);

      // The outcome is computed WITHOUT publishing it — terminal status
      // lands only after the invalidations below have settled.
      let outcome: {ok: true} | {ok: false; error: unknown};
      try {
        await renameOrganization(clientApi, args);
        outcome = {ok: true};
      } catch (e) {
        outcome = {ok: false, error: e};
      }

      try {
        // Direct clientApi calls bypass core-react's own invalidation, so
        // the project list (which feeds `useOrganizations`) and the settings
        // of every touched slot must be invalidated by hand — also on error,
        // since a failed fan-out may have rewritten some slots already.
        await queryClient.invalidateQueries({queryKey: projectsQueryKey});
        for (const slot of SLOTS) {
          const projectId = args.slots[slot];
          if (projectId !== undefined) {
            await queryClient.invalidateQueries({
              queryKey: projectSettingsQueryKey(projectId),
            });
          }
        }

        // Publication is LAST and token-gated.
        if (attemptRef.current !== attempt) return;

        if (outcome.ok) {
          setStatus('success');
        } else {
          setError(outcome.error);
          setStatus('error');
        }
      } finally {
        if (attemptRef.current === attempt) {
          busyRef.current = false;
        }
      }
    },
    [clientApi, queryClient],
  );

  return {rename, reset, status, error};
}
