import {markerFor, parseMarker, SLOT_PROJECT_NAMES} from './marker';
import {reconstructOrganizations} from './reconstruct';
import {
  acceptOrganizationBundle,
  createOrganization,
  renameOrganization,
  OrganizationOperationError,
  type ManagerLike,
  type OrganizationErrorCode,
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

type FakeManager = ManagerLike & {
  projects: Array<{
    projectId: string;
    projectDescription?: string;
    status: 'joined' | 'joining' | 'left';
  }>;
  acceptedInviteIds: string[];
};

/** In-memory ManagerLike — no @comapeo/core import. */
function createFakeManager(): FakeManager {
  let projectCounter = 0;
  const projects: FakeManager['projects'] = [];
  const acceptedInviteIds: string[] = [];
  return {
    projects,
    acceptedInviteIds,
    async listProjects() {
      return [...projects];
    },
    async createProject(opts) {
      const projectId = `p-${++projectCounter}`;
      projects.push({
        projectId,
        projectDescription: opts.projectDescription,
        status: 'joined',
      });
      return projectId;
    },
    async getProject(projectId) {
      const project = projects.find(p => p.projectId === projectId);
      return {
        async $getProjectSettings() {
          return {projectDescription: project?.projectDescription};
        },
      };
    },
    invite: {
      async accept(invite) {
        acceptedInviteIds.push(invite.inviteId);
        const projectId = `accepted-${invite.inviteId}`;
        projects.push({projectId, status: 'joined'});
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
