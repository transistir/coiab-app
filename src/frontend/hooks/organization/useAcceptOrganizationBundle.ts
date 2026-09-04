import {useCallback, useEffect, useRef, useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useClientApi} from '@comapeo/core-react';

import {useActiveProjectIdActions} from '../../contexts/ActiveProjectIdStoreContext';
import {
  useOrganizationInviteIdentities,
  useOrganizationInviteIdentityActions,
} from '../../contexts/OrganizationInviteIdentityStoreContext';
import type {OrganizationInviteBundle} from '../../lib/organization/bundle';
import {acceptOrganizationBundle} from '../../lib/organization/fanout';
import {
  invitesQueryKey,
  projectsQueryKey,
} from '../../lib/organization/queryKeys';
import {reconstructOrganizations} from '../../lib/organization/reconstruct';
import {SLOTS, type Slot} from '../../lib/organization/marker';

export type AcceptOrganizationBundleStatus =
  'idle' | 'accepting' | 'success' | 'error';

/**
 * What `start` settled on: `undefined` when it never ran (a re-entry attempt
 * while one is in flight) or was superseded mid-flight; `ok: false` carries
 * the failure the React state also publishes; `ok: true` carries the accepted
 * slots and the project id that became active (SPEC 8.6 ladder).
 */
export type AcceptOrganizationBundleResult =
  | {
      ok: true;
      accepted: Array<{slot: Slot; projectId: string}>;
      activeProjectId: string | undefined;
    }
  | {ok: false; error: unknown};

/**
 * P5 O4: a slot counts as local when ANY read of the organization saw it —
 * the post-accept fresh read, the pre-accept local read, or this accept's
 * own result. The fresh read alone is not authoritative: it can be stale
 * (still missing a slot this accept just joined) and it can also lose sight
 * of a slot the pre-accept read held.
 */
function bothSlotsPresent(
  preAcceptSlots: Partial<Record<Slot, string>> | undefined,
  accepted: Array<{slot: Slot; projectId: string}>,
  freshSlots: Partial<Record<Slot, string>> | undefined,
): boolean {
  const seen = new Set<string>([
    ...Object.keys(preAcceptSlots ?? {}),
    ...accepted.map(({slot}) => slot),
    ...Object.keys(freshSlots ?? {}),
  ]);
  return SLOTS.every(slot => seen.has(slot));
}

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
  const {setIdentity, clearIdentity} = useOrganizationInviteIdentityActions();
  const identities = useOrganizationInviteIdentities();

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
    ): Promise<AcceptOrganizationBundleResult | undefined> => {
      if (busyRef.current) return undefined;
      busyRef.current = true;
      attemptRef.current += 1;
      const attempt = attemptRef.current;

      setStatus('accepting');
      setError(undefined);
      // PLAN-46 decision 6: the persisted identity pins a recovery accept of
      // a partial bundle. An identity already stored for this organization
      // wins untouched — overwriting it would let a DIVERGENT re-invite
      // (different invitor/role) re-pin the organization to itself — and the
      // fan-out validates every present invite against it, failing closed on
      // `identity-mismatch`. Only a first-ever accept mints the identity here.
      const persistedIdentity =
        identities[bundle.organizationId] ??
        ({
          invitorDeviceId: bundle.invitorDeviceId,
          roleName: bundle.roleName,
        } as const);
      if (identities[bundle.organizationId] === undefined) {
        setIdentity(bundle.organizationId, persistedIdentity);
      }

      // P5 O2: compute the outcome WITHOUT publishing any of it — the
      // screen's vanish-effect must never observe a settled, non-busy state
      // while the bundle can still disappear under the invalidations below.
      let outcome: AcceptOrganizationBundleResult;
      let identityComplete = false;
      try {
        // SPEC 8.6: capture the pre-accept local reconstruction — the read
        // after the accept can lag behind core, and local state known
        // before the accept must still outrank this accept's own result.
        const preAcceptOrg = reconstructOrganizations(
          await clientApi.listProjects(),
        ).find(org => org.organizationId === bundle.organizationId);

        const accepted = await acceptOrganizationBundle(clientApi, bundle, {
          persistedIdentity,
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

        // P5 O4: the persisted identity is only needed while the
        // organization is incomplete — once every slot is local across the
        // reads, the recovery case it guards is over.
        identityComplete = bothSlotsPresent(
          preAcceptOrg?.slots,
          accepted,
          freshOrg?.slots,
        );

        outcome = {ok: true, accepted, activeProjectId};
      } catch (e) {
        outcome = {ok: false, error: e};
      }

      try {
        // Direct clientApi calls bypass core-react's own invalidation, so
        // the project-list and invite-list queries must be invalidated by
        // hand for mounted consumers to see the joins — regardless of
        // outcome: a failed attempt may still have joined a slot, and cache
        // repair is never token-gated; only the React state below is.
        await queryClient.invalidateQueries({queryKey: projectsQueryKey});
        await queryClient.invalidateQueries({queryKey: invitesQueryKey});

        // P5 O2: publication is LAST and token-gated — status/error land
        // only once the invalidations have settled, so a rerender observing
        // a settled state can no longer have the bundle vanish under it.
        if (attemptRef.current !== attempt) return undefined;

        if (outcome.ok) {
          if (outcome.activeProjectId !== undefined) {
            setActiveProjectId(outcome.activeProjectId);
          }
          if (identityComplete) {
            clearIdentity(bundle.organizationId);
          }
          setStatus('success');
        } else {
          setError(outcome.error);
          setStatus('error');
        }
        return outcome;
      } finally {
        if (attemptRef.current === attempt) {
          busyRef.current = false;
        }
      }
    },
    [
      clientApi,
      queryClient,
      setActiveProjectId,
      identities,
      setIdentity,
      clearIdentity,
    ],
  );

  return {start, reset, status, error};
}
