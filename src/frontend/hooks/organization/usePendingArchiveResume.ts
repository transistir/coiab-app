import {useCallback, useEffect, useRef, useState} from 'react';

import {useCoiabOrganizationsState} from '../../contexts/CoiabOrganizationsStoreContext';
import {
  useUserProfileActions,
  useUserProfileState,
} from '../../contexts/UserProfileStoreContext';
import {organizacaoEmPreparo} from '../../lib/organization/coiabOrganizations';
import {useAddRemoteArchiveToOrganization} from './useAddRemoteArchiveToOrganization';

/**
 * #129 — the single owner of the remote-archive application.
 *
 * The creation screen only records an intent (`pendingArchives` in the
 * profile). This hook, mounted once for the whole navigator, decides when that
 * intent's target organization has BOTH project ids and applies the URL to
 * both slots. It never blocks rendering or navigation: the promise is
 * fire-and-forget and failures leave the intent for another attempt.
 *
 * Scope (P1-A): ONLY intents with a non-null `organizationId` that still
 * exists in the document are applied. There is NO fallback to "the
 * organization currently in preparation" — that fallback is what leaked one
 * creation's URL into another territory. The pin itself is written by the
 * provisioning screen that owns THAT creation (route param `intentId`).
 * An intent that is still orphan after its organization had the chance to
 * leave `preparando` is discarded (with a PII-free warning), never retargeted.
 *
 * Concurrency (P1-B): every write is functional and addressed by `id`, so a
 * completion captured in an older closure removes only its own intent.
 *
 * Delivery (P1-C): `sendingSince` is persisted BEFORE the send. A mount that
 * sees a mark younger than 60 s does not send again; a mark older than 60 s is
 * an interrupted attempt (the process died mid-send) and is allowed to resend
 * ONCE. Server-side idempotency for that single replay is the server's
 * responsibility — the client cannot distinguish a lost response from a lost
 * request after a crash. When the post-success persistence fails, the id stays
 * in the in-memory `appliedIds` set so this session never resends it, while a
 * simple delayed retry tries to persist again.
 */

/** A send mark older than this is an interrupted attempt: resend once. */
export const PENDING_ARCHIVE_SENDING_STALE_MS = 60_000;
/**
 * Grace before an orphan intent is discarded. While the creation flow is
 * alive, the provisioning screen pins the intent within this window; after it,
 * a document with nothing in `preparando` means the organization left (or the
 * creation failed before registering) and the URL has no safe target.
 */
const PENDING_ARCHIVE_ORPHAN_GRACE_MS = 60_000;
/** Delay for the simple persistence retry (never a tight loop). */
const PERSIST_RETRY_MS = 1_000;
/**
 * Wake-up while any intent is still pending. Store changes alone cannot
 * advance TIME: the 60 s stale window and the orphan grace would otherwise
 * wait for an unrelated render. One tick per cycle, never a tight loop.
 */
export const PENDING_ARCHIVE_WATCHDOG_MS = 15_000;

export function usePendingArchiveResume() {
  const {pendingArchives} = useUserProfileState();
  const {updatePendingArchiveIntent, removePendingArchiveIntent} =
    useUserProfileActions();
  const estado = useCoiabOrganizationsState();
  const {start, busy} = useAddRemoteArchiveToOrganization();

  // One attempt at a time. The id (not a boolean) is enough: a completion
  // can only clear the slot when it is still the one it started.
  const emAndamentoRef = useRef<string | null>(null);
  // Session-only guard for successful sends whose persistence failed. It is
  // intentionally NOT persisted: after a restart we cannot prove the send did
  // not reach the server, so the stale-mark rule above applies instead.
  const appliedIdsRef = useRef<Set<string>>(new Set());
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  // Separate from the persistence retry: this one exists to let the clock
  // advance the stale window/orphan grace without any store change.
  const [tick, setTick] = useState(0);

  const agendarRetentativa = useCallback(() => {
    if (retryTimerRef.current !== null) return;
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      setRetryTick(tick => tick + 1);
    }, PERSIST_RETRY_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  // While anything is still pending — not yet removed from the list — schedule
  // the next wake-up. `pendingArchives.length === 0` is the only terminal
  // state: applied entries awaiting cleanup and pinned ones waiting for both
  // project ids keep the clock alive, and the timer dies with the hook.
  const temPendencia = pendingArchives.length > 0;
  useEffect(() => {
    if (!temPendencia) return;
    const timer = setTimeout(
      () => setTick(tick => tick + 1),
      PENDING_ARCHIVE_WATCHDOG_MS,
    );
    return () => clearTimeout(timer);
  }, [temPendencia, tick]);

  // P1-A: an orphan intent is never applied. Once nothing is left in
  // `preparando` and the grace window passed, its organization had its chance
  // and the URL is discarded — never handed to another territory.
  useEffect(() => {
    // Negative ticks never happen; reading the counters is what makes the
    // delayed retry and the wake-up re-run this cleanup after time passes.
    if (retryTick < 0 || tick < 0) return;
    // A hydration failure exposes an EMPTY document while the persisted one
    // still exists (SPEC A §5.3): an absent id here proves nothing about the
    // target leaving. Discarding would destroy the URL of a territory that is
    // merely unreadable this boot, so nothing is removed (or retargeted) —
    // the next cycle, after a successful rehydration, decides again. The
    // retry timer keeps a wake-up scheduled even when only the store's own
    // change could otherwise advance this effect.
    if (estado.hidratacaoFalhou) {
      if (pendingArchives.length > 0) agendarRetentativa();
      return;
    }
    const agora = Date.now();
    const emPreparo = organizacaoEmPreparo(estado);
    for (const intent of pendingArchives) {
      // Success was recorded (`appliedFor`) but the removal did not land:
      // finish the cleanup; never send again.
      if (intent.appliedFor !== null) {
        try {
          removePendingArchiveIntent(intent.id);
        } catch {
          agendarRetentativa();
        }
        continue;
      }
      if (intent.organizationId !== null) {
        // A pin whose organization left the document can never be applied:
        // no retarget is allowed (P1-A), so the existing removal flow takes
        // it out — and a failed removal is retried through the same timer.
        const alvoAindaExiste = estado.organizacoes.some(
          organizacao => organizacao.id === intent.organizationId,
        );
        if (alvoAindaExiste) continue;
        try {
          removePendingArchiveIntent(intent.id);
        } catch {
          agendarRetentativa();
        }
        continue;
      }
      if (emPreparo !== undefined) continue;
      if (agora - intent.createdAt < PENDING_ARCHIVE_ORPHAN_GRACE_MS) continue;
      // No PII: an opaque id only — never the URL, organization or profile.
      console.warn('[PendingArchive] discarded an orphan archive intent', {
        intentId: intent.id,
      });
      try {
        removePendingArchiveIntent(intent.id);
      } catch {
        agendarRetentativa();
      }
    }
  }, [
    retryTick,
    tick,
    pendingArchives,
    estado,
    removePendingArchiveIntent,
    agendarRetentativa,
  ]);

  // P1-C: retry the persistence of a successful send whose write threw. The
  // intent is already in `appliedIds`, so no resend can happen here.
  useEffect(() => {
    // `retryTick` carries no value of its own: it is the delayed retry's
    // signal to re-run this flush. Nothing queued is a no-op.
    if (appliedIdsRef.current.size === 0 || retryTick < 0) return;
    let falhou = false;
    for (const id of Array.from(appliedIdsRef.current)) {
      if (!pendingArchives.some(intent => intent.id === id)) {
        appliedIdsRef.current.delete(id);
        continue;
      }
      try {
        removePendingArchiveIntent(id);
        appliedIdsRef.current.delete(id);
      } catch {
        falhou = true;
      }
    }
    if (falhou) agendarRetentativa();
  }, [
    retryTick,
    pendingArchives,
    removePendingArchiveIntent,
    agendarRetentativa,
  ]);

  // P1-A/P1-C: apply one pinned intent at a time.
  useEffect(() => {
    // Negative ticks never happen; reading the counters is what makes the
    // delayed retry re-run this attempt after a failed mark write and the
    // wake-up re-evaluate once the 60 s stale window has passed.
    if (retryTick < 0 || tick < 0) return;
    // While hydration failed, `organizacoes` is the empty fallback: no target
    // can be matched and guessing one is forbidden (P1-A). Leave every intent
    // untouched and wait for the rehydration to publish the real document.
    if (estado.hidratacaoFalhou) return;
    if (busy) return;
    if (emAndamentoRef.current !== null) return;

    const agora = Date.now();
    const intent = pendingArchives.find(item => {
      if (item.appliedFor !== null) return false;
      if (appliedIdsRef.current.has(item.id)) return false;
      // Never guess a target: an orphan intent stays put (and is discarded
      // above once it is clearly stale), it is never applied anywhere.
      if (item.organizationId === null) return false;
      const alvo = estado.organizacoes.find(
        organizacao => organizacao.id === item.organizationId,
      );
      if (alvo === undefined) return false;
      if (
        alvo.materializacao.monitoramento.projectId === null ||
        alvo.materializacao.alertas.projectId === null
      )
        return false;
      // A mark younger than 60 s means an attempt is in flight or was just
      // attempted (a remount must not double-fire). Older than that, the
      // attempt was interrupted and may run once more.
      return (
        item.sendingSince === null ||
        agora - item.sendingSince > PENDING_ARCHIVE_SENDING_STALE_MS
      );
    });
    if (intent === undefined || intent.organizationId === null) return;

    const alvo = estado.organizacoes.find(
      organizacao => organizacao.id === intent.organizationId,
    );
    if (alvo === undefined) return;
    const monitoramentoId = alvo.materializacao.monitoramento.projectId;
    const alertasId = alvo.materializacao.alertas.projectId;
    if (monitoramentoId === null || alertasId === null) return;

    // The mark must be durable BEFORE the send: without it a remount would
    // have no way to know an attempt already ran. If it cannot be written, do
    // not send and retry the mark later.
    try {
      updatePendingArchiveIntent(intent.id, {sendingSince: agora});
    } catch {
      agendarRetentativa();
      return;
    }

    emAndamentoRef.current = intent.id;
    void start({
      slots: {m: monitoramentoId, a: alertasId},
      baseUrl: intent.url,
    })
      .then(outcome => {
        emAndamentoRef.current = null;
        // `undefined` is a superseded attempt; keep the intent.
        if (outcome === undefined || outcome.error !== undefined) return;
        appliedIdsRef.current.add(intent.id);
        try {
          // Durable mark BEFORE removal: if the removal below fails, the next
          // mount sees `appliedFor` and only finishes the cleanup.
          updatePendingArchiveIntent(intent.id, {
            appliedFor: alvo.id,
            sendingSince: null,
          });
          removePendingArchiveIntent(intent.id);
          appliedIdsRef.current.delete(intent.id);
        } catch {
          // Persistence failed: this session must not resend. The delayed
          // retry above tries to persist again (no tight loop).
          agendarRetentativa();
        }
      })
      .catch(() => {
        // Failure: keep the intent with its mark. The next attempt is allowed
        // only after the stale window, and always against the same target.
        emAndamentoRef.current = null;
      });
  }, [
    retryTick,
    tick,
    busy,
    pendingArchives,
    estado,
    start,
    updatePendingArchiveIntent,
    removePendingArchiveIntent,
    agendarRetentativa,
  ]);
}

/** Null-rendering mount point for the always-mounted navigator owner. */
export function PendingArchiveResume() {
  usePendingArchiveResume();
  return null;
}
