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
 *   coiab-org:v1:<organizationId>:<slot>:<name>
 *
 * with slot m (Monitoramento) or a (Alertas) and name = encoded org name —
 * the final marker format implemented by src/frontend/lib/organization.
 *
 * The experiments map 1:1 to the mandatory experiments in
 * docs/specs/SPEC-46-organizacao-camada-produto.md (section 14; the SPEC
 * lands in PR transistir/comapeo-mobile-1#76) and to the open
 * questions in section 13. The verdict lives in docs/OrgLayerSpike.md.
 */
import {MapeoManager, roles} from '@comapeo/core';
import {KeyManager} from '@mapeo/crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import RAM from 'random-access-memory';

import {
  groupPendingInvites,
  type InviteLike,
} from '../../src/frontend/lib/organization/bundle';
import {
  acceptOrganizationBundle,
  createOrganization,
} from '../../src/frontend/lib/organization/fanout';
import {
  markerFor,
  parseMarker,
  type Slot,
} from '../../src/frontend/lib/organization/marker';
import {
  reconstructOrganizations,
  type ReconstructedOrganization,
} from '../../src/frontend/lib/organization/reconstruct';

import {connectPeers, createManager, createTestServer} from './helpers/core';

const {COORDINATOR_ROLE_ID} = roles;

jest.setTimeout(240_000);

// ---------------------------------------------------------------------------
// Organization layer — the product implementation under test
// (src/frontend/lib/organization). Fixed 16-hex ids: the final marker
// format requires [0-9a-f]{16}.
// ---------------------------------------------------------------------------

const ORG_NAME = 'Acme';
const ORG_1 = 'a1b2c3d4e5f60718';
const ORG_2 = 'ffffffffffffffff';

/** Single-org helper: pick the org under test out of the reconstruction. */
function orgById(
  orgs: ReadonlyArray<ReconstructedOrganization>,
  organizationId: string,
): ReconstructedOrganization | undefined {
  return orgs.find(org => org.organizationId === organizationId);
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

/**
 * Wait until a project row reports status 'joined' — the accepted project's
 * settings have replicated. Until then the row is a 'joining' ProjectInfo,
 * which holds no local slot (SPEC 3.10) and is invisible to reconstruction.
 */
async function waitForJoined(
  manager: MapeoManager,
  projectId: string,
): Promise<void> {
  for (let i = 0; i < 240; i++) {
    const joined = (await manager.listProjects()).some(
      project => project.projectId === projectId && project.status === 'joined',
    );
    if (joined) return;
    await new Promise(res => setTimeout(res, 500));
  }
  throw new Error(`timed out waiting for ${projectId} to be 'joined'`);
}

/**
 * Wait until the device's own member record carries a role — role docs
 * replicate asynchronously after an accept, and asserting earlier would
 * compare undefined to undefined.
 */
async function waitForOwnRoleId(
  project: Awaited<ReturnType<MapeoManager['getProject']>>,
  deviceId: string,
): Promise<string> {
  for (let i = 0; i < 240; i++) {
    const members = await project.$member.getMany();
    const me = members.find(member => member.deviceId === deviceId);
    // MemberInfo carries the role object — the id lives at `role.roleId`.
    if (me?.role.roleId) return me.role.roleId;
    await new Promise(res => setTimeout(res, 500));
  }
  throw new Error(`timed out waiting for own member record of ${deviceId}`);
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
      const organizationId = ORG_1;
      const {projectIds} = await createOrganization(managerA, {
        organizationId,
        organizationName: ORG_NAME,
      });
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

      const org = orgById(
        await reconstructOrganizations(await managerB.listProjects()),
        organizationId,
      );
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
      await manager.createProject({
        name: 'Monitoramento',
        projectDescription: markerFor(ORG_1, 'm', ORG_NAME),
      });
      await manager.createProject({name: 'Plain project'});
      const org = orgById(
        await reconstructOrganizations(await manager.listProjects()),
        ORG_1,
      );
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
      const organizationId = ORG_1;
      await createOrganization(manager, {
        organizationId,
        organizationName: ORG_NAME,
      });
      await manager.createProject({
        name: 'Monitoramento (duplicado)',
        projectDescription: markerFor(organizationId, 'm', ORG_NAME),
      });
      const org = orgById(
        await reconstructOrganizations(await manager.listProjects()),
        organizationId,
      );
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

      const organizationId = ORG_1;
      const {projectIds} = await createOrganization(a.manager, {
        organizationId,
        organizationName: ORG_NAME,
      });

      // E4: ONE product action sends BOTH project invites. Fire-and-forget:
      // $member.invite resolves only on the invitee's response, so the
      // rejection handler attaches at creation — a later failure must not
      // leave teardown rejecting these as unhandled promises that drown the
      // original error. The catch RECORDS the slot instead of discarding it:
      // an invite that reached the receiver but failed sender-side must fail
      // the final assertion, not pass silently through Promise.all.
      const inviteFailures: Array<'m' | 'a'> = [];
      const invitePromises = (['m', 'a'] as const).map(slot =>
        sendInvite(projectIds[slot]!, a.manager, b.manager.deviceId).catch(
          () => {
            inviteFailures.push(slot);
          },
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
      const grouped = groupPendingInvites(marked);
      expect(grouped.unmarked).toEqual([]);
      expect(grouped.bundles).toHaveLength(1);
      const bundle = grouped.bundles[0]!;
      expect(bundle.organizationId).toBe(organizationId);
      expect(bundle.invitorDeviceId).toBe(a.manager.deviceId);
      expect(bundle.invites.m).toBeDefined();
      expect(bundle.invites.a).toBeDefined();

      // E5: ONE product action accepts the whole bundle.
      const accepted = await acceptOrganizationBundle(b.manager, bundle);
      expect(accepted).toHaveLength(2);
      await Promise.all(invitePromises);
      expect(inviteFailures).toEqual([]);

      // The accepted rows must reach 'joined' (settings replicated) before
      // reconstruction can see them as local slots.
      await Promise.all(
        accepted.map(entry => waitForJoined(b.manager, entry.projectId)),
      );

      // Post-accept (post-sync) the marker is readable from the receiver's own
      // project settings — the source reconstruction consumes (SPEC E3).
      const orgOnB = orgById(
        await reconstructOrganizations(await b.manager.listProjects()),
        organizationId,
      );
      expect(orgOnB?.state).toBe('ready');
      expect(orgOnB?.organizationId).toBe(organizationId);
      expect(orgOnB?.slots.m).toBe(
        accepted.find(x => x.slot === 'm')!.projectId,
      );
      expect(orgOnB?.slots.a).toBe(
        accepted.find(x => x.slot === 'a')!.projectId,
      );

      // Authoritative role consistency is checked POST-accept, not at
      // grouping: the invite wire message carries roleName only — no roleId —
      // so the receiver cannot compare role ids before accepting (recorded as
      // a spike limitation in docs/OrgLayerSpike.md). What the product layer
      // CAN assert is that its own member record holds the same roleId in
      // both projects after joining.
      const ownRoleIds = await Promise.all(
        (['m', 'a'] as const).map(async slot => {
          const project = await b.manager.getProject(orgOnB!.slots[slot]!);
          return waitForOwnRoleId(project, b.manager.deviceId);
        }),
      );
      expect(ownRoleIds).toEqual([COORDINATOR_ROLE_ID, COORDINATOR_ROLE_ID]);
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

      const organizationId = ORG_1;
      const {projectIds} = await createOrganization(a.manager, {
        organizationId,
        organizationName: ORG_NAME,
      });
      // Fire-and-forget with handlers at creation — same rationale as E3,
      // and the catch records the failing slot for the final assertion.
      const inviteFailures: Array<'m' | 'a'> = [];
      const invitePromises = (['m', 'a'] as const).map(slot =>
        sendInvite(projectIds[slot]!, a.manager, b.manager.deviceId).catch(
          () => {
            inviteFailures.push(slot);
          },
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
      const mProjectId = await b.manager.invite.accept({
        inviteId: marked.find(
          i => parseMarker(i.projectDescription!)!.slot === 'm',
        )!.inviteId,
      });
      // The joined row counts as a slot only once its settings replicated
      // ('joining' → 'joined'); wait so the org is genuinely incomplete.
      await waitForJoined(b.manager, mProjectId);

      const partial = orgById(
        await reconstructOrganizations(await b.manager.listProjects()),
        organizationId,
      );
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

      const localBefore = orgById(
        await reconstructOrganizations(await b.manager.listProjects()),
        organizationId,
      );
      expect(localBefore?.slots.m).toBeDefined();
      // Recovery goes through the real helper — never a direct accept. A
      // partial bundle requires the identity persisted at the first accept;
      // here that is the identity this bundle's invites carry.
      const accepted = await acceptOrganizationBundle(
        b.manager,
        {invites: {a: inviteA}},
        {
          persistedIdentity: {
            invitorDeviceId: a.manager.deviceId,
            roleName: 'coordinator',
          },
        },
      );
      expect(accepted.map(x => x.slot)).toEqual(['a']); // only the missing slot
      await Promise.all(invitePromises);
      expect(inviteFailures).toEqual([]);
      // Wait for the Alertas row to reach 'joined' before expecting 'ready'.
      await waitForJoined(b.manager, accepted[0]!.projectId);

      const complete = orgById(
        await reconstructOrganizations(await b.manager.listProjects()),
        organizationId,
      );
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
      // Interruption after slot m landed: only Monitoramento exists, created
      // directly (the interruption itself is the state under test).
      const organizationId = ORG_1;
      const mProjectId = await a.manager.createProject({
        name: 'Monitoramento',
        projectDescription: markerFor(organizationId, 'm', ORG_NAME),
      });
      const interrupted = orgById(
        await reconstructOrganizations(await a.manager.listProjects()),
        organizationId,
      );
      expect(interrupted?.state).toBe('incomplete');
      expect(interrupted?.organizationId).toBe(organizationId);

      // Resume: complete only the missing slot, under the SAME org id (as
      // reconstruction would supply it after a restart).
      const resumed = await createOrganization(a.manager, {
        organizationId: interrupted!.organizationId,
        organizationName: ORG_NAME,
      });
      expect(resumed.projectIds.m).toBe(mProjectId); // m was not recreated

      const complete = orgById(
        await reconstructOrganizations(await a.manager.listProjects()),
        organizationId,
      );
      expect(complete?.state).toBe('ready');
      expect(complete?.organizationId).toBe(organizationId);
      expect(complete?.slots.m).toBe(mProjectId); // original m, untouched
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
      const org1 = ORG_1;
      const {projectIds: org1Projects} = await createOrganization(a.manager, {
        organizationId: org1,
        organizationName: ORG_NAME,
      });
      void (['m', 'a'] as const).map(slot =>
        sendInvite(org1Projects[slot]!, a.manager, b.manager.deviceId).catch(
          () => undefined,
        ),
      );
      const pending1 = await waitForInvites(
        b.manager,
        invites =>
          invites.filter(
            i =>
              parseMarker(i.projectDescription || '')?.organizationId === org1,
          ).length === 2,
      );
      const org1MProjectId = await b.manager.invite.accept({
        inviteId: pending1.find(
          i => parseMarker(i.projectDescription!)!.slot === 'm',
        )!.inviteId,
      });
      await waitForJoined(b.manager, org1MProjectId);

      // Foreign-org guard: c's org-2 'a' invite must not fill org-1's gap —
      // without the guard it would glue two organizations into one.
      const org2 = ORG_2;
      const {projectIds: org2Projects} = await createOrganization(c.manager, {
        organizationId: org2,
        organizationName: ORG_NAME,
      });
      const foreignInvitePromise = sendInvite(
        org2Projects.a!,
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
                org2,
            ).length >= 1,
        )
      ).find(i => parseMarker(i.projectDescription!)!.organizationId === org2)!;
      await expect(
        acceptOrganizationBundle(b.manager, {invites: {a: foreign}}),
      ).rejects.toThrow(/not the local organization/);

      // Slot guard: an m-marked invite of the SAME organization must not fill
      // the 'a' gap — it would duplicate the other slot while reconstruction
      // stays incomplete.
      const duplicateSlotProject = await a.manager.createProject({
        name: 'Monitoramento (duplicado)',
        projectDescription: markerFor(org1, 'm', ORG_NAME),
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
              i => i.projectDescription === markerFor(org1, 'm', ORG_NAME),
            ).length >= 1,
        )
      ).find(i => i.projectDescription === markerFor(org1, 'm', ORG_NAME))!;
      await expect(
        acceptOrganizationBundle(b.manager, {invites: {a: mismatched}}),
      ).rejects.toThrow(/invite for slot a is marked as slot m/);

      // Both refusals left the partial state untouched: still exactly slot m.
      const still = orgById(
        await reconstructOrganizations(await b.manager.listProjects()),
        org1,
      );
      expect(still?.state).toBe('incomplete');
      expect(Object.keys(still?.slots ?? {})).toEqual(['m']);
      expect(still?.organizationId).toBe(org1);
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

describe('bundle grouping (SPEC 8.5, per-slot collapse)', () => {
  test('duplicate slot invites collapse to the newest; a lone slot stays incomplete', () => {
    // Grouping rule: invites for the SAME slot collapse to the newest
    // receivedAt (tie → larger inviteId), so the bundle never depends on
    // list ordering; a bundle still needs both distinct slots.
    const invite = (slot: Slot, id: string): InviteLike => ({
      inviteId: id,
      projectDescription: `coiab-org:v1:1111111111111111:${slot}:Acme`,
      invitorDeviceId: 'invitor-1',
      roleName: 'coordinator',
      receivedAt: id === 'm-2' ? 2 : 1,
      state: 'pending',
    });

    const duplicated = groupPendingInvites([
      invite('m', 'm-1'),
      invite('m', 'm-2'),
      invite('a', 'a-1'),
    ]);
    expect(duplicated.bundles).toHaveLength(1);
    expect(duplicated.bundles[0]!.completeness).toBe('complete');
    expect(duplicated.bundles[0]!.invites.m!.inviteId).toBe('m-2');

    // The same invites minus the duplicate still group normally.
    const unduplicated = groupPendingInvites([
      invite('m', 'm-1'),
      invite('a', 'a-1'),
    ]);
    expect(unduplicated.bundles).toHaveLength(1);
    expect(unduplicated.bundles[0]!.completeness).toBe('complete');

    // A lone slot groups as an incomplete-transient bundle: joinable, but
    // the product must not treat it as a complete organization invite.
    const lone = groupPendingInvites([invite('a', 'a-1')]);
    expect(lone.bundles).toHaveLength(1);
    expect(lone.bundles[0]!.completeness).toBe('incomplete-transient');
  });

  test('a role-less pair never groups, even though both roles match', () => {
    // `InviteLike` permits `roleName: undefined`; a same-role check without a
    // presence check would accept the pair. SPEC 13 Q3 requires a role name —
    // there is no authoritative role to compare.
    const roleless = (slot: Slot, id: string): InviteLike => ({
      inviteId: id,
      projectDescription: `coiab-org:v1:1111111111111111:${slot}:Acme`,
      invitorDeviceId: 'invitor-1',
      receivedAt: 1,
      state: 'pending',
    });

    expect(
      groupPendingInvites([roleless('m', 'm-1'), roleless('a', 'a-1')]).bundles,
    ).toEqual([]);

    // Presence on only one side still fails the same-role check.
    expect(
      groupPendingInvites([
        {...roleless('m', 'm-1'), roleName: 'coordinator'},
        roleless('a', 'a-1'),
      ]).bundles,
    ).toEqual([]);
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

    // The server hosts BOTH org projects — the cloud default limit is 1,
    // which would reject the second addServerPeer (ServerTooManyProjects).
    // Everything after createManager is INSIDE the try: if createOrganization
    // or createTestServer rejects (partial provisioning, child exits, invalid
    // URL), the already-created manager is still closed below — an unclosed
    // manager can keep Jest alive at exit.
    let closeServer: (() => void) | undefined;
    try {
      const {projectIds} = await createOrganization(a.manager, {
        organizationId: ORG_1,
        organizationName: ORG_NAME,
      });
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
      const {projectIds} = await createOrganization(a.manager, {
        organizationId: ORG_1,
        organizationName: ORG_NAME,
      });
      expect(
        orgById(
          await reconstructOrganizations(await a.manager.listProjects()),
          ORG_1,
        )?.state,
      ).toBe('ready');

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

      const after = orgById(
        await reconstructOrganizations(await a.manager.listProjects()),
        ORG_1,
      );
      expect(after?.state).toBe('incomplete'); // m no longer recognized
      expect(after?.slots.a).toBe(projectIds.a); // a untouched
    } finally {
      await a.manager.close().catch(() => undefined);
    }
  });
});
