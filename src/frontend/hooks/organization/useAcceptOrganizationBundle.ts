import {useCallback, useEffect, useRef, useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useClientApi} from '@comapeo/core-react';

import {
  useCoiabOrganizationsActions,
  useCoiabOrganizationsStoreContext,
} from '../../contexts/CoiabOrganizationsStoreContext';
import {useOrganizationActivationContext} from '../../contexts/OrganizationActivationContext';
import {
  useOrganizationInviteIdentities,
  useOrganizationInviteIdentityActions,
} from '../../contexts/OrganizationInviteIdentityStoreContext';
import type {OrganizationInviteBundle} from '../../lib/organization/bundle';
import {
  acceptOrganizationBundle,
  isAcceptOriginError,
  OrganizationOperationError,
} from '../../lib/organization/fanout';
import {
  invitesQueryKey,
  projectsQueryKey,
} from '../../lib/organization/queryKeys';
import {
  reconstructOrganizations,
  type ReconstructedOrganization,
} from '../../lib/organization/reconstruct';
import {SLOTS, type Slot} from '../../lib/organization/marker';
import {iniciarOperacao} from '../../lib/organization/operacoesEmAndamento';

export type AcceptOrganizationBundleStatus =
  'idle' | 'accepting' | 'success' | 'error';

/**
 * What `start` settled on: `undefined` when it never ran (a re-entry attempt
 * while one is in flight) or was superseded mid-flight; `ok: false` carries
 * the failure the React state also publishes; `ok: true` carries the accepted
 * slots and — when the organization was REGISTERED as an invite entry (SPEC
 * B §5.5) — the id of the registered organization, in which case activation
 * is handed to the engine (`retryPreparation`) instead of being forced here.
 */
export type AcceptOrganizationBundleResult =
  | {
      ok: true;
      accepted: Array<{slot: Slot; projectId: string}>;
      registeredOrganizationId?: string;
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
 * (validation and slot skipping are `acceptOrganizationBundle`'s job) and,
 * on a COMPLETE accept (every slot local across the reads), register the
 * invite entry in the durable document (SPEC B §5.5) with the two accepted
 * project ids and hand activation to the engine (`retryPreparation` — the
 * materializer's `retomar` then dispatches by origin). The hand-off decides
 * on the durable document: the bundle's organization is located BY ID in it
 * (never by index) — the entry the registration just wrote or found. With
 * the registration REFUSED, the entry's OWN estado decides the outcome:
 * - `pronta` — the organization is already durably entered (a re-delivery
 *   of a fully entered organization): success with no retoma hand-off and
 *   no publication;
 * - absent OR present but not `pronta` — an entry with that id existing
 *   never proves the invite entry landed (it may come from another origin,
 *   e.g. a local creation still `preparando`): an impossible state for the
 *   invite flow that publishes the typed `invite-registration-missing`
 *   error with NO write.
 * The hook never forces a project active itself (there is no `projetar`
 * fallback; the refused legacy direct activation is gone).
 */
export function useAcceptOrganizationBundle() {
  const clientApi = useClientApi();
  const queryClient = useQueryClient();
  const {registrarEntradaPorConvite} = useCoiabOrganizationsActions();
  // The durable organization document: the retoma hand-off locates the
  // bundle's organization BY ID in it — never by index.
  const {instance: documento} = useCoiabOrganizationsStoreContext();
  // The activation engine, mounted once at the root: a registered entry
  // hands its confirmation to the engine instead of forcing a slot active.
  const {retryPreparation} = useOrganizationActivationContext();
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
      // Operação em voo alimenta o guard de trabalho pendente do motor de
      // ativação (Fase 8a): contada na entrada, encerrada no finally —
      // inclusive nos retornos antecipados (token vencido por reset/unmount).
      const terminar = iniciarOperacao();
      try {
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
        // Hoisted for the catch AND the registration: the reconciliation
        // reads the same reconstruction the publication-time registration
        // resolves each slot's projectId from, whichever path produced the
        // outcome.
        let preAcceptOrg: ReconstructedOrganization | undefined;
        let freshOrg: ReconstructedOrganization | undefined;
        try {
          // P5 O4: capture the pre-accept local reconstruction — the union
          // of this read and the post-accept one decides identity
          // completion, and the publication-time registration resolves each
          // slot's projectId from the freshest source that saw it.
          preAcceptOrg = reconstructOrganizations(
            await clientApi.listProjects(),
          ).find(org => org.organizationId === bundle.organizationId);

          const accepted = await acceptOrganizationBundle(clientApi, bundle, {
            persistedIdentity,
          });

          freshOrg = reconstructOrganizations(
            await clientApi.listProjects(),
          ).find(org => org.organizationId === bundle.organizationId);

          // P5 O4: the persisted identity is only needed while the
          // organization is incomplete — once every slot is local across the
          // reads, the recovery case it guards is over.
          identityComplete = bothSlotsPresent(
            preAcceptOrg?.slots,
            accepted,
            freshOrg?.slots,
          );

          outcome = {ok: true, accepted};
        } catch (e) {
          // Bug 46: a rejecting accept is not necessarily a failed accept —
          // the sync/IPC timeout rejects the call while core completes the
          // join (reject-but-completed). Re-read the local state and classify:
          // every slot present across the reads is a completed organization
          // the rejection must not report as a failure; some progress is a
          // typed `accept-partial` failure naming the slots still missing
          // (the original error kept as `cause`); no progress at all leaves
          // the original error untouched — there is nothing to reconcile.
          //
          // Only a failure of the invite.accept call itself is reconciled
          // (marked by `acceptOrganizationBundle`): the preflight errors it
          // also throws (identity-mismatch, invalid-local-state, ...) describe
          // a bundle that must not join however complete the local
          // organization looks, so they surface untouched instead of being
          // read into a success that also unpins the recovery identity.
          if (isAcceptOriginError(e)) {
            try {
              freshOrg = reconstructOrganizations(
                await clientApi.listProjects(),
              ).find(org => org.organizationId === bundle.organizationId);

              const accepted = SLOTS.flatMap(slot => {
                const projectId =
                  freshOrg?.slots[slot] ?? preAcceptOrg?.slots[slot];
                return projectId === undefined ? [] : [{slot, projectId}];
              });
              const missingSlots = SLOTS.filter(slot =>
                accepted.every(entry => entry.slot !== slot),
              );

              if (missingSlots.length === 0) {
                identityComplete = true;
                outcome = {ok: true, accepted};
              } else if (accepted.length > 0) {
                outcome = {
                  ok: false,
                  error: new OrganizationOperationError(
                    'accept-partial',
                    `the accept ended before completing: slots ${missingSlots.join(', ')} are still missing (the joined slots may have completed despite the failure)`,
                    {cause: e, missingSlots},
                  ),
                };
              } else {
                outcome = {ok: false, error: e};
              }
            } catch {
              // The reconciliation read failed too — the original error is all
              // we know.
              outcome = {ok: false, error: e};
            }
          } else {
            outcome = {ok: false, error: e};
          }
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

          let registeredOrganizationId: string | undefined;
          if (outcome.ok && identityComplete) {
            // SPEC B §5.5: a COMPLETE accept is an entered organization —
            // register it in the durable document with the two accepted
            // projectIds (each resolved from the freshest source that saw
            // it), never through a new accept of a single slot.
            const {accepted} = outcome;
            const projectIdDe = (slot: Slot): string | undefined =>
              freshOrg?.slots[slot] ??
              preAcceptOrg?.slots[slot] ??
              accepted.find(entry => entry.slot === slot)?.projectId;
            const monitoramento = projectIdDe('m');
            const alertas = projectIdDe('a');
            if (monitoramento !== undefined && alertas !== undefined) {
              const registrada = registrarEntradaPorConvite({
                organizacaoId: bundle.organizationId,
                nome: bundle.organizationName ?? '',
                projectIds: {monitoramento, alertas},
              });
              // The retoma hand-off decides on the durable document: the
              // bundle's organization is located BY ID — never by index —
              // right where the registration just wrote (or found) its
              // entry. Nothing else decides "retomada vs. primeiro aceite".
              const entrada = documento
                .getState()
                .organizacoes.find(org => org.id === bundle.organizationId);
              if (registrada) {
                registeredOrganizationId = bundle.organizationId;
                // The engine confirms the entry (retomar dispatches by
                // origin: `verificarEntrada` for a convite journal) and
                // publishes the selection — its own state carries any
                // failure, so this stays fire-and-forget.
                void retryPreparation(bundle.organizationId);
              } else if (entrada?.estado !== 'pronta') {
                // Proibido projetar: the registration was REFUSED while the
                // organization is not durably entered — the entry is absent
                // (the store refusing — a projectId already associated with
                // another local organization, an empty name — or the entry
                // discarded between steps) or present but NOT `pronta`
                // (another origin, e.g. a local creation, whose existence
                // alone never proves the invite entry landed). A success
                // here would swallow the refusal: typed error, and NO
                // write — the hook never forces a project active itself.
                outcome = {
                  ok: false,
                  error: new OrganizationOperationError(
                    'invite-registration-missing',
                    `the accepted organization ${bundle.organizationId} has no pronta entry in the durable document and the registration was refused`,
                    {organizationId: bundle.organizationId},
                  ),
                };
              }
              // A refusal with a `pronta` entry: the organization is already
              // durably entered (a re-delivery) — no retoma hand-off is
              // needed.
            }
          }

          if (outcome.ok) {
            // A registered entry hands activation to the engine above — the
            // hook never forces a slot itself: there is no `projetar`
            // fallback in the invite flow (a missing registration is the
            // typed `invite-registration-missing` error above).
            if (identityComplete) {
              clearIdentity(bundle.organizationId);
            }
            outcome = {...outcome, registeredOrganizationId};
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
      } finally {
        terminar();
      }
    },
    [
      clientApi,
      queryClient,
      documento,
      registrarEntradaPorConvite,
      retryPreparation,
      identities,
      setIdentity,
      clearIdentity,
    ],
  );

  return {start, reset, status, error};
}
