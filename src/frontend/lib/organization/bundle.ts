import {
  isReservedMarker,
  parseMarker,
  SLOTS,
  type OrgMarker,
  type Slot,
} from './marker';

/**
 * SPEC 6.5: group a device's invites into Organization bundles. Input shape
 * mirrors `InviteApi.Invite` from @comapeo/core (structural — no core import,
 * so this module stays node-safe for integration tests).
 */
export type InviteLike = {
  inviteId: string;
  projectDescription?: string;
  invitorDeviceId: string;
  roleName?: string;
  receivedAt: number;
  /**
   * Real `Invite['state']` from @comapeo/core 7.4 (invite-state-machine) —
   * `ExtractStateString` flattens nested states to the TOP-LEVEL name:
   * 'pending' | 'canceled' | 'responding' | 'respondedAlready' | 'joined' |
   * 'rejected' | 'error' | 'joining'
   */
  state: string;
};

export type OrganizationInviteBundle = {
  organizationId: string;
  organizationName: string | undefined;
  invitorDeviceId: string;
  roleName: string;
  /** At most one invite per slot (duplicates collapsed). */
  invites: Partial<Record<Slot, InviteLike>>;
  /** Every invite id in the group — representatives AND duplicates. */
  allInviteIds: string[];
  completeness: 'complete' | 'incomplete-transient' | 'incomplete-definitive';
};

/**
 * States after which an invite can never become pending again (SPEC 8.5):
 * the slot is definitively lost for this bundle round. In-flight states
 * ('responding', 'joining') stay transient — the accept may still land.
 */
export const INVITE_TERMINAL_STATES: readonly string[] = [
  'joined',
  'rejected',
  'canceled',
  'error',
  'respondedAlready',
];

/** Newest receivedAt wins; a tie breaks toward the larger inviteId. */
function isNewer(a: InviteLike, b: InviteLike): boolean {
  return (
    a.receivedAt > b.receivedAt ||
    (a.receivedAt === b.receivedAt && a.inviteId > b.inviteId)
  );
}

/** SPEC 8.5: group invites into validated Organization bundles. */
export function groupPendingInvites(invites: ReadonlyArray<InviteLike>): {
  bundles: OrganizationInviteBundle[];
  unmarked: InviteLike[];
  /** Descriptions that CLAIM the marker namespace but do not parse (10.1). */
  reserved: InviteLike[];
} {
  const unmarked: InviteLike[] = [];
  const reserved: InviteLike[] = [];
  /** (organizationId, invitorDeviceId) → invites in arrival order. */
  const groups = new Map<
    string,
    Array<{invite: InviteLike; marker: OrgMarker}>
  >();

  for (const invite of invites) {
    const description = invite.projectDescription ?? '';
    const marker = parseMarker(description);
    if (!marker) {
      // A reserved-but-unparseable marker is a different failure than a
      // plain description: it must not vanish into the generic unmarked
      // bucket (SPEC 10.1 fail-closed).
      if (isReservedMarker(description)) reserved.push(invite);
      else unmarked.push(invite);
      continue;
    }
    const key = `${marker.organizationId}:${invite.invitorDeviceId}`;
    const group = groups.get(key) ?? [];
    group.push({invite, marker});
    groups.set(key, group);
  }

  const bundles: OrganizationInviteBundle[] = [];
  for (const group of groups.values()) {
    // Collapse duplicate invites per slot, WITHIN a role (SPEC 13 Q3): a
    // role-blind collapse let a newer Participant invite evict the older
    // Coordinator one for the same slot, and the surviving pair then failed
    // the role-consistency check below — hiding a joinable Coordinator
    // bundle. The representative is chosen among PENDING entries only: a
    // newer canceled/rejected duplicate must never hide an older
    // still-pending invite. Non-pending entries are consulted solely to
    // classify a missing slot as definitive.
    const pendingRepsByRole = new Map<
      string,
      Map<Slot, {invite: InviteLike; marker: OrgMarker}>
    >();
    for (const entry of group) {
      if (entry.invite.state !== 'pending') continue;
      // A role-less invite keeps a partition of its own instead of joining
      // another role's: it has no authoritative role tying it to anything,
      // but it still makes the group role-inconsistent.
      const roleKey = entry.invite.roleName ?? '';
      const pendingReps =
        pendingRepsByRole.get(roleKey) ??
        new Map<Slot, {invite: InviteLike; marker: OrgMarker}>();
      pendingRepsByRole.set(roleKey, pendingReps);
      const pendingIncumbent = pendingReps.get(entry.marker.slot);
      if (!pendingIncumbent || isNewer(entry.invite, pendingIncumbent.invite)) {
        pendingReps.set(entry.marker.slot, entry);
      }
    }

    // A single role keeps the previous semantics (an incomplete bundle is
    // still emitted, transient or definitive). Several roles are reconciled
    // only by a COMPLETE pair: a group covering one slot per role is the
    // role-inconsistent invitation this has always refused to join.
    const roleCandidates = [...pendingRepsByRole.values()];
    const emitted =
      roleCandidates.length <= 1
        ? roleCandidates
        : roleCandidates.filter(reps =>
            SLOTS.every(slot => reps.get(slot) !== undefined),
          );

    for (const pendingReps of emitted) {
      const pending = [...pendingReps.values()];
      if (pending.length === 0) continue; // nothing joinable in this group

      // A non-empty role (SPEC 13 Q3): a role-less pair has no authoritative
      // role tying the invites together. Sameness across the slots is
      // guaranteed by the partition they were collapsed in.
      const roleName = pending[0]!.invite.roleName;
      if (!roleName) continue;

      const organizationId = pending[0]!.marker.organizationId;
      const invitorDeviceId = pending[0]!.invite.invitorDeviceId;
      const invites: Partial<Record<Slot, InviteLike>> = {};
      for (const entry of pending) invites[entry.marker.slot] = entry.invite;
      // Role-filtered, so declining THIS bundle never rejects the same
      // inviter's invites for another role.
      const allInviteIds = group
        .filter(entry => entry.invite.roleName === roleName)
        .map(entry => entry.invite.inviteId);

      const missingSlots = SLOTS.filter(slot => !invites[slot]);
      let completeness: OrganizationInviteBundle['completeness'];
      if (missingSlots.length === 0) {
        completeness = 'complete';
      } else {
        // Definitive only when EVERY invite grouped for the missing slot is
        // in a terminal state — a single in-flight or non-representative
        // entry keeps the slot transient (the accept may still land).
        completeness = missingSlots.every(slot => {
          const entriesForSlot = group.filter(
            entry => entry.marker.slot === slot,
          );
          return (
            entriesForSlot.length > 0 &&
            entriesForSlot.every(entry =>
              INVITE_TERMINAL_STATES.includes(entry.invite.state),
            )
          );
        })
          ? 'incomplete-definitive'
          : 'incomplete-transient';
      }

      bundles.push({
        organizationId,
        organizationName:
          pendingReps.get('m')?.marker.organizationName ??
          pendingReps.get('a')?.marker.organizationName,
        invitorDeviceId,
        roleName,
        invites,
        allInviteIds,
        completeness,
      });
    }
  }

  bundles.sort((a, b) => a.organizationId.localeCompare(b.organizationId));
  return {bundles, unmarked, reserved};
}

/** Find the Organization bundle that an invite id belongs to. */
export function bundleForInvite(
  bundles: ReadonlyArray<OrganizationInviteBundle>,
  inviteId: string,
): OrganizationInviteBundle | undefined {
  return bundles.find(bundle => bundle.allInviteIds.includes(inviteId));
}
