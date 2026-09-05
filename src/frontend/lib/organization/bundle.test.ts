import {bundleForInvite, groupPendingInvites, type InviteLike} from './bundle';
import {markerFor, type Slot} from './marker';

const ORG_ID = 'a1b2c3d4e5f60718';

let nextReceivedAt = 1;

function invite(
  slot: Slot,
  inviteId: string,
  overrides: Partial<InviteLike> = {},
): InviteLike {
  return {
    inviteId,
    projectDescription: markerFor(ORG_ID, slot, 'Acme'),
    invitorDeviceId: 'invitor-1',
    roleName: 'coordinator',
    receivedAt: nextReceivedAt++,
    state: 'pending',
    ...overrides,
  };
}

describe('groupPendingInvites', () => {
  it('groups a complete bundle', () => {
    const m = invite('m', 'm-1');
    const a = invite('a', 'a-1');
    const {bundles, unmarked} = groupPendingInvites([m, a]);
    expect(unmarked).toEqual([]);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toMatchObject({
      organizationId: ORG_ID,
      organizationName: 'Acme',
      invitorDeviceId: 'invitor-1',
      roleName: 'coordinator',
      completeness: 'complete',
    });
    expect(bundles[0]!.invites.m).toBe(m);
    expect(bundles[0]!.invites.a).toBe(a);
  });

  it('is incomplete-transient when a slot has no invite at all', () => {
    const {bundles} = groupPendingInvites([invite('m', 'm-1')]);
    expect(bundles[0]!.completeness).toBe('incomplete-transient');
  });

  it('is incomplete-definitive when the missing slot was rejected, errored, or canceled', () => {
    const {bundles} = groupPendingInvites([
      invite('m', 'm-1'),
      invite('a', 'a-1', {state: 'rejected'}),
    ]);
    expect(bundles[0]!.completeness).toBe('incomplete-definitive');
    expect(bundles[0]!.invites.a).toBeUndefined();
  });

  it('collapses duplicate slot invites: newest receivedAt wins', () => {
    const {bundles} = groupPendingInvites([
      invite('m', 'm-1', {receivedAt: 1}),
      invite('m', 'm-2', {receivedAt: 2}),
      invite('a', 'a-1'),
    ]);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]!.invites.m!.inviteId).toBe('m-2');
  });

  it('collapses duplicate slot invites on a receivedAt tie by larger inviteId', () => {
    const {bundles} = groupPendingInvites([
      invite('m', 'm-1', {receivedAt: 5}),
      invite('m', 'm-2', {receivedAt: 5}),
      invite('a', 'a-1'),
    ]);
    expect(bundles[0]!.invites.m!.inviteId).toBe('m-2');
  });

  it('does not count a non-pending representative as a present slot', () => {
    const {bundles} = groupPendingInvites([
      invite('m', 'm-1'),
      invite('a', 'a-1', {state: 'responding'}),
    ]);
    expect(bundles[0]!.completeness).toBe('incomplete-transient');
  });

  it('does not form a bundle when no representative is pending', () => {
    const {bundles} = groupPendingInvites([
      invite('m', 'm-1', {state: 'joined'}),
      invite('a', 'a-1', {state: 'rejected'}),
    ]);
    expect(bundles).toEqual([]);
  });

  it('keeps an older pending invite when a newer duplicate was canceled', () => {
    // A newer terminal duplicate must not hide the still-pending invite:
    // representatives are picked among PENDING entries only (F1).
    const pendingM = invite('m', 'm-1', {receivedAt: 1});
    const {bundles} = groupPendingInvites([
      pendingM,
      invite('m', 'm-2', {receivedAt: 2, state: 'canceled'}),
      invite('a', 'a-1'),
    ]);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]!.invites.m!.inviteId).toBe('m-1');
    expect(bundles[0]!.completeness).toBe('complete');
  });

  it('classifies a slot whose newest invite is a non-pending non-terminal state as transient', () => {
    const {bundles} = groupPendingInvites([
      invite('m', 'm-1'),
      invite('a', 'a-1', {state: 'joining'}),
    ]);
    expect(bundles[0]!.completeness).toBe('incomplete-transient');
  });

  it('classifies a missing slot as transient when ANY of its invites is in-flight, even a newer terminal one', () => {
    // Definitive classification must consider ALL invites of the missing
    // slot, not only the newest: a newer canceled duplicate does not bury an
    // older still-in-flight accept.
    const {bundles} = groupPendingInvites([
      invite('m', 'm-1'),
      invite('a', 'a-1', {state: 'joining', receivedAt: 1}),
      invite('a', 'a-2', {state: 'canceled', receivedAt: 2}),
    ]);
    expect(bundles[0]!.completeness).toBe('incomplete-transient');
  });

  it('classifies a missing slot as definitive when every invite for it is terminal', () => {
    const {bundles} = groupPendingInvites([
      invite('m', 'm-1'),
      invite('a', 'a-1', {state: 'canceled', receivedAt: 1}),
      invite('a', 'a-2', {state: 'rejected', receivedAt: 2}),
    ]);
    expect(bundles[0]!.completeness).toBe('incomplete-definitive');
  });

  it('keeps invites from different invitors in separate bundles', () => {
    const {bundles} = groupPendingInvites([
      invite('m', 'm-1', {invitorDeviceId: 'invitor-1'}),
      invite('a', 'a-1', {invitorDeviceId: 'invitor-2'}),
    ]);
    expect(bundles).toHaveLength(2);
  });

  it('does not group invites with different role names', () => {
    const {bundles} = groupPendingInvites([
      invite('m', 'm-1', {roleName: 'coordinator'}),
      invite('a', 'a-1', {roleName: 'participant'}),
    ]);
    expect(bundles).toEqual([]);
  });

  it('does not group invites with a missing role name', () => {
    const {bundles} = groupPendingInvites([
      invite('m', 'm-1', {roleName: undefined}),
      invite('a', 'a-1'),
    ]);
    expect(bundles).toEqual([]);
  });

  it('collects unmarked invites separately', () => {
    const plain = invite('m', 'plain', {projectDescription: 'Plano de manejo'});
    const {bundles, unmarked, reserved} = groupPendingInvites([
      plain,
      invite('m', 'm-1'),
      invite('a', 'a-1'),
    ]);
    expect(unmarked).toEqual([plain]);
    expect(reserved).toEqual([]);
    expect(bundles).toHaveLength(1);
  });

  it('routes reserved-but-unparseable markers to reserved, not unmarked', () => {
    // SPEC 10.1 fail-closed: a description claiming the coiab-org namespace
    // that cannot parse is a distinct failure — it must not vanish into the
    // generic unmarked bucket.
    const staleVersion = invite('m', 'rsv-1', {
      projectDescription: `coiab-org:v2:${ORG_ID}:m:Acme`,
    });
    const garbage = invite('a', 'rsv-2', {projectDescription: 'coiab-org:'});
    const {bundles, unmarked, reserved} = groupPendingInvites([
      staleVersion,
      garbage,
    ]);
    expect(reserved).toEqual([staleVersion, garbage]);
    expect(unmarked).toEqual([]);
    expect(bundles).toEqual([]);
  });

  it('sorts bundles by organizationId', () => {
    const other = 'ffffffffffffffff';
    const {bundles} = groupPendingInvites([
      invite('m', 'b-1', {projectDescription: markerFor(other, 'm', 'B')}),
      invite('a', 'a-1', {projectDescription: markerFor(other, 'a', 'B')}),
      invite('m', 'a-m', {projectDescription: markerFor(ORG_ID, 'm', 'Acme')}),
      invite('a', 'a-a', {projectDescription: markerFor(ORG_ID, 'a', 'Acme')}),
    ]);
    expect(bundles.map(bundle => bundle.organizationId)).toEqual([
      ORG_ID,
      other,
    ]);
  });
});

describe('bundleForInvite', () => {
  it('finds the bundle holding an invite id', () => {
    const m = invite('m', 'm-1');
    const a = invite('a', 'a-1');
    const {bundles} = groupPendingInvites([m, a]);
    expect(bundleForInvite(bundles, 'a-1')).toBe(bundles[0]);
    expect(bundleForInvite(bundles, 'nope')).toBeUndefined();
  });

  it('resolves a duplicate invite id that lost the representative race', () => {
    // `m-2` wins the pending representative race, but `m-1` is still an
    // invite of the same group — resolving it must return the bundle. A
    // terminal duplicate of a present slot resolves too.
    const {bundles} = groupPendingInvites([
      invite('m', 'm-1', {receivedAt: 1}),
      invite('m', 'm-2', {receivedAt: 2}),
      invite('a', 'a-0', {receivedAt: 3, state: 'canceled'}),
      invite('a', 'a-1', {receivedAt: 4}),
    ]);
    expect(bundles[0]!.invites.m!.inviteId).toBe('m-2');
    expect(bundleForInvite(bundles, 'm-1')).toBe(bundles[0]);
    expect(bundleForInvite(bundles, 'a-0')).toBe(bundles[0]);
  });

  it('does not resolve a role-inconsistent duplicate to the bundle', () => {
    // A losing duplicate carrying a DIFFERENT role was never part of the
    // role-pinned bundle — resolving it would let an accept validated under
    // another role slip through (SPEC 13 Q3).
    const representative = invite('m', 'm-coord', {
      receivedAt: 2,
      roleName: 'Coordinator',
    });
    const duplicate = invite('m', 'm-part', {
      receivedAt: 1,
      roleName: 'Participant',
    });
    const a = invite('a', 'a-coord', {roleName: 'Coordinator'});
    const {bundles} = groupPendingInvites([representative, duplicate, a]);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]!.roleName).toBe('Coordinator');
    expect(bundleForInvite(bundles, 'm-part')).toBeUndefined();
    expect(bundleForInvite(bundles, 'm-coord')).toBe(bundles[0]);
    expect(bundleForInvite(bundles, 'a-coord')).toBe(bundles[0]);
  });
});
