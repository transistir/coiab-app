import {markerFor} from './marker';
import {projectProvenance, reconstructOrganizations} from './reconstruct';

const ORG_A = 'a1b2c3d4e5f60718';
const ORG_B = 'ffffffffffffffff';

describe('reconstructOrganizations', () => {
  it('returns nothing for empty input', () => {
    expect(reconstructOrganizations([])).toEqual([]);
  });

  it('ignores projects without a parseable marker', () => {
    const orgs = reconstructOrganizations([
      {
        projectId: 'p1',
        projectDescription: 'Plano de manejo',
        status: 'joined',
      },
      {projectId: 'p2', status: 'joined'},
    ]);
    expect(orgs).toEqual([]);
  });

  it('reconstructs a ready organization from both slots', () => {
    const orgs = reconstructOrganizations([
      {
        projectId: 'p-m',
        projectDescription: markerFor(ORG_A, 'm', 'Acme'),
        status: 'joined',
      },
      {
        projectId: 'p-a',
        projectDescription: markerFor(ORG_A, 'a', 'Acme'),
        status: 'joined',
      },
    ]);
    expect(orgs).toEqual([
      {
        state: 'ready',
        organizationId: ORG_A,
        organizationName: 'Acme',
        slots: {m: 'p-m', a: 'p-a'},
      },
    ]);
  });

  it('is incomplete with only slot m, and only slot a', () => {
    const onlyM = reconstructOrganizations([
      {
        projectId: 'p-m',
        projectDescription: markerFor(ORG_A, 'm', 'Acme'),
        status: 'joined',
      },
    ]);
    expect(onlyM[0]!.state).toBe('incomplete');
    expect(onlyM[0]!.slots).toEqual({m: 'p-m'});

    const onlyA = reconstructOrganizations([
      {
        projectId: 'p-a',
        projectDescription: markerFor(ORG_A, 'a', 'Acme'),
        status: 'joined',
      },
    ]);
    expect(onlyA[0]!.state).toBe('incomplete');
    expect(onlyA[0]!.slots).toEqual({a: 'p-a'});
  });

  it('does not count a joining or left row as a local slot', () => {
    // SPEC 3.10: a `ProjectInfo` row with status 'joining'/'left' keeps its
    // marker but holds no local slot — it must not fake `ready`.
    const joining = reconstructOrganizations([
      {
        projectId: 'p-m',
        projectDescription: markerFor(ORG_A, 'm', 'Acme'),
        status: 'joined',
      },
      {
        projectId: 'p-a',
        projectDescription: markerFor(ORG_A, 'a', 'Acme'),
        status: 'joining',
      },
    ]);
    expect(joining[0]!.state).toBe('incomplete');
    expect(joining[0]!.slots).toEqual({m: 'p-m'});

    const left = reconstructOrganizations([
      {
        projectId: 'p-m',
        projectDescription: markerFor(ORG_A, 'm', 'Acme'),
        status: 'joined',
      },
      {
        projectId: 'p-a',
        projectDescription: markerFor(ORG_A, 'a', 'Acme'),
        status: 'left',
      },
    ]);
    expect(left[0]!.state).toBe('incomplete');
    expect(left[0]!.slots).toEqual({m: 'p-m'});

    const joined = reconstructOrganizations([
      {
        projectId: 'p-m',
        projectDescription: markerFor(ORG_A, 'm', 'Acme'),
        status: 'joined',
      },
      {
        projectId: 'p-a',
        projectDescription: markerFor(ORG_A, 'a', 'Acme'),
        status: 'joined',
      },
    ]);
    expect(joined[0]!.state).toBe('ready');
    expect(joined[0]!.slots).toEqual({m: 'p-m', a: 'p-a'});
  });

  it('marks an organization invalid when two projects claim one slot', () => {
    const orgs = reconstructOrganizations([
      {
        projectId: 'p-m-1',
        projectDescription: markerFor(ORG_A, 'm', 'Acme'),
        status: 'joined',
      },
      {
        projectId: 'p-m-2',
        projectDescription: markerFor(ORG_A, 'm', 'Acme'),
        status: 'joined',
      },
      {
        projectId: 'p-a',
        projectDescription: markerFor(ORG_A, 'a', 'Acme'),
        status: 'joined',
      },
    ]);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.state).toBe('invalid');
    expect(orgs[0]!.state === 'invalid' && orgs[0]!.reason).toBe(
      'duplicate-slot',
    );
    expect(orgs[0]!.organizationId).toBe(ORG_A);
  });

  it('prefers the slot m name; an a-only org falls back to the a name', () => {
    const diverged = reconstructOrganizations([
      {
        projectId: 'p-m',
        projectDescription: markerFor(ORG_A, 'm', 'Novo nome'),
        status: 'joined',
      },
      {
        projectId: 'p-a',
        projectDescription: markerFor(ORG_A, 'a', 'Nome antigo'),
        status: 'joined',
      },
    ]);
    expect(
      diverged[0]!.state === 'ready' && diverged[0]!.organizationName,
    ).toBe('Novo nome');

    const onlyA = reconstructOrganizations([
      {
        projectId: 'p-a',
        projectDescription: markerFor(ORG_A, 'a', 'Nome antigo'),
        status: 'joined',
      },
    ]);
    expect(onlyA[0]!.state === 'incomplete' && onlyA[0]!.organizationName).toBe(
      'Nome antigo',
    );
  });

  it('surfaces a reserved-but-unparseable marker as an invalid unsupported-marker org', () => {
    // SPEC 10.1 fail-closed: a description claiming the coiab-org namespace
    // that this version cannot parse must stay visible — dropping it would
    // report an internal project as unmarked and fine.
    const reservedDescription = `coiab-org:v2:${ORG_A}:m:Acme`;
    const orgs = reconstructOrganizations([
      {
        projectId: 'p-x',
        projectDescription: reservedDescription,
        status: 'joined',
      },
      {
        projectId: 'p-m',
        projectDescription: markerFor(ORG_A, 'm', 'Acme'),
        status: 'joined',
      },
    ]);
    expect(orgs).toHaveLength(2);
    expect(
      orgs.find(org => org.organizationId === reservedDescription),
    ).toEqual({
      state: 'invalid',
      organizationId: reservedDescription, // raw description as the key
      reason: 'unsupported-marker',
      organizationName: undefined,
      slots: {},
    });
    expect(orgs.find(org => org.organizationId === ORG_A)?.state).toBe(
      'incomplete',
    );
  });

  it('sorts organizations by organizationId ascending', () => {
    const orgs = reconstructOrganizations([
      {
        projectId: 'b-m',
        projectDescription: markerFor(ORG_B, 'm', 'B'),
        status: 'joined',
      },
      {
        projectId: 'a-a',
        projectDescription: markerFor(ORG_A, 'a', 'A'),
        status: 'joined',
      },
      {
        projectId: 'a-m',
        projectDescription: markerFor(ORG_A, 'm', 'A'),
        status: 'joined',
      },
      {
        projectId: 'b-a',
        projectDescription: markerFor(ORG_B, 'a', 'B'),
        status: 'joined',
      },
    ]);
    expect(orgs.map(org => org.organizationId)).toEqual([ORG_A, ORG_B]);
  });
});

describe('projectProvenance', () => {
  const rows = [
    {
      projectId: 'a-m',
      projectDescription: markerFor(ORG_A, 'm', 'A'),
      status: 'joined' as const,
    },
    {
      projectId: 'a-a-left',
      projectDescription: markerFor(ORG_A, 'a', 'A'),
      status: 'left' as const,
    },
    {projectId: 'standalone', status: 'joined' as const},
    {
      projectId: 'plain',
      projectDescription: 'Plano de manejo',
      status: 'joined' as const,
    },
  ];

  it('reads the marker of a joined row', () => {
    expect(projectProvenance(rows, 'a-m')).toEqual({
      kind: 'organization',
      organizationId: ORG_A,
    });
  });

  it('reads the marker of a NON-joined row, which contributes no slot', () => {
    // The status change drops the slot from the reconstruction but leaves
    // the marker intact — that is what makes a kept-but-unjoined slot
    // traceable to its organization.
    expect(reconstructOrganizations(rows)).toEqual([
      expect.objectContaining({state: 'incomplete', organizationId: ORG_A}),
    ]);
    expect(projectProvenance(rows, 'a-a-left')).toEqual({
      kind: 'organization',
      organizationId: ORG_A,
    });
  });

  it('reports a project the device holds without a marker as unmarked', () => {
    expect(projectProvenance(rows, 'standalone')).toEqual({kind: 'unmarked'});
    expect(projectProvenance(rows, 'plain')).toEqual({kind: 'unmarked'});
  });

  it('reports an id the device holds no project for as absent', () => {
    expect(projectProvenance(rows, 'gone')).toEqual({kind: 'absent'});
    expect(projectProvenance([], 'a-m')).toEqual({kind: 'absent'});
  });

  it('reports no id at all as absent', () => {
    expect(projectProvenance(rows, undefined)).toEqual({kind: 'absent'});
  });
});
