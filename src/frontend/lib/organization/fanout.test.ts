import {roles as coreRoles} from '@comapeo/core';

import {markerFor, parseMarker, SLOT_PROJECT_NAMES} from './marker';
import {reconstructOrganizations} from './reconstruct';
import {
  acceptOrganizationBundle,
  createOrganization,
  CREATOR_ROLE_ID,
  discardIncompleteOrganization,
  isAcceptOriginError,
  renameOrganization,
  OrganizationOperationError,
  type ManagerLike,
  type OrganizationErrorCode,
  type ProjectLike,
  type RenamableManagerLike,
} from './fanout';
import type {InviteLike} from './bundle';

/** Assert a rejection carries the typed code (F8) and optional message. */
async function expectOrgError(
  promise: Promise<unknown>,
  code: OrganizationErrorCode,
  message?: RegExp,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(OrganizationOperationError);
  await expect(promise).rejects.toMatchObject({code});
  if (message) await expect(promise).rejects.toThrow(message);
}

const ORG_A = 'a1b2c3d4e5f60718';
const ORG_B = 'ffffffffffffffff';

/** From `@comapeo/core/src/roles.js` — any role that is not the creator's. */
const MEMBER_ROLE_ID = '012fd2d431c0bf60';

test("the organization's creator role id stays pinned to core", () => {
  // Organization activation/materialization consume this exported literal;
  // pin it so role classification cannot drift from core.
  expect(CREATOR_ROLE_ID).toBe(coreRoles.CREATOR_ROLE_ID);
});

type FakeProjectRow = {
  projectId: string;
  projectDescription?: string;
  status: 'joined' | 'joining' | 'left';
};

type FakeManager = Omit<ManagerLike, 'getProject'> & {
  projects: FakeProjectRow[];
  acceptedInviteIds: string[];
  /** Project ids handed to `leaveProject` — the discard's removal call. */
  leftProjectIds: string[];
  /** Project ids handed to a destructive delete primitive, if one is used. */
  deletedProjectIds: string[];
  ownDeviceId: string;
  /**
   * deviceId per project id — ids beyond `ownDeviceId` mean the project has
   * other members. The shared-slot regression records this even though a
   * local discard must not consult it.
   */
  memberIdsByProjectId: Map<string, string[]>;
  /**
   * Creating device per project id — fixture provenance for distinguishing a
   * locally created project from one this device joined.
   */
  createdByByProjectId: Map<string, string>;
  getProject(projectId: string): Promise<
    ProjectLike & {
      // Mirrors `@comapeo/core`'s `MapeoProject.$getOwnRole` / `$member`.
      $getOwnRole(): Promise<{roleId: string}>;
      $member: {getMany(): Promise<Array<{deviceId: string}>>};
    }
  >;
  leaveProject(projectId: string): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
  getDeviceInfo(): {deviceId: string};
};

/** In-memory ManagerLike — no @comapeo/core import. */
function createFakeManager(): FakeManager {
  let projectCounter = 0;
  const projects: FakeProjectRow[] = [];
  const acceptedInviteIds: string[] = [];
  const leftProjectIds: string[] = [];
  const deletedProjectIds: string[] = [];
  const memberIdsByProjectId = new Map<string, string[]>();
  const createdByByProjectId = new Map<string, string>();
  return {
    projects,
    acceptedInviteIds,
    leftProjectIds,
    deletedProjectIds,
    ownDeviceId: 'this-device',
    memberIdsByProjectId,
    createdByByProjectId,
    async listProjects() {
      // Core's default listProjects() excludes rows whose project keys have
      // hasLeftProject set; model that app-facing seam, not includeLeft:true.
      return projects.filter(project => project.status !== 'left');
    },
    async createProject(opts) {
      const projectId = `p-${++projectCounter}`;
      projects.push({
        projectId,
        projectDescription: opts.projectDescription,
        status: 'joined',
      });
      createdByByProjectId.set(projectId, 'this-device');
      return projectId;
    },
    async getProject(projectId) {
      const project = projects.find(p => p.projectId === projectId);
      return {
        async $getProjectSettings() {
          return {projectDescription: project?.projectDescription};
        },
        async $getOwnRole() {
          return {
            roleId:
              createdByByProjectId.get(projectId) === 'this-device'
                ? CREATOR_ROLE_ID
                : MEMBER_ROLE_ID,
          };
        },
        $member: {
          async getMany() {
            const memberIds = memberIdsByProjectId.get(projectId) ?? [
              'this-device',
            ];
            return memberIds.map(deviceId => ({deviceId}));
          },
        },
      };
    },
    async leaveProject(projectId) {
      leftProjectIds.push(projectId);
      const project = projects.find(p => p.projectId === projectId);
      if (project) project.status = 'left';
    },
    async deleteProject(projectId) {
      deletedProjectIds.push(projectId);
      const index = projects.findIndex(p => p.projectId === projectId);
      if (index !== -1) projects.splice(index, 1);
    },
    getDeviceInfo() {
      return {deviceId: 'this-device'};
    },
    invite: {
      async accept(invite) {
        acceptedInviteIds.push(invite.inviteId);
        const projectId = `accepted-${invite.inviteId}`;
        projects.push({projectId, status: 'joined'});
        createdByByProjectId.set(projectId, 'invitor-device');
        return projectId;
      },
    },
  };
}

let nextInviteId = 1;

function invite(
  organizationId: string,
  slot: 'm' | 'a',
  overrides: Partial<InviteLike> = {},
): InviteLike {
  return {
    inviteId: `invite-${nextInviteId++}`,
    projectDescription: markerFor(organizationId, slot, 'Acme'),
    invitorDeviceId: 'invitor-1',
    roleName: 'coordinator',
    receivedAt: nextInviteId,
    state: 'pending',
    ...overrides,
  };
}

describe('createOrganization', () => {
  it('creates both slots with slot project names and markers', async () => {
    const manager = createFakeManager();
    const {projectIds} = await createOrganization(manager, {
      organizationId: ORG_A,
      organizationName: 'Acme',
    });
    expect(projectIds.m).toBeDefined();
    expect(projectIds.a).toBeDefined();
    expect(projectIds.m).not.toBe(projectIds.a);
    expect(manager.projects.map(project => project.projectDescription)).toEqual(
      [markerFor(ORG_A, 'm', 'Acme'), markerFor(ORG_A, 'a', 'Acme')],
    );
  });

  it('resumes an incomplete org by creating only the missing slot', async () => {
    const manager = createFakeManager();
    // An interrupted create left only slot m on the device.
    const mProjectId = await manager.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(ORG_A, 'm', 'Acme'),
    });
    const interrupted = await reconstructOrganizations(
      await manager.listProjects(),
    );
    expect(interrupted[0]!.state).toBe('incomplete');

    const resumed = await createOrganization(manager, {
      organizationId: ORG_A,
      organizationName: 'Acme',
    });
    expect(resumed.projectIds.m).toBe(mProjectId); // m untouched
    expect(resumed.projectIds.a).toBeDefined();
    expect(manager.projects).toHaveLength(2);
  });

  it('is idempotent when the org is already ready', async () => {
    const manager = createFakeManager();
    const first = await createOrganization(manager, {
      organizationId: ORG_A,
      organizationName: 'Acme',
    });
    const second = await createOrganization(manager, {
      organizationId: ORG_A,
      organizationName: 'Acme',
    });
    expect(second.projectIds).toEqual(first.projectIds);
    expect(manager.projects).toHaveLength(2);
  });

  it('throws on an empty or whitespace-only organization name', async () => {
    const manager = createFakeManager();
    await expectOrgError(
      createOrganization(manager, {
        organizationId: ORG_A,
        organizationName: '',
      }),
      'empty-name',
    );
    await expectOrgError(
      createOrganization(manager, {
        organizationId: ORG_A,
        organizationName: '   ',
      }),
      'empty-name',
    );
    expect(manager.projects).toHaveLength(0);
  });

  it('throws on a malformed organization id before creating anything', async () => {
    const manager = createFakeManager();
    await expectOrgError(
      createOrganization(manager, {
        organizationId: 'not-hex',
        organizationName: 'Acme',
      }),
      'invalid-organization-id',
    );
    expect(manager.projects).toHaveLength(0);
  });

  it('fails closed when the org reconstructs as invalid (duplicate slot)', async () => {
    const manager = createFakeManager();
    await manager.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(ORG_A, 'm', 'Acme'),
    });
    await manager.createProject({
      name: 'Monitoramento (duplicado)',
      projectDescription: markerFor(ORG_A, 'm', 'Acme'),
    });
    await expectOrgError(
      createOrganization(manager, {
        organizationId: ORG_A,
        organizationName: 'Acme',
      }),
      'invalid-local-state',
      /invalid \(duplicate-slot\)/,
    );
    expect(manager.projects).toHaveLength(2); // nothing created
  });

  it('refuses to create a NEW organization while an incomplete one sits on the device', async () => {
    // The Bug 46 trigger: a create whose slot write mutates-then-rejects loses
    // its organization id on restart/remount, and a fresh create minted a
    // whole SECOND organization (2× Monitoramento, 2× Alertas) next to the
    // half-provisioned one. Failing closed leaves the repair to the
    // provisioning screen, which retries under the reconstructed id.
    const manager = createFakeManager();
    await manager.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(ORG_A, 'm', 'Acme'),
    });

    const error = await createOrganization(manager, {
      organizationId: ORG_B,
      organizationName: 'Outra',
    }).then(
      () => undefined,
      e => e,
    );

    expect(error).toBeInstanceOf(OrganizationOperationError);
    expect(error).toMatchObject({
      code: 'incomplete-org-blocks-create',
      // `organizationId` names the BLOCKING org — the one a consumer resumes
      // or discards; the refused create's id rides along separately.
      details: {
        organizationId: ORG_A,
        requestedOrganizationId: ORG_B,
      },
    });
    expect((error as OrganizationOperationError).message).toMatch(
      new RegExp(ORG_A),
    );
    expect(manager.projects).toHaveLength(1); // nothing created
  });

  it('still resumes the incomplete organization when the requested id matches it', async () => {
    // Regression guard: the block only covers a create whose id does not
    // match the incomplete org — the recovery path (SPEC 5 / E7) keeps
    // completing the missing slots of the org it names.
    const manager = createFakeManager();
    const mProjectId = await manager.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(ORG_A, 'm', 'Acme'),
    });

    const resumed = await createOrganization(manager, {
      organizationId: ORG_A,
      organizationName: 'Acme',
    });
    expect(resumed.projectIds.m).toBe(mProjectId);
    expect(resumed.projectIds.a).toBeDefined();
    expect(manager.projects).toHaveLength(2);
  });

  it('still creates a second organization when every local organization is ready', async () => {
    // The block is about INCOMPLETE state, not about multi-organization
    // devices (SPEC 1.3): a ready org never blocks a create.
    const manager = createFakeManager();
    await createOrganization(manager, {
      organizationId: ORG_A,
      organizationName: 'Acme',
    });

    const second = await createOrganization(manager, {
      organizationId: ORG_B,
      organizationName: 'Outra',
    });
    expect(second.projectIds.m).toBeDefined();
    expect(second.projectIds.a).toBeDefined();
    expect(manager.projects).toHaveLength(4);
  });

  it('a create whose slot write mutates then rejects resumes without duplicates on retry', async () => {
    // The real reject-but-completed shape (Bug 46): createProject's reply
    // times out while core committed the project. A retry under the SAME
    // organization id must reuse the committed slot, never mint a duplicate.
    const manager = createFakeManager();
    const createProject = manager.createProject.bind(manager);
    let createCalls = 0;
    manager.createProject = async opts => {
      createCalls += 1;
      if (createCalls === 1) {
        await createProject(opts); // core commits…
        throw new Error('SYNC_TIMEOUT'); // …then the reply dies
      }
      return createProject(opts);
    };

    await expect(
      createOrganization(manager, {
        organizationId: ORG_A,
        organizationName: 'Acme',
      }),
    ).rejects.toThrow('SYNC_TIMEOUT');
    expect(manager.projects).toHaveLength(1);

    const resumed = await createOrganization(manager, {
      organizationId: ORG_A,
      organizationName: 'Acme',
    });
    expect(resumed.projectIds.m).toBe(manager.projects[0]!.projectId);
    expect(manager.projects).toHaveLength(2);
    const slots = manager.projects
      .map(project => parseMarker(project.projectDescription ?? '')?.slot)
      .sort();
    expect(slots).toEqual(['a', 'm']);
  });
});

describe('discardIncompleteOrganization', () => {
  /** Seeds a half-built organization holding only slot m; returns its id. */
  async function seedIncompleteOrg(
    manager: FakeManager,
    organizationId: string = ORG_A,
  ): Promise<string> {
    return manager.createProject({
      name: SLOT_PROJECT_NAMES.m,
      projectDescription: markerFor(organizationId, 'm', 'Acme'),
    });
  }

  it('leaves the solo slot projects it created and the organization disappears', async () => {
    const manager = createFakeManager();
    const mProjectId = await seedIncompleteOrg(manager);

    const result = await discardIncompleteOrganization(manager, {
      organizationId: ORG_A,
    });

    expect(result).toEqual({
      ok: true,
      removed: [{slot: 'm', projectId: mProjectId}],
      skipped: [],
    });
    expect(manager.leftProjectIds).toEqual([mProjectId]);
    expect(
      await reconstructOrganizations(await manager.listProjects()),
    ).toEqual([]);
  });

  /**
   * Seeds the end state of a partially accepted bundle: slot m joined from
   * `invitor-device` (a member of it), slot a never accepted. Returns m's id.
   */
  function seedJoinedSlot(
    manager: FakeManager,
    organizationId: string = ORG_A,
  ): string {
    const projectId = 'joined-m';
    manager.projects.push({
      projectId,
      projectDescription: markerFor(organizationId, 'm', 'Acme'),
      status: 'joined',
    });
    manager.createdByByProjectId.set(projectId, 'invitor-device');
    manager.memberIdsByProjectId.set(projectId, [
      manager.ownDeviceId,
      'invitor-device',
    ]);
    return projectId;
  }

  it('leaves a slot project this device joined, even before its roles doc has synced', async () => {
    // A joined slot is not this device's to delete, but it is its to LEAVE:
    // core's leave assigns this device the left role and clears only this
    // device's copy, so the creator's project and data survive. Provenance
    // gates deleting a project others may depend on, never leaving one.
    const manager = createFakeManager();
    const joinedProjectId = 'joined-1';
    manager.projects.push({
      projectId: joinedProjectId,
      projectDescription: markerFor(ORG_A, 'm', 'Acme'),
      status: 'joined',
    });
    manager.createdByByProjectId.set(joinedProjectId, 'invitor-device');
    // Membership alone looks solo: the roles doc has not synced.
    manager.memberIdsByProjectId.set(joinedProjectId, [manager.ownDeviceId]);

    const result = await discardIncompleteOrganization(manager, {
      organizationId: ORG_A,
    });

    expect(result).toEqual({
      ok: true,
      removed: [{slot: 'm', projectId: joinedProjectId}],
      skipped: [],
    });
    expect(manager.leftProjectIds).toEqual([joinedProjectId]);
    expect(
      await reconstructOrganizations(await manager.listProjects()),
    ).toEqual([]);
  });

  it('leaves the joined slot of a partially accepted bundle, although its invitor is a member', async () => {
    // A bundle whose first accept joined and whose second failed stays
    // incomplete with a JOINED slot. If that setup can never be finished
    // (the invitor is gone, the invite cancelled), the discard is the only
    // way out — so the joined slot is left, not kept.
    const manager = createFakeManager();
    const joinedProjectId = seedJoinedSlot(manager);

    const result = await discardIncompleteOrganization(manager, {
      organizationId: ORG_A,
    });

    expect(result).toEqual({
      ok: true,
      removed: [{slot: 'm', projectId: joinedProjectId}],
      skipped: [],
    });
    expect(manager.leftProjectIds).toEqual([joinedProjectId]);
    expect(
      await reconstructOrganizations(await manager.listProjects()),
    ).toEqual([]);
  });

  it('keeps recovery metadata relevant while another slot invite is still joining', async () => {
    const manager = createFakeManager();
    const joinedProjectId = seedJoinedSlot(manager);
    const joiningProjectId = 'joining-a';
    manager.projects.push({
      projectId: joiningProjectId,
      projectDescription: markerFor(ORG_A, 'a', 'Acme'),
      status: 'joining',
    });

    const result = await discardIncompleteOrganization(manager, {
      organizationId: ORG_A,
    });

    expect(result).toEqual({
      ok: false,
      removed: [{slot: 'm', projectId: joinedProjectId}],
      skipped: [
        {slot: 'a', projectId: joiningProjectId, reason: 'join-pending'},
      ],
    });
    expect(manager.leftProjectIds).toEqual([joinedProjectId]);
    expect(manager.projects).toContainEqual({
      projectId: joiningProjectId,
      projectDescription: markerFor(ORG_A, 'a', 'Acme'),
      status: 'joining',
    });
  });

  it('keeps recovery metadata when a pending slot joins during the final scan', async () => {
    const manager = createFakeManager();
    const joinedProjectId = seedJoinedSlot(manager);
    const joiningProjectId = 'joining-a';
    manager.projects.push({
      projectId: joiningProjectId,
      projectDescription: markerFor(ORG_A, 'a', 'Acme'),
      status: 'joining',
    });
    const baseListProjects = manager.listProjects.bind(manager);
    let listReads = 0;
    manager.listProjects = async () => {
      listReads += 1;
      if (listReads === 3) {
        const joiningProject = manager.projects.find(
          project => project.projectId === joiningProjectId,
        );
        if (joiningProject) joiningProject.status = 'joined';
      }
      return baseListProjects();
    };

    const result = await discardIncompleteOrganization(manager, {
      organizationId: ORG_A,
    });

    expect(result).toEqual({
      ok: false,
      removed: [{slot: 'm', projectId: joinedProjectId}],
      skipped: [
        {
          slot: 'a',
          projectId: joiningProjectId,
          reason: 'no-longer-incomplete',
        },
      ],
    });
    expect(listReads).toBe(3);
  });

  it('unblocks creating a fresh organization after discarding a partially accepted bundle', async () => {
    const manager = createFakeManager();
    seedJoinedSlot(manager);
    await expectOrgError(
      createOrganization(manager, {
        organizationId: ORG_B,
        organizationName: 'Outra',
      }),
      'incomplete-org-blocks-create',
    );

    await discardIncompleteOrganization(manager, {organizationId: ORG_A});

    const fresh = await createOrganization(manager, {
      organizationId: ORG_B,
      organizationName: 'Outra',
    });
    expect(fresh.projectIds.m).toBeDefined();
    expect(fresh.projectIds.a).toBeDefined();
  });

  it.each([
    ['created', (manager: FakeManager) => seedIncompleteOrg(manager)],
    ['joined', async (manager: FakeManager) => seedJoinedSlot(manager)],
  ])(
    'skips a %s slot whose project is replaced right before the leave',
    async (_origin, seed) => {
      // TOCTOU: the organization can stay incomplete while the SLOT changes
      // hands — the state alone would let the discard leave a project that
      // no longer is the slot, and still report the setup as gone.
      const manager = createFakeManager();
      const originalProjectId = await seed(manager);
      const baseListProjects = manager.listProjects.bind(manager);
      let listReads = 0;
      manager.listProjects = async () => {
        listReads += 1;
        if (listReads === 2) {
          const index = manager.projects.findIndex(
            p => p.projectId === originalProjectId,
          );
          manager.projects.splice(index, 1, {
            projectId: 'replacement-m',
            projectDescription: markerFor(ORG_A, 'm', 'Acme'),
            status: 'joined',
          });
        }
        return baseListProjects();
      };

      const result = await discardIncompleteOrganization(manager, {
        organizationId: ORG_A,
      });

      expect(result).toEqual({
        ok: false,
        removed: [],
        skipped: [
          {
            slot: 'm',
            projectId: originalProjectId,
            reason: 'no-longer-incomplete',
          },
          {
            slot: 'm',
            projectId: 'replacement-m',
            reason: 'no-longer-incomplete',
          },
        ],
      });
      expect(manager.leftProjectIds).toEqual([]);
    },
  );

  it('counts a leave that rejects after core already left the project as removed, without leaving again', async () => {
    // Core's leave marks the project left and drops its settings BEFORE it
    // waits for the role change to sync, so a sync timeout rejects a leave
    // that already happened — and the project is gone from listProjects().
    const manager = createFakeManager();
    const joinedProjectId = seedJoinedSlot(manager);
    const baseLeaveProject = manager.leaveProject.bind(manager);
    let leaveCalls = 0;
    manager.leaveProject = async projectId => {
      leaveCalls += 1;
      await baseLeaveProject(projectId);
      throw new Error('SYNC_TIMEOUT');
    };

    const result = await discardIncompleteOrganization(manager, {
      organizationId: ORG_A,
    });

    expect(result).toEqual({
      ok: true,
      removed: [{slot: 'm', projectId: joinedProjectId}],
      skipped: [],
    });
    expect(leaveCalls).toBe(1);
    expect(
      await reconstructOrganizations(await manager.listProjects()),
    ).toEqual([]);
  });

  it('rethrows a leave that rejected without leaving, and a retry completes', async () => {
    const manager = createFakeManager();
    const joinedProjectId = seedJoinedSlot(manager);
    const baseLeaveProject = manager.leaveProject.bind(manager);
    manager.leaveProject = async () => {
      throw new Error('IPC_GONE');
    };

    await expect(
      discardIncompleteOrganization(manager, {organizationId: ORG_A}),
    ).rejects.toThrow('IPC_GONE');
    const orgs = await reconstructOrganizations(await manager.listProjects());
    expect(orgs).toHaveLength(1); // the organization is still on the device
    expect(orgs[0]).toMatchObject({state: 'incomplete', organizationId: ORG_A});

    manager.leaveProject = baseLeaveProject;
    await expect(
      discardIncompleteOrganization(manager, {organizationId: ORG_A}),
    ).resolves.toEqual({
      ok: true,
      removed: [{slot: 'm', projectId: joinedProjectId}],
      skipped: [],
    });
  });

  it('preserves the original leave error when reconciliation cannot list projects', async () => {
    const manager = createFakeManager();
    seedJoinedSlot(manager);
    const leaveError = new Error('IPC_GONE');
    const listError = new Error('LIST_PROJECTS_GONE');
    const baseListProjects = manager.listProjects.bind(manager);
    let listReads = 0;
    manager.listProjects = async () => {
      listReads += 1;
      if (listReads === 3) throw listError;
      return baseListProjects();
    };
    manager.leaveProject = async () => {
      throw leaveError;
    };

    await expect(
      discardIncompleteOrganization(manager, {organizationId: ORG_A}),
    ).rejects.toBe(leaveError);
  });

  it('leaves the sole surviving created slot when another member has joined, without deleting it', async () => {
    // Ordinary dead-end: this coordinator created both slots, another member
    // joined m, then this device used the normal leave flow on a. The local
    // organization reconstructs as incomplete with only the shared m slot.
    const manager = createFakeManager();
    const {projectIds} = await createOrganization(manager, {
      organizationId: ORG_A,
      organizationName: 'Acme',
    });
    const mProjectId = projectIds.m;
    manager.memberIdsByProjectId.set(mProjectId, [
      manager.ownDeviceId,
      'other-member',
    ]);
    await manager.leaveProject(projectIds.a);
    manager.leftProjectIds.length = 0;

    const result = await discardIncompleteOrganization(manager, {
      organizationId: ORG_A,
    });

    expect(result).toEqual({
      ok: true,
      removed: [{slot: 'm', projectId: mProjectId}],
      skipped: [],
    });
    expect(manager.leftProjectIds).toEqual([mProjectId]);
    expect(manager.deletedProjectIds).toEqual([]);
    expect(
      await reconstructOrganizations(await manager.listProjects()),
    ).toEqual([]);
  });

  it('leaves a created project even if reading its shared membership would fail', async () => {
    // Membership cannot block this local-only leave. In particular, discard
    // must not depend on a membership read that can race or fail over IPC.
    const manager = createFakeManager();
    const mProjectId = await seedIncompleteOrg(manager);
    const baseGetProject = manager.getProject.bind(manager);
    let memberReads = 0;
    manager.getProject = async projectId => {
      const project = await baseGetProject(projectId);
      return {
        ...project,
        $member: {
          async getMany() {
            memberReads += 1;
            throw new Error('MEMBERSHIP_UNAVAILABLE');
          },
        },
      };
    };

    const result = await discardIncompleteOrganization(manager, {
      organizationId: ORG_A,
    });

    expect(memberReads).toBe(0);
    expect(result).toEqual({
      ok: true,
      removed: [{slot: 'm', projectId: mProjectId}],
      skipped: [],
    });
    expect(manager.leftProjectIds).toEqual([mProjectId]);
    expect(manager.deletedProjectIds).toEqual([]);
  });

  it('re-reads the organization right before the leave and skips it once it is no longer incomplete', async () => {
    // TOCTOU: the missing slot can arrive (an invite accepted, sync landing)
    // between the initial read and the leave. A READY organization must never
    // be torn down, however incomplete it looked a moment ago.
    const manager = createFakeManager();
    const mProjectId = await seedIncompleteOrg(manager);
    const baseListProjects = manager.listProjects.bind(manager);
    let listReads = 0;
    manager.listProjects = async () => {
      listReads += 1;
      if (listReads === 2) {
        // The concurrent join lands at the discard's revalidation read.
        if (!manager.projects.some(p => p.projectId === 'project-a-joined')) {
          manager.projects.push({
            projectId: 'project-a-joined',
            projectDescription: markerFor(ORG_A, 'a', 'Acme'),
            status: 'joined',
          });
          manager.createdByByProjectId.set(
            'project-a-joined',
            'invitor-device',
          );
        }
      }
      return baseListProjects();
    };

    const result = await discardIncompleteOrganization(manager, {
      organizationId: ORG_A,
    });

    expect(result).toEqual({
      ok: false,
      removed: [],
      skipped: [
        {slot: 'm', projectId: mProjectId, reason: 'no-longer-incomplete'},
        {
          slot: 'a',
          projectId: 'project-a-joined',
          reason: 'no-longer-incomplete',
        },
      ],
    });
    expect(manager.leftProjectIds).toEqual([]);
  });

  it('unblocks creating a fresh organization afterwards', async () => {
    // The escape hatch this function exists for: the fail-closed create
    // (`incomplete-org-blocks-create`) must not be a permanent lockout.
    const manager = createFakeManager();
    await seedIncompleteOrg(manager);

    await discardIncompleteOrganization(manager, {organizationId: ORG_A});

    const fresh = await createOrganization(manager, {
      organizationId: ORG_B,
      organizationName: 'Outra',
    });
    expect(fresh.projectIds.m).toBeDefined();
    expect(fresh.projectIds.a).toBeDefined();
  });

  it('refuses to discard a ready organization', async () => {
    const manager = createFakeManager();
    await createOrganization(manager, {
      organizationId: ORG_A,
      organizationName: 'Acme',
    });

    await expectOrgError(
      discardIncompleteOrganization(manager, {organizationId: ORG_A}),
      'organization-not-incomplete',
      /is ready/,
    );
    expect(manager.leftProjectIds).toEqual([]);
    expect(manager.projects).toHaveLength(2); // untouched
  });

  it('refuses an organization id that is not on the device', async () => {
    const manager = createFakeManager();

    await expectOrgError(
      discardIncompleteOrganization(manager, {organizationId: ORG_A}),
      'organization-not-incomplete',
      /is absent/,
    );
    expect(manager.leftProjectIds).toEqual([]);
  });

  it('refuses to discard an invalid organization', async () => {
    // A duplicate-slot conflict needs human diagnosis (SPEC 10) — silently
    // leaving one of its projects would pick a winner arbitrarily.
    const manager = createFakeManager();
    await manager.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(ORG_A, 'm', 'Acme'),
    });
    await manager.createProject({
      name: 'Monitoramento (duplicado)',
      projectDescription: markerFor(ORG_A, 'm', 'Acme'),
    });

    await expectOrgError(
      discardIncompleteOrganization(manager, {organizationId: ORG_A}),
      'organization-not-incomplete',
      /is invalid/,
    );
    expect(manager.leftProjectIds).toEqual([]);
  });

  it('removes only the named organization and leaves others untouched', async () => {
    const manager = createFakeManager();
    // The ready org first: the incomplete one blocks any create done after.
    await createOrganization(manager, {
      organizationId: ORG_B,
      organizationName: 'Outra',
    });
    const mProjectId = await seedIncompleteOrg(manager, ORG_A);

    const result = await discardIncompleteOrganization(manager, {
      organizationId: ORG_A,
    });

    expect(result.removed).toEqual([{slot: 'm', projectId: mProjectId}]);
    expect(manager.leftProjectIds).toEqual([mProjectId]);
    const orgs = await reconstructOrganizations(await manager.listProjects());
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({state: 'ready', organizationId: ORG_B});
  });

  it('rejects a malformed organization id', async () => {
    const manager = createFakeManager();
    await seedIncompleteOrg(manager);

    await expectOrgError(
      discardIncompleteOrganization(manager, {organizationId: 'nothex'}),
      'invalid-organization-id',
    );
    expect(manager.leftProjectIds).toEqual([]);
  });
});

describe('acceptOrganizationBundle', () => {
  it('accepts only the slot missing locally, skipping the present one', async () => {
    const manager = createFakeManager();
    await manager.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(ORG_A, 'm', 'Acme'),
    });
    const accepted = await acceptOrganizationBundle(manager, {
      invites: {
        m: invite(ORG_A, 'm'),
        a: invite(ORG_A, 'a'),
      },
    });
    expect(accepted.map(entry => entry.slot)).toEqual(['a']);
    expect(manager.acceptedInviteIds).toHaveLength(1);
  });

  it('accepts both slots on a device with no organization yet', async () => {
    const manager = createFakeManager();
    const accepted = await acceptOrganizationBundle(manager, {
      invites: {m: invite(ORG_A, 'm'), a: invite(ORG_A, 'a')},
    });
    expect(accepted.map(entry => entry.slot)).toEqual(['m', 'a']);
  });

  it('accepts a full bundle for a NEW organization when local orgs are all ready', async () => {
    // Multi-organization join (SPEC 1.3/10): a ready local org does not block
    // joining a second organization — the old find(...'s org) ?? localOrgs[0]
    // fallback did.
    const manager = createFakeManager();
    const first = await createOrganization(manager, {
      organizationId: ORG_A,
      organizationName: 'Acme',
    });
    const accepted = await acceptOrganizationBundle(manager, {
      invites: {m: invite(ORG_B, 'm'), a: invite(ORG_B, 'a')},
    });
    expect(accepted.map(entry => entry.slot)).toEqual(['m', 'a']);
    expect(manager.acceptedInviteIds).toHaveLength(2);
    // Org A untouched: still exactly its two original slot projects.
    const orgs = await reconstructOrganizations(await manager.listProjects());
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.organizationId).toBe(ORG_A);
    expect(orgs[0]!.state).toBe('ready');
    expect(orgs[0]!.slots).toEqual(first.projectIds);
  });

  it('throws foreign-organization when the bundle targets an unknown org while a local org is incomplete', async () => {
    const manager = createFakeManager();
    await manager.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(ORG_A, 'm', 'Acme'),
    });
    await expectOrgError(
      acceptOrganizationBundle(manager, {invites: {a: invite(ORG_B, 'a')}}),
      'foreign-organization',
      /not the local organization/,
    );
    expect(manager.acceptedInviteIds).toEqual([]);
  });

  it('throws when an invite is marked for a different slot than the one filled', async () => {
    const manager = createFakeManager();
    await manager.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(ORG_A, 'm', 'Acme'),
    });
    await expectOrgError(
      acceptOrganizationBundle(manager, {invites: {a: invite(ORG_A, 'm')}}),
      'slot-mismatch',
      /invite for slot a is marked as slot m/,
    );
    expect(manager.acceptedInviteIds).toEqual([]);
  });

  it('throws when the bundle mixes two organizations', async () => {
    const manager = createFakeManager();
    await expectOrgError(
      acceptOrganizationBundle(manager, {
        invites: {m: invite(ORG_A, 'm'), a: invite(ORG_B, 'a')},
      }),
      'bundle-inconsistent',
    );
    expect(manager.acceptedInviteIds).toEqual([]);
  });

  it('throws when the bundle mixes invitors or role names', async () => {
    const manager = createFakeManager();
    await expectOrgError(
      acceptOrganizationBundle(manager, {
        invites: {
          m: invite(ORG_A, 'm'),
          a: invite(ORG_A, 'a', {invitorDeviceId: 'invitor-2'}),
        },
      }),
      'bundle-inconsistent',
    );
    expect(manager.acceptedInviteIds).toEqual([]);
  });

  it('throws when an invite is not pending', async () => {
    const manager = createFakeManager();
    await expectOrgError(
      acceptOrganizationBundle(manager, {
        invites: {
          m: invite(ORG_A, 'm'),
          a: invite(ORG_A, 'a', {state: 'canceled'}),
        },
      }),
      'invite-not-pending',
    );
    expect(manager.acceptedInviteIds).toEqual([]);
  });

  it('requires a persisted identity for a partial bundle', async () => {
    const manager = createFakeManager();
    await manager.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(ORG_A, 'm', 'Acme'),
    });
    await expectOrgError(
      acceptOrganizationBundle(manager, {invites: {a: invite(ORG_A, 'a')}}),
      'identity-required',
    );
    expect(manager.acceptedInviteIds).toEqual([]);
  });

  it('throws naming the slot when a missing slot has no invite', async () => {
    const manager = createFakeManager();
    await manager.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(ORG_A, 'm', 'Acme'),
    });
    await expectOrgError(
      acceptOrganizationBundle(
        manager,
        {invites: {m: invite(ORG_A, 'm')}},
        {
          persistedIdentity: {
            invitorDeviceId: 'invitor-1',
            roleName: 'coordinator',
          },
        },
      ),
      'missing-invite',
      /slot a is missing locally and has no invite/,
    );
    expect(manager.acceptedInviteIds).toEqual([]);
  });

  it('rejects a recovery bundle whose invite identity diverges from the persisted one', async () => {
    const manager = createFakeManager();
    await manager.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(ORG_A, 'm', 'Acme'),
    });
    await expectOrgError(
      acceptOrganizationBundle(
        manager,
        {invites: {a: invite(ORG_A, 'a', {invitorDeviceId: 'invitor-evil'})}},
        {
          persistedIdentity: {
            invitorDeviceId: 'invitor-1',
            roleName: 'coordinator',
          },
        },
      ),
      'identity-mismatch',
      /does not match the persisted organization identity/,
    );
    expect(manager.acceptedInviteIds).toEqual([]);
  });

  it('accepts a recovery bundle whose invite identity matches the persisted one', async () => {
    const manager = createFakeManager();
    await manager.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(ORG_A, 'm', 'Acme'),
    });
    const accepted = await acceptOrganizationBundle(
      manager,
      {invites: {a: invite(ORG_A, 'a')}},
      {
        persistedIdentity: {
          invitorDeviceId: 'invitor-1',
          roleName: 'coordinator',
        },
      },
    );
    expect(accepted.map(entry => entry.slot)).toEqual(['a']);
    expect(manager.acceptedInviteIds).toHaveLength(1);
  });

  it('validates identity on a partial bundle even when a slot is local-free', async () => {
    const manager = createFakeManager();
    await expectOrgError(
      acceptOrganizationBundle(
        manager,
        {invites: {m: invite(ORG_A, 'm', {roleName: 'participant'})}},
        {
          persistedIdentity: {
            invitorDeviceId: 'invitor-1',
            roleName: 'coordinator',
          },
        },
      ),
      'identity-mismatch',
      /does not match the persisted organization identity/,
    );
    expect(manager.acceptedInviteIds).toEqual([]);
  });

  it('throws missing-invite in the preflight, before accepting anything', async () => {
    // G1: zero local slots + a bundle holding only slot m — slot a is missing
    // locally AND has no invite, so the whole accept must abort with zero
    // calls to invite.accept.
    const manager = createFakeManager();
    await expectOrgError(
      acceptOrganizationBundle(
        manager,
        {invites: {m: invite(ORG_A, 'm')}},
        {
          persistedIdentity: {
            invitorDeviceId: 'invitor-1',
            roleName: 'coordinator',
          },
        },
      ),
      'missing-invite',
      /slot a is missing locally and has no invite/,
    );
    expect(manager.acceptedInviteIds).toHaveLength(0); // accept never called
  });

  it('joins a NEW organization even when a malformed project carries an unsupported marker', async () => {
    // G6: an unsupported-marker entry is a diagnostic for a malformed
    // project, not an incomplete organization whose gap a foreign invite
    // could fill — it must not block a new-organization join.
    const manager = createFakeManager();
    await manager.createProject({
      name: 'Quebrado',
      projectDescription: 'coiab-org:v9:junk',
    });
    await createOrganization(manager, {
      organizationId: ORG_A,
      organizationName: 'Acme',
    });
    const orgs = await reconstructOrganizations(await manager.listProjects());
    expect(orgs.find(org => org.state === 'invalid')).toMatchObject({
      reason: 'unsupported-marker',
    });

    const accepted = await acceptOrganizationBundle(manager, {
      invites: {m: invite(ORG_B, 'm'), a: invite(ORG_B, 'a')},
    });
    expect(accepted.map(entry => entry.slot)).toEqual(['m', 'a']);
    expect(manager.acceptedInviteIds).toHaveLength(2);
  });

  it('keeps accepting the remaining slots when an accept rejects after core completed it', async () => {
    // Reject-but-completed (Bug 46): the ~5s sync/IPC timeout rejects the
    // call while core finished the join — the slot is local on the next
    // read. The loop must go on to slot a; aborting would leave the org
    // half-joined behind a false error, with the slot-a invite still pending
    // (the dismiss ↔ navigate freeze).
    const manager = createFakeManager();
    const mInvite = invite(ORG_A, 'm');
    const aInvite = invite(ORG_A, 'a');
    const accept = jest.fn(async ({inviteId}: {inviteId: string}) => {
      if (inviteId === mInvite.inviteId) {
        // Core joins the project, then the reply dies.
        manager.projects.push({
          projectId: 'project-m-joined',
          projectDescription: markerFor(ORG_A, 'm', 'Acme'),
          status: 'joined',
        });
        throw new Error('SYNC_TIMEOUT');
      }
      manager.acceptedInviteIds.push(inviteId);
      manager.projects.push({
        projectId: `accepted-${inviteId}`,
        status: 'joined',
      });
      return `accepted-${inviteId}`;
    });
    manager.invite.accept = accept;

    const accepted = await acceptOrganizationBundle(manager, {
      invites: {m: mInvite, a: aInvite},
    });
    expect(accept).toHaveBeenCalledTimes(2); // slot a was still attempted
    expect(accepted.map(entry => entry.slot)).toEqual(['m', 'a']);
    expect(accepted.find(entry => entry.slot === 'm')!.projectId).toBe(
      'project-m-joined',
    );
  });

  it('rethrows the original error when the rejected accept left no local slot', async () => {
    // The recovery read decides: an accept that genuinely failed (nothing
    // joined) must still surface as a failure — the reject-but-completed
    // recovery must never mask a real one.
    const manager = createFakeManager();
    manager.invite.accept = jest.fn(async () => {
      throw new Error('NETWORK_GONE'); // no mutation at all
    });

    await expect(
      acceptOrganizationBundle(manager, {
        invites: {m: invite(ORG_A, 'm'), a: invite(ORG_A, 'a')},
      }),
    ).rejects.toThrow('NETWORK_GONE');
    expect(manager.invite.accept).toHaveBeenCalledTimes(1); // loop aborted
  });
});

describe('acceptOrganizationBundle error origin', () => {
  it('marks a genuine accept failure as accept-origin', async () => {
    // The hook reconciles local state after a failure ONLY for errors thrown
    // by the invite.accept call itself (the reject-but-completed family) —
    // this is the marker it keys on.
    const manager = createFakeManager();
    const failure = new Error('NETWORK_GONE');
    manager.invite.accept = jest.fn(async () => {
      throw failure; // no mutation at all — the rethrow carries the original
    });

    await expect(
      acceptOrganizationBundle(manager, {
        invites: {m: invite(ORG_A, 'm'), a: invite(ORG_A, 'a')},
      }),
    ).rejects.toThrow('NETWORK_GONE');
    expect(isAcceptOriginError(failure)).toBe(true);
  });

  it('wraps a non-Error accept rejection so reconciliation still recognizes it', async () => {
    // Finding 3: `invite.accept` can reject with a primitive (a string, null)
    // — a WeakSet cannot mark it, and an unmarked failure would skip the
    // hook's reject-but-completed reconciliation entirely. It must come back
    // as an Error carrying the marker, with the original as `cause`.
    for (const rejection of ['SYNC_TIMEOUT', null] as const) {
      const manager = createFakeManager();
      manager.invite.accept = jest.fn(async () => {
        throw rejection;
      });

      const error = await acceptOrganizationBundle(manager, {
        invites: {m: invite(ORG_A, 'm'), a: invite(ORG_A, 'a')},
      }).then(
        () => undefined,
        e => e,
      );

      expect(error).toBeInstanceOf(Error);
      expect(isAcceptOriginError(error)).toBe(true);
      expect((error as Error).message).toContain(String(rejection));
      expect((error as {cause?: unknown}).cause).toBe(rejection);
      // The rethrow still aborts the loop — nothing is masked as a success.
      expect(manager.invite.accept).toHaveBeenCalledTimes(1);
    }
  });

  it('leaves a preflight validation error unmarked', async () => {
    // A preflight error describes a bundle that must not join, however
    // complete the local organization looks — the hook must surface it, so
    // it must never carry the accept-origin marker.
    const manager = createFakeManager();
    // The slot-a invite carries a slot-m marker — rejected in the preflight.
    const error = await acceptOrganizationBundle(manager, {
      invites: {m: invite(ORG_A, 'm'), a: invite(ORG_A, 'm')},
    }).then(
      () => undefined,
      e => e,
    );

    expect(error).toBeInstanceOf(OrganizationOperationError);
    expect(isAcceptOriginError(error)).toBe(false);
    expect(manager.acceptedInviteIds).toEqual([]); // accept never called
  });
});

describe('renameOrganization', () => {
  type StoredSettings = {name?: string; projectDescription?: string};

  type RenamableFakeManager = Omit<FakeManager, 'getProject'> &
    RenamableManagerLike & {
      settings: Map<string, StoredSettings>;
      setSettingsCalls: Array<{projectId: string; settings: StoredSettings}>;
      failSetFor: Set<string>;
    };

  /** FakeManager with writable project settings (SPEC 4.4 rename). */
  function createRenamableFakeManager(): RenamableFakeManager {
    const manager = createFakeManager() as unknown as RenamableFakeManager;
    manager.settings = new Map<string, StoredSettings>();
    manager.setSettingsCalls = [];
    manager.failSetFor = new Set<string>();
    const baseGetProject = manager.getProject.bind(manager);
    manager.getProject = async (projectId: string) => {
      const project = await baseGetProject(projectId);
      return {
        ...project,
        // Settings read from the writable store, seeded by provisionOrg.
        async $getProjectSettings(): Promise<StoredSettings> {
          const stored = manager.settings.get(projectId);
          if (stored) return {...stored};
          return project.$getProjectSettings();
        },
        async $setProjectSettings(settings: StoredSettings) {
          if (manager.failSetFor.has(projectId)) {
            throw new Error(`write failed for ${projectId}`);
          }
          manager.setSettingsCalls.push({projectId, settings});
          const current = manager.settings.get(projectId) ?? {};
          manager.settings.set(projectId, {...current, ...settings});
        },
      };
    };
    return manager;
  }

  async function provisionOrg(manager: RenamableFakeManager) {
    const {projectIds} = await createOrganization(manager, {
      organizationId: ORG_A,
      organizationName: 'Acme',
    });
    for (const [slot, projectId] of Object.entries(projectIds)) {
      manager.settings.set(projectId, {
        name: SLOT_PROJECT_NAMES[slot as 'm' | 'a'],
        projectDescription: markerFor(ORG_A, slot as 'm' | 'a', 'Acme'),
      });
    }
    return projectIds;
  }

  it('rewrites the marker name segment in both slots', async () => {
    const manager = createRenamableFakeManager();
    const {m, a} = await provisionOrg(manager);

    await renameOrganization(manager, {
      organizationId: ORG_A,
      newName: 'Acme Renomeada',
      slots: {m, a},
    });

    expect(parseMarker(manager.settings.get(m)!.projectDescription!)).toEqual({
      organizationId: ORG_A,
      slot: 'm',
      organizationName: 'Acme Renomeada',
    });
    expect(parseMarker(manager.settings.get(a)!.projectDescription!)).toEqual({
      organizationId: ORG_A,
      slot: 'a',
      organizationName: 'Acme Renomeada',
    });
  });

  it('preserves the other settings fields (e.g. name)', async () => {
    const manager = createRenamableFakeManager();
    const {m, a} = await provisionOrg(manager);

    await renameOrganization(manager, {
      organizationId: ORG_A,
      newName: 'Acme Dois',
      slots: {m, a},
    });

    for (const call of manager.setSettingsCalls) {
      expect(call.settings.name).toBe(
        SLOT_PROJECT_NAMES[call.projectId === m ? 'm' : 'a'],
      );
    }
  });

  it('skips a slot that is not local', async () => {
    const manager = createRenamableFakeManager();
    const {m} = await provisionOrg(manager);

    await renameOrganization(manager, {
      organizationId: ORG_A,
      newName: 'Acme Dois',
      slots: {m}, // no slot a locally
    });

    expect(manager.setSettingsCalls).toHaveLength(1);
    expect(manager.setSettingsCalls[0]!.projectId).toBe(m);
  });

  it('is idempotent on re-run', async () => {
    const manager = createRenamableFakeManager();
    const {m, a} = await provisionOrg(manager);
    const opts = {
      organizationId: ORG_A,
      newName: 'Acme Dois',
      slots: {m, a},
    };

    await renameOrganization(manager, opts);
    const firstCalls = manager.setSettingsCalls.length;
    await renameOrganization(manager, opts);

    expect(manager.setSettingsCalls.length).toBe(firstCalls * 2);
    expect(parseMarker(manager.settings.get(m)!.projectDescription!)).toEqual({
      organizationId: ORG_A,
      slot: 'm',
      organizationName: 'Acme Dois',
    });
  });

  it('aborts on the first failing slot and re-runs idempotently', async () => {
    const manager = createRenamableFakeManager();
    const {m, a} = await provisionOrg(manager);
    manager.failSetFor.add(a);

    await expect(
      renameOrganization(manager, {
        organizationId: ORG_A,
        newName: 'Acme Dois',
        slots: {m, a},
      }),
    ).rejects.toBeInstanceOf(Error);
    // Slot m was written before the failure; re-running the rename
    // rewrites it identically (idempotent) and now succeeds for slot a.
    expect(manager.setSettingsCalls).toHaveLength(1);

    manager.failSetFor.clear();
    await renameOrganization(manager, {
      organizationId: ORG_A,
      newName: 'Acme Dois',
      slots: {m, a},
    });
    expect(parseMarker(manager.settings.get(a)!.projectDescription!)).toEqual({
      organizationId: ORG_A,
      slot: 'a',
      organizationName: 'Acme Dois',
    });
  });

  it('refuses to rename a slot that lost its marker (no auto-repair, SPEC 19)', async () => {
    const manager = createRenamableFakeManager();
    const {m, a} = await provisionOrg(manager);
    manager.settings.set(m, {name: 'Monitoramento', projectDescription: ''});

    await expectOrgError(
      renameOrganization(manager, {
        organizationId: ORG_A,
        newName: 'Acme Dois',
        slots: {m, a},
      }),
      'invalid-local-state',
      /holds no valid organization marker/,
    );
    expect(manager.setSettingsCalls).toHaveLength(0);
  });

  it('fails closed before any write when a slot is marked for another organization', async () => {
    const manager = createRenamableFakeManager();
    const {m, a} = await provisionOrg(manager);
    // A foreign organization's marker in slot a — the fan-out must never
    // rewrite it under this organization's id.
    manager.settings.set(a, {
      name: 'Alertas',
      projectDescription: markerFor(ORG_B, 'a', 'Acme'),
    });

    await expectOrgError(
      renameOrganization(manager, {
        organizationId: ORG_A,
        newName: 'Acme Dois',
        slots: {m, a},
      }),
      'invalid-local-state',
      /slot a .* is marked for organization/,
    );
    expect(manager.setSettingsCalls).toHaveLength(0);
  });

  it('fails closed before any write when a slot holds another slot marker', async () => {
    const manager = createRenamableFakeManager();
    const {m, a} = await provisionOrg(manager);
    manager.settings.set(m, {
      name: 'Monitoramento',
      projectDescription: markerFor(ORG_A, 'a', 'Acme'),
    });

    await expectOrgError(
      renameOrganization(manager, {
        organizationId: ORG_A,
        newName: 'Acme Dois',
        slots: {m, a},
      }),
      'slot-mismatch',
      /slot m .* holds a marker for slot a/,
    );
    expect(manager.setSettingsCalls).toHaveLength(0);
  });

  it('fails closed before any write when the slot project ids are swapped', async () => {
    const manager = createRenamableFakeManager();
    const {m, a} = await provisionOrg(manager);

    await expectOrgError(
      renameOrganization(manager, {
        organizationId: ORG_A,
        newName: 'Acme Dois',
        slots: {m: a, a: m},
      }),
      'slot-mismatch',
    );
    expect(manager.setSettingsCalls).toHaveLength(0);
  });

  it('rejects an empty name and a malformed organization id', async () => {
    const manager = createRenamableFakeManager();
    const {m} = await provisionOrg(manager);

    await expectOrgError(
      renameOrganization(manager, {
        organizationId: ORG_A,
        newName: '   ',
        slots: {m},
      }),
      'empty-name',
    );
    await expectOrgError(
      renameOrganization(manager, {
        organizationId: 'nothex',
        newName: 'Acme',
        slots: {m},
      }),
      'invalid-organization-id',
    );
    expect(manager.setSettingsCalls).toHaveLength(0);
  });
});
