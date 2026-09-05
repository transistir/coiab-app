/**
 * Orchestration of the Organization product actions with injected
 * dependencies — no react, no @comapeo/core import (structural types only),
 * so the logic runs in unit tests against hand-rolled fakes.
 */
import {
  ORGANIZATION_ID_PATTERN,
  SLOTS,
  SLOT_PROJECT_NAMES,
  markerFor,
  parseMarker,
  type Slot,
} from './marker';
import type {InviteLike} from './bundle';
import {reconstructOrganizations} from './reconstruct';

export type ProjectLike = {
  $getProjectSettings(): Promise<{
    name?: string;
    projectDescription?: string;
  }>;
};

export type ManagerLike = {
  listProjects(): Promise<
    Array<{
      projectId: string;
      projectDescription?: string;
      status: 'joined' | 'joining' | 'left';
    }>
  >;
  createProject(opts: {
    name: string;
    projectDescription?: string;
  }): Promise<string>;
  getProject(projectId: string): Promise<ProjectLike>;
  invite: {accept(invite: {inviteId: string}): Promise<string>};
};

/**
 * Typed failure codes for the product actions — the hook layer branches on
 * these instead of parsing error messages.
 */
export type OrganizationErrorCode =
  | 'empty-name'
  | 'invalid-organization-id'
  | 'invalid-local-state'
  | 'foreign-organization'
  | 'invite-not-pending'
  | 'invite-unmarked'
  | 'slot-mismatch'
  | 'missing-invite'
  | 'identity-required'
  | 'identity-mismatch'
  | 'bundle-inconsistent'
  | 'accept-partial'
  | 'incomplete-org-blocks-create'
  | 'organization-not-incomplete';

export class OrganizationOperationError extends Error {
  readonly code: OrganizationErrorCode;
  constructor(
    code: OrganizationErrorCode,
    message: string,
    readonly details?: {
      slot?: Slot;
      organizationId?: string;
      /** `incomplete-org-blocks-create`: the create the block refused. */
      requestedOrganizationId?: string;
      cause?: unknown;
      /** `accept-partial`: the slots the accept did not get local. */
      missingSlots?: Slot[];
    },
  ) {
    super(message);
    this.name = 'OrganizationOperationError';
    this.code = code;
  }
}

/**
 * Failures thrown by the `invite.accept` call itself (the reject-but-completed
 * family, Bug 46) — the only errors a caller may reconcile against local
 * state after the fact. `acceptOrganizationBundle` also throws preflight
 * validation errors (`identity-mismatch`, `invalid-local-state`, ...) that
 * describe a bundle which must not join however complete the local
 * organization looks, so those never carry the marker and always surface as
 * errors. Errors are marked, not wrapped, so the original failure stays the
 * one callers see.
 */
const acceptOriginErrors = new WeakSet<object>();

function markAcceptOrigin(error: unknown): unknown {
  if (typeof error === 'object' && error !== null) {
    acceptOriginErrors.add(error);
  }
  return error;
}

/** True when `error` was thrown by the `invite.accept` call itself. */
export function isAcceptOriginError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && acceptOriginErrors.has(error)
  );
}

/**
 * Finding 3: `invite.accept` can reject with a non-Error value (a string,
 * null) — a WeakSet cannot mark those, and an unmarked failure would skip
 * the hook's reject-but-completed reconciliation entirely. Errors pass
 * through untouched (the original failure stays the one callers see);
 * anything else is wrapped, the original rejection kept as `cause`.
 */
function normalizeAcceptFailure(error: unknown): Error {
  if (error instanceof Error) return error;
  const wrapped = new Error(
    `invite.accept rejected with a non-error value: ${String(error)}`,
  );
  // `cause` is only typed under the es2022.error lib, which this project
  // does not target — assigned directly so the value still rides along.
  (wrapped as Error & {cause?: unknown}).cause = error;
  return wrapped;
}

/**
 * SPEC 5: "Criar organização" = one product action provisioning both
 * projects. Idempotent on resume (SPEC 5 / E7 create-side): the org is
 * reconstructed from `listProjects()` first — an existing `ready` org is
 * returned unchanged, an `incomplete` org gets ONLY its missing slots, an
 * absent org gets both. Never creates a slot that already exists.
 */
export async function createOrganization(
  manager: ManagerLike,
  opts: {organizationId: string; organizationName: string},
): Promise<{projectIds: Record<Slot, string>}> {
  if (opts.organizationName.trim().length === 0) {
    throw new OrganizationOperationError(
      'empty-name',
      'organization name must not be empty or whitespace',
    );
  }
  if (!ORGANIZATION_ID_PATTERN.test(opts.organizationId)) {
    throw new OrganizationOperationError(
      'invalid-organization-id',
      `organization id ${opts.organizationId} must be 16 lowercase hex chars`,
      {organizationId: opts.organizationId},
    );
  }

  const localOrgs = reconstructOrganizations(await manager.listProjects());
  const existing = localOrgs.find(
    org => org.organizationId === opts.organizationId,
  );
  // Fail closed (SPEC 10): a duplicate-slot conflict under this id must be
  // resolved by a human, not extended with an arbitrary new slot.
  if (existing?.state === 'invalid') {
    throw new OrganizationOperationError(
      'invalid-local-state',
      `local organization ${opts.organizationId} is invalid (${existing.reason}); refusing to modify it`,
      {organizationId: opts.organizationId},
    );
  }

  // Fail closed (Bug 46): a create whose id matches no local organization
  // must never mint a second organization while an INCOMPLETE one sits on
  // the device. That is exactly the restart case — a create whose slot write
  // mutated-then-rejected loses its organization id with the hook instance,
  // and a fresh form generates a new one, provisioning a duplicate
  // Monitoramento/Alertas pair next to the half-finished org. Adopting the
  // incomplete org under the new id would hide its state from the user
  // instead, so this surfaces it: the screen routes the error to the
  // provisioning screen, which resumes under the reconstructed id.
  if (!existing) {
    const incomplete = localOrgs.find(org => org.state === 'incomplete');
    if (incomplete) {
      throw new OrganizationOperationError(
        'incomplete-org-blocks-create',
        `an incomplete organization (${incomplete.organizationId}) is already being set up on this device; finish it before creating another`,
        // `organizationId` names the BLOCKING org — the one a consumer
        // resumes or discards; the refused create's id rides along
        // separately, so the two never get conflated.
        {
          organizationId: incomplete.organizationId,
          requestedOrganizationId: opts.organizationId,
        },
      );
    }
  }

  const projectIds: Partial<Record<Slot, string>> = {};
  for (const slot of SLOTS) {
    projectIds[slot] = existing?.slots[slot];
  }

  for (const slot of SLOTS) {
    if (projectIds[slot] !== undefined) continue; // never recreate a slot
    projectIds[slot] = await manager.createProject({
      name: SLOT_PROJECT_NAMES[slot],
      projectDescription: markerFor(
        opts.organizationId,
        slot,
        opts.organizationName,
      ),
    });
  }

  return {projectIds: projectIds as Record<Slot, string>};
}

/**
 * A ManagerLike extended with what `discardIncompleteOrganization` needs,
 * mirroring `@comapeo/core`'s real API surface (`leaveProject`,
 * `getDeviceInfo` — sync on the manager, promised through the client-api
 * wrapper, hence the union — and `getProject(id).$getOwnRole()` /
 * `$member.getMany()`), so the client api satisfies it as-is.
 */
export type DiscardableManagerLike = Omit<ManagerLike, 'getProject'> & {
  leaveProject(projectId: string): Promise<void>;
  getDeviceInfo(): {deviceId: string} | Promise<{deviceId: string}>;
  getProject(projectId: string): Promise<
    ProjectLike & {
      $getOwnRole(): Promise<{roleId: string}>;
      $member: {getMany(): Promise<Array<{deviceId: string}>>};
    }
  >;
};

/**
 * Copied from `@comapeo/core/src/roles.js`, like `sharedTypes`' copy (the
 * constant is not exported by the package — digidem/mapeo-core-next#532).
 * `fanout.ts` keeps no `@comapeo/core` import so it stays unit-testable, so
 * the literal lives here too; if the two copies ever diverge, a discard can
 * only fail CLOSED (every project skipped), never delete a shared project.
 */
export const CREATOR_ROLE_ID = 'a12a6702b93bd7ff';

/** Why a discard did NOT remove a slot project it found. */
export type DiscardSkipReason =
  'not-created-here' | 'shared-with-other-devices' | 'no-longer-incomplete';

/** What a discard settled on: the slots removed, and those it refused to. */
export type DiscardResult = {
  /** True when every slot project was removed — creation is unblocked. */
  ok: boolean;
  removed: Array<{slot: Slot; projectId: string}>;
  skipped: Array<{slot: Slot; projectId: string; reason: DiscardSkipReason}>;
};

/**
 * The escape hatch for the fail-closed create (`incomplete-org-blocks-create`,
 * which would otherwise be a permanent creation lockout on a device whose
 * half-built organization can never be completed): removes the incomplete
 * organization's slot projects, so creation can restart fresh. The
 * organization state itself is derived from the project list, so leaving the
 * slot projects IS clearing it.
 *
 * Finding 1: a slot project is only removed when this device can PROVE it
 * created it — the project's creator role (`$getOwnRole`), which core
 * resolves locally from core ownership (the creator's auth core IS the
 * project key), so it is durable on the creating device and can never be
 * held by a device that joined. "No other member visible" alone proves
 * nothing: a project joined moments ago whose roles doc has not synced yet
 * looks memberless, and deleting it would destroy a shared project. A slot
 * whose provenance cannot be established is SKIPPED — neither removed nor
 * left behind silently — and reported in `skipped`, so the UI can say why
 * the discard did not finish and the organization stays on the device.
 *
 * Because the reads above take real time over IPC while sync runs, each
 * leave is revalidated immediately before it: the organization must still be
 * incomplete and the project still memberless (both re-read), or the slot is
 * skipped with the same reporting (TOCTOU).
 *
 * A read failure (IPC, storage) is not a skip — it throws, since an
 * unclassifiable project must fail closed just as loudly.
 */
export async function discardIncompleteOrganization(
  manager: DiscardableManagerLike,
  opts: {organizationId: string},
): Promise<DiscardResult> {
  if (!ORGANIZATION_ID_PATTERN.test(opts.organizationId)) {
    throw new OrganizationOperationError(
      'invalid-organization-id',
      `organization id ${opts.organizationId} must be 16 lowercase hex chars`,
      {organizationId: opts.organizationId},
    );
  }

  const localOrgs = reconstructOrganizations(await manager.listProjects());
  const org = localOrgs.find(o => o.organizationId === opts.organizationId);
  // Fail closed (SPEC 10): only a HALF-BUILT organization may be discarded —
  // never a ready one, never an invalid one (a duplicate-slot conflict needs
  // human diagnosis, and leaving one project would pick a winner
  // arbitrarily), never one that does not exist.
  if (org === undefined || org.state !== 'incomplete') {
    const observed = org?.state ?? 'absent';
    throw new OrganizationOperationError(
      'organization-not-incomplete',
      `organization ${opts.organizationId} is ${observed}; only an incomplete organization can be discarded`,
      {organizationId: opts.organizationId},
    );
  }

  const ownDeviceId = (await manager.getDeviceInfo()).deviceId;
  const hasOtherMembers = (members: Array<{deviceId: string}>) =>
    members.some(member => member.deviceId !== ownDeviceId);

  const removed: DiscardResult['removed'] = [];
  const skipped: DiscardResult['skipped'] = [];
  for (const slot of SLOTS) {
    const projectId = org.slots[slot];
    if (projectId === undefined) continue; // nothing built for this slot
    const project = await manager.getProject(projectId);

    // Creation provenance first: without durable proof this device created
    // the project, nothing else about it matters — it is not ours to delete.
    const {roleId} = await project.$getOwnRole();
    if (roleId !== CREATOR_ROLE_ID) {
      skipped.push({slot, projectId, reason: 'not-created-here'});
      continue;
    }

    const members = await project.$member.getMany();
    if (hasOtherMembers(members)) {
      skipped.push({slot, projectId, reason: 'shared-with-other-devices'});
      continue;
    }

    // Revalidation, immediately before the destructive call (TOCTOU): the
    // reads above are not instantaneous, and sync does not pause for them.
    const fresh = reconstructOrganizations(await manager.listProjects()).find(
      o => o.organizationId === opts.organizationId,
    );
    if (fresh === undefined || fresh.state !== 'incomplete') {
      skipped.push({slot, projectId, reason: 'no-longer-incomplete'});
      continue;
    }
    if (hasOtherMembers(await project.$member.getMany())) {
      skipped.push({slot, projectId, reason: 'shared-with-other-devices'});
      continue;
    }

    await manager.leaveProject(projectId);
    removed.push({slot, projectId});
  }
  return {ok: skipped.length === 0, removed, skipped};
}

/**
 * SPEC 8.2: "Entrar na organização" = accept only the slots not yet local,
 * validating EVERY invite for BOTH slots up front — the first accept happens
 * only after all validation passed, so a bad slot can never leave a
 * half-accepted bundle behind.
 */
export async function acceptOrganizationBundle(
  manager: ManagerLike,
  bundle: {invites: Partial<Record<Slot, InviteLike>>},
  opts?: {
    persistedIdentity?: {invitorDeviceId: string; roleName: string};
  },
): Promise<Array<{slot: Slot; projectId: string}>> {
  const localOrgs = reconstructOrganizations(await manager.listProjects());

  // --- Preflight: all validation, no mutation. ---

  // Every invite must carry a valid marker for the SAME organization, marked
  // for the slot it fills, and still be pending (SPEC 8.2).
  let bundleOrgId: string | undefined;
  for (const slot of SLOTS) {
    const invite = bundle.invites[slot];
    if (!invite) continue;
    const marker = parseMarker(invite.projectDescription ?? '');
    if (!marker) {
      throw new OrganizationOperationError(
        'invite-unmarked',
        `slot ${slot} invite has no valid organization marker`,
        {slot},
      );
    }
    if (bundleOrgId === undefined) bundleOrgId = marker.organizationId;
    if (marker.organizationId !== bundleOrgId) {
      throw new OrganizationOperationError(
        'bundle-inconsistent',
        `slot ${slot} invite is for organization ${marker.organizationId}, not the bundle organization ${bundleOrgId}`,
        {slot, organizationId: marker.organizationId},
      );
    }
    if (marker.slot !== slot) {
      throw new OrganizationOperationError(
        'slot-mismatch',
        `invite for slot ${slot} is marked as slot ${marker.slot}`,
        {slot},
      );
    }
    if (invite.state !== 'pending') {
      throw new OrganizationOperationError(
        'invite-not-pending',
        `slot ${slot} invite is ${invite.state}, not pending`,
        {slot},
      );
    }
  }

  if (bundleOrgId === undefined) {
    throw new OrganizationOperationError(
      'bundle-inconsistent',
      'bundle has no invites',
    );
  }

  // One invitor and one non-empty role across the bundle (SPEC 8.5 / 13 Q3).
  const invitesInBundle = SLOTS.map(slot => bundle.invites[slot]).filter(
    (invite): invite is InviteLike => invite !== undefined,
  );
  const bundleInvitor = invitesInBundle[0]!.invitorDeviceId;
  const bundleRoleName = invitesInBundle[0]!.roleName;
  if (!bundleRoleName) {
    throw new OrganizationOperationError(
      'bundle-inconsistent',
      'bundle invites carry no role name',
    );
  }
  if (
    invitesInBundle.some(
      invite =>
        invite.invitorDeviceId !== bundleInvitor ||
        invite.roleName !== bundleRoleName,
    )
  ) {
    throw new OrganizationOperationError(
      'bundle-inconsistent',
      `bundle invites diverge in invitor or role (${bundleInvitor}, ${bundleRoleName})`,
    );
  }

  // The organization this accept completes: the local org with the bundle's
  // id when it exists; otherwise a NEW-organization join, allowed only when
  // no local organization is incomplete or invalid — an incomplete org's gap
  // must never be filled by another organization's invite, and an invalid
  // one must never be extended (spike guard, SPEC 1.3/10).
  const localOrg = localOrgs.find(org => org.organizationId === bundleOrgId);
  if (localOrg?.state === 'invalid') {
    throw new OrganizationOperationError(
      'invalid-local-state',
      `local organization ${bundleOrgId} is invalid (${localOrg.reason}); refusing to modify it`,
      {organizationId: bundleOrgId},
    );
  }
  if (!localOrg) {
    // An unsupported marker (SPEC 10.1) is a diagnostic for a malformed
    // project, not an organization whose gap a foreign invite could fill —
    // it must not block a new-organization join.
    const blocking = localOrgs.find(
      org =>
        (org.state === 'invalid' && org.reason !== 'unsupported-marker') ||
        org.state === 'incomplete',
    );
    if (blocking) {
      throw new OrganizationOperationError(
        'foreign-organization',
        `bundle is for organization ${bundleOrgId}, not the local organization ${blocking.organizationId} (${blocking.state})`,
        {organizationId: bundleOrgId},
      );
    }
  }

  const localSlots = localOrg?.slots ?? {};

  // Recovery validation (docs/OrgLayerSpike.md finding 6): a bundle that is
  // not full — some slot has no invite, e.g. a post-interruption recovery —
  // was not pinned by groupPendingInvites to one inviter and one role, so it
  // REQUIRES the identity persisted at the first accept and every present
  // invite is validated against it.
  const isPartialBundle = SLOTS.some(
    slot => bundle.invites[slot] === undefined,
  );
  if (isPartialBundle && !opts?.persistedIdentity) {
    throw new OrganizationOperationError(
      'identity-required',
      'a partial bundle requires the persisted organization identity for recovery',
    );
  }
  if (isPartialBundle && opts?.persistedIdentity) {
    for (const slot of SLOTS) {
      const invite = bundle.invites[slot];
      if (!invite) continue;
      if (
        invite.invitorDeviceId !== opts.persistedIdentity.invitorDeviceId ||
        invite.roleName !== opts.persistedIdentity.roleName
      ) {
        throw new OrganizationOperationError(
          'identity-mismatch',
          `slot ${slot} invite identity (${invite.invitorDeviceId}, ${String(invite.roleName)}) does not match the persisted organization identity (${opts.persistedIdentity.invitorDeviceId}, ${opts.persistedIdentity.roleName})`,
          {slot},
        );
      }
    }
  }

  // Slot completeness is validated in the preflight too: every slot missing
  // locally must have an invite, so the accept loop can never surface a
  // missing-invite failure after some slots were already accepted.
  for (const slot of SLOTS) {
    if (localSlots[slot] === undefined && bundle.invites[slot] === undefined) {
      throw new OrganizationOperationError(
        'missing-invite',
        `slot ${slot} is missing locally and has no invite`,
        {slot},
      );
    }
  }

  // --- Accept loop: all validation passed. ---
  const accepted: Array<{slot: Slot; projectId: string}> = [];
  for (const slot of SLOTS) {
    if (localSlots[slot] !== undefined) continue; // never re-accept a present slot
    // The preflight slot-completeness check guarantees an invite exists.
    const invite = bundle.invites[slot]!;
    try {
      const projectId = await manager.invite.accept({
        inviteId: invite.inviteId,
      });
      accepted.push({slot, projectId});
    } catch (e) {
      // Reject-but-completed (Bug 46): the sync/IPC timeout can reject the
      // call while core completed the join, so the local read decides — a
      // slot that is now local counts as accepted and the loop goes on to
      // the remaining slots (aborting here would leave the organization
      // half-joined behind a false error, its missing slot's invite still
      // pending); a slot that is still missing rethrows the original error,
      // so a genuine failure is never masked by the recovery read.
      let joinedProjectId: string | undefined;
      try {
        joinedProjectId = reconstructOrganizations(
          await manager.listProjects(),
        ).find(org => org.organizationId === bundleOrgId)?.slots[slot];
      } catch {
        joinedProjectId = undefined;
      }
      if (joinedProjectId === undefined) {
        throw markAcceptOrigin(normalizeAcceptFailure(e));
      }
      accepted.push({slot, projectId: joinedProjectId});
    }
  }
  return accepted;
}

/**
 * SPEC 4.4: renaming the Organization is an org-level action that rewrites
 * the marker in every EXISTING slot (marker-preserving fan-out — only the
 * name segment of `projectDescription` changes; every other settings field
 * is written back unchanged). A slot with no invite/local project is
 * skipped; a slot whose marker does not match the organization and slot it
 * fills — lost, foreign, or swapped (P6 Q1) — is an error thrown in a
 * preflight BEFORE any write: renaming must never silently auto-repair a
 * degraded organization (SPEC 19). Slots are
 * rewritten sequentially and the first failure aborts the rest; re-running
 * is safe because the marker rewrite is idempotent.
 */
/**
 * A ManagerLike whose `getProject` exposes the settings write needed by
 * `renameOrganization`. Declared with `Omit` (not an inline intersection of
 * the whole manager) so the widened `getProject` return is not shadowed by
 * the narrower base declaration at call sites.
 */
export type RenamableManagerLike = Omit<ManagerLike, 'getProject'> & {
  getProject(projectId: string): Promise<
    ProjectLike & {
      $setProjectSettings(settings: {
        name?: string;
        projectDescription?: string;
      }): Promise<unknown>;
    }
  >;
};

export async function renameOrganization(
  manager: RenamableManagerLike,
  opts: {
    organizationId: string;
    newName: string;
    slots: Partial<Record<Slot, string>>;
  },
): Promise<void> {
  if (opts.newName.trim().length === 0) {
    throw new OrganizationOperationError(
      'empty-name',
      'organization name must not be empty or whitespace',
    );
  }
  if (!ORGANIZATION_ID_PATTERN.test(opts.organizationId)) {
    throw new OrganizationOperationError(
      'invalid-organization-id',
      `organization id ${opts.organizationId} must be 16 lowercase hex chars`,
      {organizationId: opts.organizationId},
    );
  }

  // Preflight: read and validate the marker identity of EVERY existing slot
  // BEFORE any write (P6 Q1) — a lost, wrong-organization, or wrong-slot
  // marker (swapped or foreign project ids handed in `slots`) aborts the
  // fan-out with nothing rewritten.
  const writes: Array<{
    slot: Slot;
    project: Awaited<ReturnType<RenamableManagerLike['getProject']>>;
    settings: {name?: string; projectDescription?: string};
  }> = [];
  for (const slot of SLOTS) {
    const projectId = opts.slots[slot];
    if (projectId === undefined) continue; // skip a slot that is not local

    const project = await manager.getProject(projectId);
    const settings = await project.$getProjectSettings();
    const marker = parseMarker(settings.projectDescription ?? '');
    if (!marker) {
      throw new OrganizationOperationError(
        'invalid-local-state',
        `slot ${slot} (${projectId}) holds no valid organization marker; renaming would not rewrite it`,
        {slot, organizationId: opts.organizationId},
      );
    }
    if (marker.organizationId !== opts.organizationId) {
      throw new OrganizationOperationError(
        'invalid-local-state',
        `slot ${slot} (${projectId}) is marked for organization ${marker.organizationId}, not ${opts.organizationId}`,
        {slot, organizationId: opts.organizationId},
      );
    }
    if (marker.slot !== slot) {
      throw new OrganizationOperationError(
        'slot-mismatch',
        `slot ${slot} (${projectId}) holds a marker for slot ${marker.slot}`,
        {slot},
      );
    }
    writes.push({slot, project, settings});
  }

  // All validation passed — rewrite sequentially, first failure aborts the
  // rest; re-running is safe because the marker rewrite is idempotent.
  for (const {slot, project, settings} of writes) {
    await project.$setProjectSettings({
      ...settings,
      projectDescription: markerFor(opts.organizationId, slot, opts.newName),
    });
  }
}
