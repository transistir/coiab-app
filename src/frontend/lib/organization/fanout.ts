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
  | 'incomplete-org-blocks-create';

export class OrganizationOperationError extends Error {
  readonly code: OrganizationErrorCode;
  constructor(
    code: OrganizationErrorCode,
    message: string,
    readonly details?: {
      slot?: Slot;
      organizationId?: string;
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
        {organizationId: opts.organizationId},
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
      if (joinedProjectId === undefined) throw e;
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
