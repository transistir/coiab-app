import {useCallback, useEffect, useRef, useState} from 'react';
import {useClientApi} from '@comapeo/core-react';
import {useQueryClient} from '@tanstack/react-query';

import {
  discardIncompleteOrganization,
  type DiscardResult,
} from '../../lib/organization/fanout';
import {projectsQueryKey} from '../../lib/organization/queryKeys';

export type DiscardOrganizationStatus =
  'idle' | 'discarding' | 'success' | 'error';

/**
 * The escape hatch for the fail-closed create: tears down the half-built
 * organization (`discardIncompleteOrganization` carries the provenance and
 * member checks, the pre-leave revalidation and the leaves) so creation can
 * restart fresh. Matches the other organization hooks' lifecycle (P6 Q2): a
 * synchronous busy guard against re-entry, an attempt token so a superseded
 * or unmounted attempt publishes nothing, invalidations that settle before
 * the terminal status is published, and a reset that is inert while busy.
 */
export function useDiscardIncompleteOrganization() {
  const clientApi = useClientApi();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<DiscardOrganizationStatus>('idle');
  const [error, setError] = useState<unknown>(undefined);
  const [result, setResult] = useState<DiscardResult | undefined>(undefined);

  // A synchronous re-entry guard: a status check alone would let a second
  // call slip through before the rerender publishes 'discarding'.
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
    setResult(undefined);
  }, []);

  const discard = useCallback(
    async (organizationId: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      attemptRef.current += 1;
      const attempt = attemptRef.current;

      setStatus('discarding');
      setError(undefined);
      setResult(undefined);

      // The outcome is computed WITHOUT publishing it — terminal status
      // lands only after the invalidations below have settled.
      let outcome:
        {ok: true; result: DiscardResult} | {ok: false; error: unknown};
      try {
        outcome = {
          ok: true,
          result: await discardIncompleteOrganization(clientApi, {
            organizationId,
          }),
        };
      } catch (e) {
        outcome = {ok: false, error: e};
      }

      try {
        // Direct clientApi calls bypass core-react's own invalidation, so
        // the project list (which feeds `useOrganizations` and the startup
        // gate) must be invalidated by hand — also on error, since a failed
        // discard may have left some projects already.
        await queryClient.invalidateQueries({queryKey: projectsQueryKey});

        // Publication is LAST and token-gated.
        if (attemptRef.current !== attempt) return;

        if (outcome.ok) {
          setResult(outcome.result);
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

  return {discard, reset, status, error, result};
}
