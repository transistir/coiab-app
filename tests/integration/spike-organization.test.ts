/**
 * Spike: Organization as a frontend product layer over existing CoMapeo
 * projects (transistir/coiab-app#46).
 *
 * Every test here drives `@comapeo/core` directly (two in-process devices,
 * connected through a real local-peer connection path — explicit
 * `connectLocalPeer`, not mDNS discovery) to
 * prove — or disprove — that an Organization is nothing more than a
 * composition of two ordinary projects correlated by a marker stored in
 * `projectDescription`:
 *
 *   coiab-org:v1:<organizationId>:m   (Monitoramento)
 *   coiab-org:v1:<organizationId>:a   (Alertas)
 *
 * The experiments map 1:1 to the mandatory experiments in
 * docs/specs/SPEC-46-organizacao-camada-produto.md (section 14; the SPEC
 * lands in PR transistir/comapeo-mobile-1#76) and to the open
 * questions in section 13. The verdict lives in docs/OrgLayerSpike.md.
 */
import {MapeoManager, roles} from '@comapeo/core';
import {KeyManager} from '@mapeo/crypto';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import RAM from 'random-access-memory';

import {connectPeers, createManager, createTestServer} from './helpers/core';

const {COORDINATOR_ROLE_ID} = roles;

jest.setTimeout(240_000);

// ---------------------------------------------------------------------------
// Organization layer (the thing the spike exists to validate)
// ---------------------------------------------------------------------------

const MARKER_PREFIX = 'coiab-org:v1:';
type Slot = 'm' | 'a';

type OrgMarker = {organizationId: string; slot: Slot};

function markerFor(organizationId: string, slot: Slot): string {
  return `${MARKER_PREFIX}${organizationId}:${slot}`;
}

/** Strict parse per SPEC 4.1: versioned, unambiguous, rejects junk. */
function parseMarker(description: string): OrgMarker | undefined {
  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const match = new RegExp(`^coiab-org:v1:(${UUID}):([ma])$`).exec(description);
  if (!match) return undefined;
  return {organizationId: match[1]!, slot: match[2]!};
}

type ReconstructedOrg =
  | {state: 'ready'; organizationId: string; slots: Record<Slot, string>}
  | {
      state: 'incomplete';
      organizationId: string;
      slots: Partial<Record<Slot, string>>;
    }
  | {
      // Two local projects claim the same (organization, slot) — e.g. a
      // retried create or a hand-edited marker. Overwriting one id with the
      // other would route product actions to an arbitrary project while
      // reporting the org as fine, so the state is surfaced instead.
      state: 'invalid';
      organizationId: string;
      reason: 'duplicate-slot';
      slots: Partial<Record<Slot, string>>;
    };

/**
 * SPEC section 10: rebuild the Organization from local project state alone.
 * Spike scope: returns the FIRST organization found. SPEC section 10 requires
 * a collection in the product layer (multiple orgs may coexist).
 */
async function reconstructOrganization(
  manager: MapeoManager,
): Promise<ReconstructedOrg | undefined> {
  const projects = await manager.listProjects();
  const byOrg = new Map<string, Partial<Record<Slot, string>>>();
  const orgsWithDuplicateSlot = new Set<string>();

  for (const project of projects) {
    const settings = await (
      await manager.getProject(project.projectId)
    ).$getProjectSettings();
    const marker = parseMarker(settings.projectDescription || '');
    if (!marker) continue;
    const slots = byOrg.get(marker.organizationId) ?? {};
    if (slots[marker.slot] !== undefined) {
      orgsWithDuplicateSlot.add(marker.organizationId);
    }
    slots[marker.slot] = project.projectId;
    byOrg.set(marker.organizationId, slots);
  }

  // First Map entry — arbitrary order. Single-org spike shortcut; the product
  // layer iterates `byOrg` instead (SPEC section 10: a collection, not a
  // singleton).
  const [organizationId, slots] = byOrg.entries().next().value ?? [];
  if (!organizationId) return undefined;
  if (orgsWithDuplicateSlot.has(organizationId)) {
    return {state: 'invalid', organizationId, reason: 'duplicate-slot', slots};
  }
  return slots.m && slots.a
    ? {state: 'ready', organizationId, slots: slots as Record<Slot, string>}
    : {state: 'incomplete', organizationId, slots};
}

/**
 * SPEC 5: "Criar organização" = one product action that provisions both
 * projects. A failure mid-way leaves the org incomplete; recovery is NOT
 * "call again" (that would mint a new organizationId and recreate the
 * completed slot) — the caller resumes with the organizationId it already
 * has, and `reconstructOrganization` is the source of it on restart
 * (demonstrated in the create-side recovery test in E7).
 */
async function createOrganization(
  manager: MapeoManager,
  slotsToCreate: ReadonlyArray<Slot> = ['m', 'a'],
  resumeOrganizationId?: string,
): Promise<{
  organizationId: string;
  projectIds: Partial<Record<Slot, string>>;
}> {
  const organizationId = resumeOrganizationId ?? randomUUID();
  const names: Record<Slot, string> = {m: 'Monitoramento', a: 'Alertas'};
  const projectIds: Partial<Record<Slot, string>> = {};

  for (const slot of slotsToCreate) {
    projectIds[slot] = await manager.createProject({
      name: names[slot],
      projectDescription: markerFor(organizationId, slot),
    });
  }

  return {organizationId, projectIds};
}

/** SPEC 8.5: group pending invites into a validated Organization bundle. */
type InviteLike = {
  inviteId: string;
  projectDescription?: string;
  invitorDeviceId: string;
  roleName?: string;
};

function groupInvitesIntoBundle(invites: ReadonlyArray<InviteLike>):
  | {
      organizationId: string;
      invitorDeviceId: string;
      invites: Record<Slot, InviteLike>;
    }
  | undefined {
  const parsed = invites
    .map(invite => ({
      invite,
      marker: parseMarker(invite.projectDescription || ''),
    }))
    .filter((entry): entry is {invite: InviteLike; marker: OrgMarker} =>
      Boolean(entry.marker),
    );

  const byOrgAndInvitor = new Map<string, typeof parsed>();
  for (const entry of parsed) {
    const key = `${entry.marker.organizationId}:${entry.invite.invitorDeviceId}`;
    const group = byOrgAndInvitor.get(key) ?? [];
    group.push(entry);
    byOrgAndInvitor.set(key, group);
  }

  for (const group of byOrgAndInvitor.values()) {
    // Exactly one invite per slot: duplicates (m, m, a) must NOT group —
    // silently picking one of the duplicate m invites would make the bundle
    // depend on invite ordering.
    if (group.length !== 2) continue;
    const slots = new Set(group.map(e => e.marker.slot));
    if (slots.size !== 2) continue; // need distinct m + a
    const roleNames = new Set(group.map(e => e.invite.roleName));
    // Same role in both invites — and the role name must actually be present:
    // `InviteLike` permits `roleName: undefined`, and a Set of two undefineds
    // has size 1, so without the presence check a role-less pair would group
    // with no authoritative role tying the two invites together (SPEC 13 Q3).
    if (roleNames.size !== 1 || !group[0]!.invite.roleName) continue;
    const {organizationId} = group[0]!.marker;
    const {invitorDeviceId} = group[0]!.invite;
    return {
      organizationId,
      invitorDeviceId,
      invites: Object.fromEntries(
        group.map(e => [e.marker.slot, e.invite]),
      ) as Record<Slot, InviteLike>,
    };
  }
  return undefined;
}

/**
 * SPEC 8.2: "Entrar na organização" = accept only the slots not yet local.
 * `invites` may be partial: after an interrupted accept (E7), the consumed
 * slot's invite is gone and re-inviting it answers ALREADY, so no full
 * two-invite bundle can ever form again — recovery passes just the missing
 * slot's invite and the present slot is skipped by the local check.
 */
async function acceptOrganizationBundle(
  manager: MapeoManager,
  bundle: {invites: Partial<Record<Slot, InviteLike>>},
): Promise<Array<{slot: Slot; projectId: string}>> {
  const local = await reconstructOrganization(manager);
  const alreadyLocal = local?.slots ?? {};
  // Recovery guard: an invite for a missing slot must belong to the SAME
  // organization as the slots already on this device. Without this check a
  // second organization's invite could be accepted into the gap, gluing
  // projects from two organizations into one supposed "org".
  const expectedOrgId = local?.organizationId;
  const accepted: Array<{slot: Slot; projectId: string}> = [];

  for (const slot of ['m', 'a'] as const) {
    if (alreadyLocal[slot]) continue; // never re-accept a present slot
    const invite = bundle.invites[slot];
    if (!invite) {
      throw new Error(`slot ${slot} is missing locally and has no invite`);
    }
    const marker = parseMarker(invite.projectDescription || '');
    if (expectedOrgId && marker?.organizationId !== expectedOrgId) {
      throw new Error(
        `slot ${slot} invite is for organization ${marker?.organizationId ?? '(no marker)'}, not the local organization ${expectedOrgId}`,
      );
    }
    // Partial bundles bypass groupInvitesIntoBundle's per-slot validation, so
    // the slot must be re-checked here: an m-marked invite handed to the 'a'
    // gap would be accepted, reported as slot a, and duplicate the other
    // project while reconstruction stays incomplete.
    if (marker?.slot !== slot) {
      throw new Error(
        `invite for slot ${slot} is marked as slot ${marker?.slot ?? '(no marker)'}`,
      );
    }
    // KNOWN SPIKE LIMITATION (docs/OrgLayerSpike.md): a full bundle is pinned
    // by groupInvitesIntoBundle to one inviter and one role; a recovery
    // bundle carries only the missing slot's invite, and the consumed
    // invite's inviter/role left no local trace — so this path validates
    // organization and slot but cannot re-derive them. The product layer
    // must persist the bundle identity (inviter + role) at invite time and
    // validate against it here.
    const projectId = await manager.invite.accept({inviteId: invite.inviteId});
    accepted.push({slot, projectId});
  }
  return accepted;
}

// ---------------------------------------------------------------------------
// Test device harness
// ---------------------------------------------------------------------------

const COMAPEO_CORE_PKG_FOLDER = path.dirname(
  require.resolve('@comapeo/core/package.json'),
);
const MIGRATIONS = {
  projectMigrationsFolder: path.join(
    COMAPEO_CORE_PKG_FOLDER,
    'drizzle/project',
  ),
  clientMigrationsFolder: path.join(COMAPEO_CORE_PKG_FOLDER, 'drizzle/client'),
};

/** Like the shared createManager, but persisted to a real folder (for E1). */
async function createPersistentManager(
  dir: string,
  name: string,
  rootKey: ReturnType<typeof KeyManager.generateRootKey>,
) {
  fs.mkdirSync(dir, {recursive: true});
  const fastify = Fastify();
  const manager = new MapeoManager({
    // Same rootKey across restarts: the local database is encrypted with it,
    // so a restarted manager with a fresh key cannot read persisted state
    // (verified the hard way — "could not verify data").
    rootKey,
    dbFolder: dir,
    coreStorage: dir,
    ...MIGRATIONS,
    fastify,
  });
  await manager.setDeviceInfo({name, deviceType: 'mobile'});
  return manager;
}

/**
 * Fire-and-forget delivery: resolves `undefined` once the invite is handed
 * off (the invitee observes the response), rejects on delivery failure.
 */
async function sendInvite(
  projectId: string,
  sender: MapeoManager,
  inviteeDeviceId: string,
): Promise<undefined> {
  const project = await sender.getProject(projectId);
  return project.$member
    .invite(inviteeDeviceId, {
      roleId: COORDINATOR_ROLE_ID,
      roleName: 'coordinator',
      initialSyncTimeoutMs: 120_000,
    })
    .then(
      () => undefined, // response handled by the invitee; we only care about delivery
      err => {
        throw err;
      },
    );
}

/** Wait until the invitee's pending invite list satisfies `predicate`. */
async function waitForInvites(
  invitee: MapeoManager,
  predicate: (invites: ReadonlyArray<InviteLike>) => boolean,
): Promise<Array<InviteLike>> {
  for (let i = 0; i < 120; i++) {
    const invites =
      (await invitee.invite.getMany()) as ReadonlyArray<InviteLike>;
    if (predicate(invites)) return [...invites];
    await new Promise(res => setTimeout(res, 500));
  }
  throw new Error('timed out waiting for invites');
}

// ---------------------------------------------------------------------------
// E1 + E2 — create, restart, reconstruct, and use both projects
// ---------------------------------------------------------------------------

describe('E1/E2 — Organization composition survives restart (SPEC 14 E1/E2)', () => {
  test('two marker projects reconstruct as one Organization after manager restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-org-e1-'));
    // One identity across both manager instances — a restart must reuse the
    // device's root key, exactly as the app does.
    const rootKey = KeyManager.generateRootKey();
    const managerA = await createPersistentManager(dir, 'device-a', rootKey);
    // Whichever manager is live when the test ends (A before the restart, B
    // after) is closed in the finally — a failure at any step must not leak
    // the persistent manager or its temp database folder.
    let managerB: MapeoManager | undefined;
    try {
      const {organizationId, projectIds} = await createOrganization(managerA);
      expect(projectIds.m).toBeDefined();
      expect(projectIds.a).toBeDefined();
      expect(projectIds.m).not.toBe(projectIds.a);

      // Restart: brand-new manager instance over the same persisted folders.
      await managerA.close();
      managerB = await createPersistentManager(
        dir,
        'device-a-restarted',
        rootKey,
      );

      const org = await reconstructOrganization(managerB);
      expect(org).toBeDefined();
      expect(org!.state).toBe('ready');
      expect(org!.organizationId).toBe(organizationId);
      expect(org!.slots.m).toBe(projectIds.m);
      expect(org!.slots.a).toBe(projectIds.a);

      // E2: both slots are usable through the plain per-project API, in either
      // order, with no mechanism beyond project ids (activeProjectId is app
      // state; nothing in core needs to change to "switch").
      for (const slot of ['a', 'm'] as const) {
        const project = await managerB.getProject(org!.slots[slot]);
        const settings = await project.$getProjectSettings();
        expect(settings.name).toBe(slot === 'm' ? 'Monitoramento' : 'Alertas');
      }
    } finally {
      await (managerB ?? managerA).close().catch(() => undefined);
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });

  test('a stale or foreign marker never groups into an Organization', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-org-e1b-'));
    const manager = await createPersistentManager(
      dir,
      'device-a',
      KeyManager.generateRootKey(),
    );
    try {
      // Only one slot of an org, plus an unmarked project.
      await createOrganization(manager, ['m']);
      await manager.createProject({name: 'Plain project'});
      const org = await reconstructOrganization(manager);
      expect(org?.state).toBe('incomplete'); // never 'ready' on one slot
      expect(Object.keys(org?.slots ?? {})).toEqual(['m']);
    } finally {
      await manager.close().catch(() => undefined);
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });

  test('two local projects claiming the same slot mark the org invalid, not ready', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-org-e1c-'));
    const manager = await createPersistentManager(
      dir,
      'device-a',
      KeyManager.generateRootKey(),
    );
    try {
      // A retried create (or hand-edited marker) leaves a second project on
      // the same (organization, slot). Reconstruction must surface the
      // conflict — reporting 'ready' with an arbitrarily chosen project id
      // would route product actions to an arbitrary project.
      const {organizationId} = await createOrganization(manager);
      await manager.createProject({
        name: 'Monitoramento (duplicado)',
        projectDescription: markerFor(organizationId, 'm'),
      });
      const org = await reconstructOrganization(manager);
      expect(org?.state).toBe('invalid');
      expect(org?.state === 'invalid' && org.reason).toBe('duplicate-slot');
      expect(org?.organizationId).toBe(organizationId);
    } finally {
      await manager.close().catch(() => undefined);
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });
});

// ---------------------------------------------------------------------------
// E3 + E4 + E5 + Q1–Q4 — full invite round trip between two devices
// ---------------------------------------------------------------------------

describe('E3/E4/E5 — one invite action, one accept action (SPEC 14 E3/E4/E5)', () => {
  test('single Convidar fans out two invites; single Entrar accepts the bundle', async () => {
    const a = await createManager({name: 'sender', deviceType: 'mobile'});
    const b = await createManager({name: 'receiver', deviceType: 'mobile'});
    // connectPeers starts discovery servers; if it (or any assertion below)
    // rejects, the finally must still tear everything down or Jest hangs on
    // the leaked resources (the documented finding-3 failure mode).
    let disconnect: (() => Promise<void>) | undefined;
    try {
      disconnect = await connectPeers([a.manager, b.manager]);

      const {organizationId, projectIds} = await createOrganization(a.manager);

      // E4: ONE product action sends BOTH project invites. Fire-and-forget:
      // $member.invite resolves only on the invitee's response, so the
      // rejection handler attaches at creation — a later failure must not
      // leave teardown rejecting these as unhandled promises that drown the
      // original error.
      const invitePromises = (['m', 'a'] as const).map(slot =>
        sendInvite(projectIds[slot]!, a.manager, b.manager.deviceId).catch(
          () => undefined,
        ),
      );

      // Q1: both invites coexist as pending on the receiver, and Q2: the
      // receiver has the marker *before* accepting (it travels in the invite).
      const pending = await waitForInvites(
        b.manager,
        invites =>
          invites.filter(i => parseMarker(i.projectDescription || ''))
            .length === 2,
      );
      const marked = pending.filter(i => parseMarker(i.projectDescription!));
      expect(marked).toHaveLength(2);

      // Q3: the two invites group deterministically into one bundle.
      const bundle = groupInvitesIntoBundle(marked);
      expect(bundle).toBeDefined();
      expect(bundle!.organizationId).toBe(organizationId);
      expect(bundle!.invitorDeviceId).toBe(a.manager.deviceId);
      expect(bundle!.invites.m).toBeDefined();
      expect(bundle!.invites.a).toBeDefined();

      // E5: ONE product action accepts the whole bundle.
      const accepted = await acceptOrganizationBundle(b.manager, bundle);
      expect(accepted).toHaveLength(2);
      await Promise.all(invitePromises);

      // Post-accept (post-sync) the marker is readable from the receiver's own
      // project settings — the source reconstruction consumes (SPEC E3).
      const orgOnB = await reconstructOrganization(b.manager);
      expect(orgOnB?.state).toBe('ready');
      expect(orgOnB?.organizationId).toBe(organizationId);
      expect(orgOnB?.slots.m).toBe(
        accepted.find(x => x.slot === 'm')!.projectId,
      );
      expect(orgOnB?.slots.a).toBe(
        accepted.find(x => x.slot === 'a')!.projectId,
      );
      // Q6, asserted: the joining journey ends with EXACTLY the two internal
      // projects — nothing else materializes on the receiver.
      expect(await b.manager.listProjects()).toHaveLength(2);
    } finally {
      await disconnect?.();
      await a.manager.close();
      await b.manager.close();
    }
  });
});

// ---------------------------------------------------------------------------
// E7 — partial failure and idempotent retry
// ---------------------------------------------------------------------------

describe('E7 — partial failure recovers without duplicating slots (SPEC 14 E7)', () => {
  test('accepting one slot leaves org incomplete; retry completes only the missing slot', async () => {
    const a = await createManager({name: 'sender', deviceType: 'mobile'});
    const b = await createManager({name: 'receiver', deviceType: 'mobile'});
    let disconnect: (() => Promise<void>) | undefined;
    try {
      disconnect = await connectPeers([a.manager, b.manager]);

      const {organizationId, projectIds} = await createOrganization(a.manager);
      // Fire-and-forget with handlers at creation — same rationale as E3.
      const invitePromises = (['m', 'a'] as const).map(slot =>
        sendInvite(projectIds[slot]!, a.manager, b.manager.deviceId).catch(
          () => undefined,
        ),
      );

      // Partial accept: only Monitoramento lands. The bundle accept is
      // interrupted after its first slot, e.g. app killed mid-flow — simulated
      // with a direct accept because the interruption itself is the state under
      // test, not the product action.
      const pending = await waitForInvites(
        b.manager,
        invites =>
          invites.filter(i => parseMarker(i.projectDescription || ''))
            .length === 2,
      );
      const marked = pending.filter(i => parseMarker(i.projectDescription!));
      await b.manager.invite.accept({
        inviteId: marked.find(
          i => parseMarker(i.projectDescription!)!.slot === 'm',
        )!.inviteId,
      });

      const partial = await reconstructOrganization(b.manager);
      expect(partial?.state).toBe('incomplete'); // never 'ready' prematurely
      expect(Object.keys(partial?.slots ?? {})).toEqual(['m']);

      // Recovery: the m invite was consumed by the partial accept (and
      // re-inviting m answers ALREADY — asserted at the end of this test), so
      // no full two-invite bundle can form again. The still-pending a invite,
      // filtered to the same organization, is what the product flow hands to
      // the SAME bundle-accept helper; its local check skips the present slot.
      const stillPending = await waitForInvites(
        b.manager,
        invites =>
          invites.filter(
            i =>
              parseMarker(i.projectDescription || '')?.slot === 'a' &&
              parseMarker(i.projectDescription!)?.organizationId ===
                organizationId,
          ).length >= 1,
      );
      // Pick the same-organization invite the wait above proved exists — never
      // just any 'a' invite, which on a real device could come from another org.
      const inviteA = stillPending.find(
        i =>
          parseMarker(i.projectDescription || '')?.slot === 'a' &&
          parseMarker(i.projectDescription!)?.organizationId === organizationId,
      )!;

      const localBefore = await reconstructOrganization(b.manager);
      expect(localBefore?.slots.m).toBeDefined();
      // Recovery goes through the real helper — never a direct accept.
      const accepted = await acceptOrganizationBundle(b.manager, {
        invites: {a: inviteA},
      });
      expect(accepted.map(x => x.slot)).toEqual(['a']); // only the missing slot
      await Promise.all(invitePromises);

      const complete = await reconstructOrganization(b.manager);
      expect(complete?.state).toBe('ready');
      expect(complete?.organizationId).toBe(organizationId);
      expect(complete?.slots.m).toBe(localBefore?.slots.m); // not duplicated

      // And re-inviting an already-joined slot is answered ALREADY, not duplicated.
      const again = await (
        await a.manager.getProject(projectIds.m!)
      ).$member.invite(b.manager.deviceId, {
        roleId: COORDINATOR_ROLE_ID,
        roleName: 'coordinator',
      });
      expect(again).toBe('ALREADY');
    } finally {
      await disconnect?.();
      await a.manager.close();
      await b.manager.close();
    }
  });

  test('create-side partial failure resumes in the same organization', async () => {
    // SPEC 5 recovery: if provisioning dies after the first createProject,
    // the completed slot and its marker survive; a plain retry call would
    // mint a new organizationId and duplicate the slot. The caller resumes
    // with the organizationId it already has — on restart, reconstructed
    // from local state.
    const a = await createManager({name: 'creator', deviceType: 'mobile'});
    try {
      // Interruption after slot m landed.
      const {organizationId, projectIds} = await createOrganization(a.manager, [
        'm',
      ]);
      const interrupted = await reconstructOrganization(a.manager);
      expect(interrupted?.state).toBe('incomplete');
      expect(interrupted?.organizationId).toBe(organizationId);

      // Resume: complete only the missing slot, under the SAME org id (as
      // reconstruction would supply it after a restart).
      const resumed = await createOrganization(
        a.manager,
        ['a'],
        interrupted?.organizationId,
      );
      expect(resumed.organizationId).toBe(organizationId);
      expect(resumed.projectIds.m).toBeUndefined(); // m was not recreated

      const complete = await reconstructOrganization(a.manager);
      expect(complete?.state).toBe('ready');
      expect(complete?.organizationId).toBe(organizationId);
      expect(complete?.slots.m).toBe(projectIds.m); // original m, untouched
      expect(complete?.slots.a).toBe(resumed.projectIds.a);
    } finally {
      await a.manager.close().catch(() => undefined);
    }
  });
});

describe('bundle-accept guards — foreign org and slot mismatch are refused', () => {
  test('a foreign-org invite and a wrong-slot invite both throw; nothing is accepted', async () => {
    const a = await createManager({name: 'sender', deviceType: 'mobile'});
    const b = await createManager({name: 'receiver', deviceType: 'mobile'});
    const c = await createManager({name: 'sender-2', deviceType: 'mobile'});
    let disconnect: (() => Promise<void>) | undefined;
    try {
      disconnect = await connectPeers([a.manager, b.manager, c.manager]);

      // b holds a partial org-1 (slot m only) — the state recovery starts from.
      // The invite promises that stay un-accepted never resolve ($member.invite
      // awaits the invitee's response), so each gets its catch at creation —
      // fire-and-forget, never awaited below.
      const org1 = await createOrganization(a.manager);
      void (['m', 'a'] as const).map(slot =>
        sendInvite(org1.projectIds[slot]!, a.manager, b.manager.deviceId).catch(
          () => undefined,
        ),
      );
      const pending1 = await waitForInvites(
        b.manager,
        invites =>
          invites.filter(
            i =>
              parseMarker(i.projectDescription || '')?.organizationId ===
              org1.organizationId,
          ).length === 2,
      );
      await b.manager.invite.accept({
        inviteId: pending1.find(
          i => parseMarker(i.projectDescription!)!.slot === 'm',
        )!.inviteId,
      });

      // Foreign-org guard: c's org-2 'a' invite must not fill org-1's gap —
      // without the guard it would glue two organizations into one.
      const org2 = await createOrganization(c.manager);
      const foreignInvitePromise = sendInvite(
        org2.projectIds.a!,
        c.manager,
        b.manager.deviceId,
      ).catch(() => undefined);
      const foreign = (
        await waitForInvites(
          b.manager,
          invites =>
            invites.filter(
              i =>
                parseMarker(i.projectDescription || '')?.organizationId ===
                org2.organizationId,
            ).length >= 1,
        )
      ).find(
        i =>
          parseMarker(i.projectDescription!)!.organizationId ===
          org2.organizationId,
      )!;
      await expect(
        acceptOrganizationBundle(b.manager, {invites: {a: foreign}}),
      ).rejects.toThrow(/not the local organization/);

      // Slot guard: an m-marked invite of the SAME organization must not fill
      // the 'a' gap — it would duplicate the other slot while reconstruction
      // stays incomplete.
      const duplicateSlotProject = await a.manager.createProject({
        name: 'Monitoramento (duplicado)',
        projectDescription: markerFor(org1.organizationId, 'm'),
      });
      const mismatchInvitePromise = sendInvite(
        duplicateSlotProject,
        a.manager,
        b.manager.deviceId,
      ).catch(() => undefined);
      const mismatched = (
        await waitForInvites(
          b.manager,
          invites =>
            invites.filter(
              i => i.projectDescription === markerFor(org1.organizationId, 'm'),
            ).length >= 1,
        )
      ).find(
        i => i.projectDescription === markerFor(org1.organizationId, 'm'),
      )!;
      await expect(
        acceptOrganizationBundle(b.manager, {invites: {a: mismatched}}),
      ).rejects.toThrow(/invite for slot a is marked as slot m/);

      // Both refusals left the partial state untouched: still exactly slot m.
      const still = await reconstructOrganization(b.manager);
      expect(still?.state).toBe('incomplete');
      expect(Object.keys(still?.slots ?? {})).toEqual(['m']);
      expect(still?.organizationId).toBe(org1.organizationId);
    } finally {
      // A failing .rejects assertion is exactly the regression this test
      // exists to catch — it must not also hang Jest on leaked resources.
      // connectPeers itself is inside the try: if it rejects after starting
      // discovery servers, this finally still closes every manager.
      await disconnect?.();
      await a.manager.close();
      await b.manager.close();
      await c.manager.close();
    }
  });
});

describe('bundle grouping — duplicate slots never group (SPEC 8.5)', () => {
  test('three invites with a duplicated slot are rejected, not deduped', () => {
    // Pure grouping rule: m, m, a with the same org, inviter, and role has
    // two distinct slots but is NOT a valid bundle — accepting it would make
    // the chosen m invite depend on list ordering.
    const invite = (slot: Slot, id: string): InviteLike => ({
      inviteId: id,
      projectDescription: `coiab-org:v1:11111111-1111-1111-1111-111111111111:${slot}`,
      invitorDeviceId: 'invitor-1',
      roleName: 'coordinator',
    });

    expect(
      groupInvitesIntoBundle([
        invite('m', 'm-1'),
        invite('m', 'm-2'),
        invite('a', 'a-1'),
      ]),
    ).toBeUndefined();

    // The same invites minus the duplicate still group normally.
    expect(
      groupInvitesIntoBundle([invite('m', 'm-1'), invite('a', 'a-1')]),
    ).toBeDefined();

    // A lone slot never groups, full stop.
    expect(groupInvitesIntoBundle([invite('a', 'a-1')])).toBeUndefined();
  });

  test('a role-less pair never groups, even though both roles match', () => {
    // `InviteLike` permits `roleName: undefined`; a Set of two undefineds has
    // size 1, so the same-role check alone would accept the pair. SPEC 13 Q3
    // requires a role name — there is no authoritative role to compare.
    const roleless = (slot: Slot, id: string): InviteLike => ({
      inviteId: id,
      projectDescription: `coiab-org:v1:11111111-1111-1111-1111-111111111111:${slot}`,
      invitorDeviceId: 'invitor-1',
    });

    expect(
      groupInvitesIntoBundle([roleless('m', 'm-1'), roleless('a', 'a-1')]),
    ).toBeUndefined();

    // Presence on only one side still fails the same-role check.
    expect(
      groupInvitesIntoBundle([
        {...roleless('m', 'm-1'), roleName: 'coordinator'},
        roleless('a', 'a-1'),
      ]),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// E6 — fresh device has no default project
// ---------------------------------------------------------------------------

describe('E6 — fresh device starts with zero projects (SPEC 14 E6, core half)', () => {
  test('a brand-new manager materializes no personal/default project', async () => {
    const fresh = await createManager({name: 'fresh', deviceType: 'mobile'});
    try {
      expect(await fresh.manager.listProjects()).toEqual([]);
    } finally {
      await fresh.manager.close().catch(() => undefined);
    }
  });
});

// ---------------------------------------------------------------------------
// E8 — Remote Archive as org-level fan-out
// ---------------------------------------------------------------------------

describe('E8 — Remote Archive fans out to both projects (SPEC 14 E8)', () => {
  test('the same archive server is added to both projects via member APIs', async () => {
    const a = await createManager({name: 'coordinator', deviceType: 'mobile'});
    const {projectIds} = await createOrganization(a.manager);

    // The server hosts BOTH org projects — the cloud default limit is 1,
    // which would reject the second addServerPeer (ServerTooManyProjects).
    // The acquisition is INSIDE the try: if createTestServer itself rejects
    // (child exits, invalid URL), the already-created manager is still closed
    // below — an unclosed manager can keep Jest alive at exit.
    let closeServer: (() => void) | undefined;
    try {
      const {serverBaseUrl, close} = await createTestServer({
        allowedProjects: 2,
      });
      closeServer = close;

      // Fan-out: same URL into both projects, no activeProjectId involved.
      // Cleanup runs in finally — a failed addServerPeer or assertion must
      // not leave the manager and cloud child process alive, which stalls
      // Jest.
      for (const slot of ['m', 'a'] as const) {
        const project = await a.manager.getProject(projectIds[slot]!);
        await project.$member.addServerPeer(serverBaseUrl, {
          dangerouslyAllowInsecureConnections: true, // test server is plain http
        });
      }

      // Both projects now list the server as a member with server details.
      for (const slot of ['m', 'a'] as const) {
        const project = await a.manager.getProject(projectIds[slot]!);
        const members = await project.$member.getMany();
        const server = members.find(
          m => 'selfHostedServerDetails' in m && m.selfHostedServerDetails,
        );
        expect(server).toBeDefined();
      }
    } finally {
      closeServer?.();
      await a.manager.close();
    }
  });
});

// ---------------------------------------------------------------------------
// E9 — marker fragility: description edits are an existing hazard
// ---------------------------------------------------------------------------

describe('E9 — a plain description edit destroys the marker (SPEC 15 risk)', () => {
  test('saving EditProjectDetails-style settings orphans the slot from the org', async () => {
    const a = await createManager({name: 'coordinator', deviceType: 'mobile'});
    try {
      const {projectIds} = await createOrganization(a.manager);
      expect((await reconstructOrganization(a.manager))?.state).toBe('ready');

      // Exactly what EditProjectDetails.tsx does on save: the user's text
      // REPLACES projectDescription — marker included. No product guard
      // exists today; the marker has no read-only home.
      const project = await a.manager.getProject(projectIds.m!);
      const settings = await project.$getProjectSettings();
      await project.$setProjectSettings({
        name: settings.name,
        projectColor: settings.projectColor,
        projectDescription: 'Plano de manejo atualizado',
      });

      const after = await reconstructOrganization(a.manager);
      expect(after?.state).toBe('incomplete'); // m no longer recognized
      expect(after?.slots.a).toBe(projectIds.a); // a untouched
    } finally {
      await a.manager.close().catch(() => undefined);
    }
  });
});
