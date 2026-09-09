import {useCallback, useEffect, useRef, useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useClientApi} from '@comapeo/core-react';

import {SLOTS, type Slot} from '../../lib/organization/marker';
import {membersQueryKey} from '../../lib/organization/queryKeys';

export type SlotArchiveState = 'idle' | 'adding' | 'done' | 'error';

export type AddRemoteArchiveProgress = {
  monitoramento: SlotArchiveState;
  alertas: SlotArchiveState;
  error?: unknown;
};

/**
 * What a completed `start()` resolved to. `error` is the first slot error
 * (undefined when both slots succeeded); the per-slot detail stays in
 * `progress` for surfaces that show partial outcomes. `undefined` means the
 * attempt was superseded (reset or unmount) and published nothing — the
 * caller must not navigate on it.
 */
export type AddRemoteArchiveOutcome = {error?: unknown} | undefined;

const IDLE_PROGRESS: AddRemoteArchiveProgress = {
  monitoramento: 'idle',
  alertas: 'idle',
};

/**
 * SPEC 11 / E8: add the same self-hosted server to BOTH projects of the
 * organization with one user action. Manager-level APIs directly — no
 * activeProjectId switching. One slot failing never aborts the other; the
 * per-slot states surface the partial outcome.
 */
export function useAddRemoteArchiveToOrganization() {
  const clientApi = useClientApi();
  const queryClient = useQueryClient();

  const [progress, setProgress] =
    useState<AddRemoteArchiveProgress>(IDLE_PROGRESS);
  const [busy, setBusy] = useState(false);

  // A synchronous re-entry guard: a busy state check alone would let a
  // second call slip through before the rerender publishes it.
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
   * Reset to idle. A no-op while a send is running: a mid-flight reset can
   * no longer duplicate side effects nor leave `busy` permanently true —
   * the running send keeps its token, settles normally, and clears its own
   * busy flag. When idle, clears the progress and any stuck busy state.
   */
  const reset = useCallback(() => {
    if (busyRef.current) return;
    attemptRef.current += 1;
    busyRef.current = false;
    setBusy(false);
    setProgress(IDLE_PROGRESS);
  }, []);

  const start = useCallback(
    async ({
      slots,
      baseUrl,
    }: {
      slots: Record<Slot, string>;
      baseUrl: string;
    }): Promise<AddRemoteArchiveOutcome> => {
      if (busyRef.current) return;
      busyRef.current = true;
      attemptRef.current += 1;
      const attempt = attemptRef.current;

      setBusy(true);
      setProgress({
        monitoramento: 'adding',
        alertas: 'adding',
        error: undefined,
      });

      const results = await Promise.all(
        SLOTS.map(async slot => {
          try {
            const projectApi = await clientApi.getProject(slots[slot]);
            await projectApi.$member.addServerPeer(baseUrl);
            return {slot, state: 'done' as const, error: undefined};
          } catch (e) {
            return {slot, state: 'error' as const, error: e};
          } finally {
            // Direct clientApi calls bypass core-react's own invalidation,
            // so the member list of each touched project must be
            // invalidated by hand — per slot, as it settles, not only at
            // the end of the fan-out.
            await queryClient.invalidateQueries({
              queryKey: membersQueryKey(slots[slot]),
            });
          }
        }),
      );

      if (attemptRef.current !== attempt) return undefined;

      const next = {...IDLE_PROGRESS};
      let firstError: unknown = undefined;
      for (const result of results) {
        next[result.slot === 'm' ? 'monitoramento' : 'alertas'] = result.state;
        if (result.error !== undefined && firstError === undefined) {
          firstError = result.error;
        }
      }
      next.error = firstError;

      setProgress(next);
      busyRef.current = false;
      setBusy(false);
      return {error: firstError};
    },
    [clientApi, queryClient],
  );

  return {progress, busy, start, reset};
}
