import {useCallback, useEffect, useRef, useState} from 'react';
import type {MemberApi} from '@comapeo/core';
import {useClientApi} from '@comapeo/core-react';
import {useQueryClient} from '@tanstack/react-query';

import {SLOTS, type Slot} from '../../lib/organization/marker';
import {
  invitesQueryKey,
  membersQueryKey,
} from '../../lib/organization/queryKeys';

/**
 * One slot of a concurrent invite send. Core's `invite()` resolves only when
 * the device answers (or the wait fails), so there is no separate in-transit
 * state to surface — 'sending' covers the whole flight (SPEC 6.2).
 */
export type SlotSendState =
  'idle' | 'sending' | 'accepted' | 'rejected' | 'timeout' | 'error';

export type InviteOrganizationProgress = {
  monitoramento: SlotSendState;
  alertas: SlotSendState;
  error?: unknown;
};

type InviteArgs = {
  slots: Record<Slot, string>;
  deviceId: string;
  roleId: string;
};

const IDLE_PROGRESS: InviteOrganizationProgress = {
  monitoramento: 'idle',
  alertas: 'idle',
};

/**
 * A no-response invite (SPEC 6.3) is a timeout, not an arbitrary error, so
 * the UI can say "sem resposta" instead of "algo deu errado". Core signals
 * timeouts in more than one shape depending on where the wait happens:
 * `TimeoutError` (code `TIMEOUT_ERROR`), the `AbortSignal.timeout()`
 * DOMException (`name: 'TimeoutError'`), and `InviteAbortedError` when the
 * wait for the peer response is aborted. Match positively on those — via
 * `cause` too, since core wraps unknown aborts — and only then.
 */
function isTimeoutError(error: unknown, depth = 0): boolean {
  if (depth > 3 || !(error instanceof Error)) return false;
  if (
    (error as {code?: string}).code === 'TIMEOUT_ERROR' ||
    error.name === 'TimeoutError' ||
    (error as {code?: string}).code === 'INVITE_ABORTED_ERROR' ||
    error.name === 'InviteAbortedError'
  ) {
    return true;
  }
  if (/timed? ?out/i.test(error.message)) return true;
  return isTimeoutError((error as {cause?: unknown}).cause, depth + 1);
}

/**
 * SPEC 3.4 / 6.2: invite one device into BOTH projects of the organization
 * with the manager-level APIs directly — no activeProjectId switching. The
 * two invites are sent concurrently and one failing never aborts the other.
 */
export function useInviteToOrganization() {
  const clientApi = useClientApi();
  const queryClient = useQueryClient();

  const [progress, setProgress] =
    useState<InviteOrganizationProgress>(IDLE_PROGRESS);
  const [busy, setBusy] = useState(false);
  // A synchronous re-entry guard: a busy state check alone would let a
  // second call slip through before the rerender publishes it.
  const busyRef = useRef(false);
  const argsRef = useRef<InviteArgs | undefined>(undefined);
  // Attempts publish state only while their token is current, so a
  // completion from before a reset() or an unmount publishes nothing.
  const attemptRef = useRef(0);

  useEffect(() => {
    return () => {
      attemptRef.current += 1;
      busyRef.current = false;
    };
  }, []);

  const sendSlots = useCallback(
    async (slotsToSend: readonly Slot[]) => {
      const args = argsRef.current;
      if (!args) return;
      const attempt = attemptRef.current;

      setProgress(prev => {
        const next = {...prev};
        for (const slot of slotsToSend) {
          next[slot === 'm' ? 'monitoramento' : 'alertas'] = 'sending';
        }
        return next;
      });

      const results = await Promise.all(
        slotsToSend.map(async slot => {
          try {
            const projectApi = await clientApi.getProject(args.slots[slot]);
            const decision = await projectApi.$member.invite(args.deviceId, {
              // Core narrows to the known role ids; screens pass one of
              // the sharedTypes role id constants.
              roleId: args.roleId as MemberApi.RoleIdForNewInvite,
            });
            return {
              slot,
              state:
                decision === 'REJECT'
                  ? ('rejected' as const)
                  : ('accepted' as const),
              error: undefined,
            };
          } catch (e) {
            return {
              slot,
              state: isTimeoutError(e)
                ? ('timeout' as const)
                : ('error' as const),
              error: e,
            };
          } finally {
            // Direct $member.invite calls bypass core-react's own
            // invalidation (its useSendInvite refreshes the member and
            // invite lists when the mutation settles), so each slot
            // invalidates by hand as it settles — a slot that failed or
            // timed out still refreshed the caches.
            await queryClient.invalidateQueries({
              queryKey: membersQueryKey(args.slots[slot]),
            });
            await queryClient.invalidateQueries({queryKey: invitesQueryKey});
          }
        }),
      );

      if (attemptRef.current !== attempt) return;

      setProgress(prev => {
        const next = {...prev};
        let firstError: unknown = undefined;
        for (const result of results) {
          next[result.slot === 'm' ? 'monitoramento' : 'alertas'] =
            result.state;
          if (result.error !== undefined && firstError === undefined) {
            firstError = result.error;
          }
        }
        // The aggregate error describes THIS send only: a retry that
        // answers every re-sent slot must clear it.
        next.error = firstError;
        return next;
      });
    },
    [clientApi, queryClient],
  );

  const start = useCallback(
    async (args: InviteArgs) => {
      if (busyRef.current) return;
      busyRef.current = true;
      attemptRef.current += 1;
      const attempt = attemptRef.current;
      argsRef.current = args;
      setBusy(true);
      setProgress(IDLE_PROGRESS);
      await sendSlots(SLOTS);
      if (attemptRef.current !== attempt) return;
      busyRef.current = false;
      setBusy(false);
    },
    [sendSlots],
  );

  /**
   * SPEC 6.5: re-send ONLY the slots that got no definitive answer
   * (`timeout` | `error`). A `rejected` slot was answered by the device and
   * is never re-sent; `'ALREADY'` on retry counts as accepted.
   */
  const retryFailed = useCallback(async () => {
    if (busyRef.current) return;
    const args = argsRef.current;
    if (!args) return;
    const failed = SLOTS.filter(
      slot =>
        progress[slot === 'm' ? 'monitoramento' : 'alertas'] === 'timeout' ||
        progress[slot === 'm' ? 'monitoramento' : 'alertas'] === 'error',
    );
    if (failed.length === 0) return;
    busyRef.current = true;
    attemptRef.current += 1;
    const attempt = attemptRef.current;
    setBusy(true);
    await sendSlots(failed);
    if (attemptRef.current !== attempt) return;
    busyRef.current = false;
    setBusy(false);
  }, [progress, sendSlots]);

  /**
   * SPEC 6.5 reset. A no-op while a send/retry is running: a mid-flight
   * reset can no longer duplicate side effects nor leave `busy` permanently
   * true — the running send keeps its token, settles normally, and clears
   * its own busy flag. When idle, clears the progress and any stuck busy
   * state.
   */
  const reset = useCallback(() => {
    if (busyRef.current) return;
    attemptRef.current += 1;
    busyRef.current = false;
    setBusy(false);
    setProgress(IDLE_PROGRESS);
  }, []);

  return {progress, busy, start, retryFailed, reset};
}
