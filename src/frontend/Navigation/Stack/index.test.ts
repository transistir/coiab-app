import {
  getInitialRoute,
  resolveActiveProjectCorrection,
  type ActiveProjectCorrection,
} from './index';
import type {
  LocalProjectRow,
  ReconstructedOrganization,
} from '../../lib/organization/reconstruct';
import {markerFor} from '../../lib/organization/marker';

const authenticated = 'authenticated' as const;
const unauthenticated = 'unauthenticated' as const;

// F7: marker provenance is read from the project ROWS, so the ids used by
// the provenance tests must be real (16 lowercase hex) marker ids.
const ORG_A = 'a'.repeat(16);
const ORG_B = 'b'.repeat(16);

function markedRow(
  projectId: string,
  organizationId: string,
  slot: 'm' | 'a',
  status: LocalProjectRow['status'] = 'joined',
): LocalProjectRow {
  return {
    projectId,
    projectDescription: markerFor(
      organizationId,
      slot,
      `Org ${organizationId}`,
    ),
    status,
  };
}

function unmarkedRow(
  projectId: string,
  status: LocalProjectRow['status'] = 'joined',
): LocalProjectRow {
  return {projectId, status};
}

function readyOrg(id: string, m: string, a: string): ReconstructedOrganization {
  return {
    state: 'ready',
    organizationId: id,
    organizationName: `Org ${id}`,
    slots: {m, a},
  };
}

function incompleteOrg(
  id: string,
  slots: Partial<Record<'m' | 'a', string>>,
): ReconstructedOrganization {
  return {
    state: 'incomplete',
    organizationId: id,
    organizationName: `Org ${id}`,
    slots,
  };
}

describe('getInitialRoute', () => {
  test('unauthenticated goes to AuthScreen regardless of everything else', () => {
    expect(getInitialRoute(unauthenticated, undefined, undefined, 'none')).toBe(
      'AuthScreen',
    );
    expect(
      getInitialRoute(unauthenticated, 'device', 'projectId', 'ready'),
    ).toBe('AuthScreen');
  });

  test('no device name goes to IntroToCoMapeo', () => {
    expect(getInitialRoute(authenticated, undefined, undefined, 'none')).toBe(
      'IntroToCoMapeo',
    );
    expect(
      getInitialRoute(authenticated, undefined, 'projectId', 'ready'),
    ).toBe('IntroToCoMapeo');
  });

  test('orgStatus none goes to Success regardless of projectId (SPEC 10.1)', () => {
    expect(getInitialRoute(authenticated, 'device', undefined, 'none')).toBe(
      'Success',
    );
    // A device holding a non-marker project (e.g. legacy invite accept)
    // still has no Organization and must go through the org fork.
    expect(getInitialRoute(authenticated, 'device', 'projectId', 'none')).toBe(
      'Success',
    );
  });

  test('orgStatus provisioning goes to OrganizationProvisioning regardless of projectId (fail-closed, SPEC 10.1)', () => {
    expect(
      getInitialRoute(authenticated, 'device', undefined, 'provisioning'),
    ).toBe('OrganizationProvisioning');
    expect(
      getInitialRoute(authenticated, 'device', 'projectId', 'provisioning'),
    ).toBe('OrganizationProvisioning');
  });

  test('orgStatus ready goes to Home', () => {
    expect(getInitialRoute(authenticated, 'device', 'projectId', 'ready')).toBe(
      'Home',
    );
    expect(getInitialRoute(authenticated, 'device', undefined, 'ready')).toBe(
      'Home',
    );
  });

  test('a degraded active organization opens on the recovery surface, not Home (F1 cold start)', () => {
    // F1: the device boots with the ACTIVE project on an organization that
    // degraded while another one is ready. Home would mean operating the
    // OTHER organization (the active id is corrected there) with no notice,
    // so the startup gate opens on the recovery surface instead. The cold
    // start is owned here, declaratively: an imperative reset from the
    // navigator's layout effect on the first commit is undone by the router.
    expect(
      getInitialRoute(authenticated, 'device', 'projectId', 'ready', true),
    ).toBe('OrganizationProvisioning');
    // The legacy/rootless correction path is unaffected — it still lands on
    // Home and the effect repoints the id (SPEC 1.3).
    expect(
      getInitialRoute(authenticated, 'device', 'projectId', 'ready', false),
    ).toBe('Home');
  });

  test('the degraded signal never overrides the earlier gates', () => {
    expect(
      getInitialRoute(unauthenticated, 'device', 'projectId', 'ready', true),
    ).toBe('AuthScreen');
    expect(
      getInitialRoute(authenticated, undefined, 'projectId', 'ready', true),
    ).toBe('IntroToCoMapeo');
    expect(
      getInitialRoute(authenticated, 'device', 'projectId', 'none', true),
    ).toBe('Success');
  });
});

describe('resolveActiveProjectCorrection (SPEC 1.3 + F1)', () => {
  test('a ready organization slot (either area) needs no correction', () => {
    const organizations = [
      readyOrg('a1', 'proj-a-m', 'proj-a-a'),
      readyOrg('b2', 'proj-b-m', 'proj-b-a'),
    ];
    expect(resolveActiveProjectCorrection(organizations, 'proj-a-m')).toEqual({
      kind: 'none',
    });
    expect(resolveActiveProjectCorrection(organizations, 'proj-b-a')).toEqual({
      kind: 'none',
    });
  });

  test('a rootless id is silently corrected to the first ready organization m slot (legacy, SPEC 1.3)', () => {
    // The documented legacy case: a persisted id that never was an
    // organization slot origin (pre-org era, standalone/debug switch).
    expect(
      resolveActiveProjectCorrection(
        [readyOrg('a1', 'proj-a-m', 'proj-a-a')],
        'unrelated-project',
      ),
    ).toEqual({kind: 'correct', projectId: 'proj-a-m'});
    // No active id at all (first run) is rootless too.
    expect(
      resolveActiveProjectCorrection(
        [readyOrg('a1', 'proj-a-m', 'proj-a-a')],
        undefined,
      ),
    ).toEqual({kind: 'correct', projectId: 'proj-a-m'});
  });

  test('a degraded organization slot is NEVER silently switched while another organization is ready', () => {
    // F1: org A degraded (incomplete) while org B is ready, and the
    // active id is A's m slot — the old effect rewrote it to B's m slot;
    // the correction must expose the degradation instead.
    const organizations = [
      incompleteOrg('a1', {m: 'proj-a-m'}),
      readyOrg('b2', 'proj-b-m', 'proj-b-a'),
    ];
    const correction: ActiveProjectCorrection = resolveActiveProjectCorrection(
      organizations,
      'proj-a-m',
    );
    expect(correction).toEqual({kind: 'degraded'});
  });

  test('a slot of an invalid organization also counts as a slot origin, not a rootless id', () => {
    const invalid: ReconstructedOrganization = {
      state: 'invalid',
      organizationId: 'a1',
      reason: 'duplicate-slot',
      organizationName: 'Org a1',
      slots: {m: 'proj-a-m'},
    };
    expect(
      resolveActiveProjectCorrection(
        [invalid, readyOrg('b2', 'proj-b-m', 'proj-b-a')],
        'proj-a-m',
      ),
    ).toEqual({kind: 'degraded'});
  });

  test('a cleared active id is not silently repointed while an organization is degraded (F6)', () => {
    // The one-tap leave flow clears the active id: the device is left with
    // NO active id, org A degraded (its remaining slot only) and org B
    // ready. `undefined` is claimed by no organization, so the legacy
    // branch would repoint it at B's m slot — the silent cross-org switch
    // F1 forbids, just reached through the cleared id instead of A's slot.
    // F7 keeps this case on the device-wide gate: a cleared id has no row
    // and therefore no provenance to consult, and clearing is exactly what
    // the leave flow does, so the non-ready organization next to it is the
    // residue of that leave.
    const organizations = [
      incompleteOrg('a1', {a: 'proj-a-a'}),
      readyOrg('b2', 'proj-b-m', 'proj-b-a'),
    ];
    expect(resolveActiveProjectCorrection(organizations, undefined)).toEqual({
      kind: 'degraded',
    });
  });

  test('a vanished active id degrades on MARKER evidence, not on the device-wide gate (F6 → F7)', () => {
    // BEHAVIOUR FLIP (round 4, F7): this test used to assert `degraded` from
    // the blanket `some(state !== 'ready')` gate, with NO project rows — i.e.
    // from device-wide state rather than from the id's own provenance. F7
    // replaces that gate with per-id provenance, so the same organizations
    // now resolve differently depending on what the rows say about the id.
    const organizations = [
      incompleteOrg(ORG_A, {a: 'proj-a-a'}),
      readyOrg(ORG_B, 'proj-b-m', 'proj-b-a'),
    ];
    // `reconstruct` contributes a slot only for `joined` rows, so the slot
    // this device LOST (left, or removed by another device) is absent from
    // `org.slots` — but its ROW survives, still carrying the coiab-org
    // marker of organization A. That marker is the ownership evidence: the
    // id belongs to a non-ready organization, so it fails closed.
    expect(
      resolveActiveProjectCorrection(organizations, 'proj-a-m', [
        markedRow('proj-a-m', ORG_A, 'm', 'left'),
        markedRow('proj-a-a', ORG_A, 'a'),
        markedRow('proj-b-m', ORG_B, 'm'),
        markedRow('proj-b-a', ORG_B, 'a'),
      ]),
    ).toEqual({kind: 'degraded'});
    // Without that evidence the very same device state is a legacy rootless
    // id next to a broken organization it has no link to — parking the user
    // on provisioning there is residual #2 / the Greptile P1, so it corrects.
    expect(
      resolveActiveProjectCorrection(organizations, 'standalone-project', [
        unmarkedRow('standalone-project'),
        markedRow('proj-a-a', ORG_A, 'a'),
        markedRow('proj-b-m', ORG_B, 'm'),
        markedRow('proj-b-a', ORG_B, 'a'),
      ]),
    ).toEqual({kind: 'correct', projectId: 'proj-b-m'});
  });

  test('an unmarked active id reaches the ready organization even with an invalid organization on the device (F7, Greptile P1)', () => {
    // The reported repro: a standalone (unmarked) active project, a READY
    // organization B and an INVALID organization A on the same device. The
    // active id has no marker link to A, so the device-wide gate was parking
    // the user on OrganizationProvisioning with no way to reach Home.
    // Provisioning is reserved for ids with ownership evidence.
    const invalid: ReconstructedOrganization = {
      state: 'invalid',
      organizationId: ORG_A,
      reason: 'duplicate-slot',
      organizationName: `Org ${ORG_A}`,
      slots: {m: 'proj-a-m'},
    };
    expect(
      resolveActiveProjectCorrection(
        [invalid, readyOrg(ORG_B, 'proj-b-m', 'proj-b-a')],
        'standalone-project',
        [
          unmarkedRow('standalone-project'),
          markedRow('proj-a-m', ORG_A, 'm'),
          markedRow('proj-a-m-duplicate', ORG_A, 'm'),
          markedRow('proj-b-m', ORG_B, 'm'),
          markedRow('proj-b-a', ORG_B, 'a'),
        ],
      ),
    ).toEqual({kind: 'correct', projectId: 'proj-b-m'});
  });

  test('a marked id whose organization vanished from the store degrades on an all-ready device (F7, residual #1)', () => {
    // Residual #1: EVERY row of organization A is marked `coiab-org:A` but
    // non-joined (left here, or removed by another device), so A is not
    // reconstructed at all and the device looks entirely ready. The active
    // id is A's old m slot: the all-ready fallthrough silently handed the
    // user organization B. Marker provenance says the id is owned by an
    // organization this device no longer holds — keep the slot, show the
    // repair surface.
    const organizations = [readyOrg(ORG_B, 'proj-b-m', 'proj-b-a')];
    expect(
      resolveActiveProjectCorrection(organizations, 'proj-a-m', [
        markedRow('proj-a-m', ORG_A, 'm', 'left'),
        markedRow('proj-a-a', ORG_A, 'a', 'left'),
        markedRow('proj-b-m', ORG_B, 'm'),
        markedRow('proj-b-a', ORG_B, 'a'),
      ]),
    ).toEqual({kind: 'degraded'});
  });

  test('a marked id whose own organization is ready is repointed at that organization, not at another (F7)', () => {
    // The owning organization is READY but the active id is not one of its
    // current slots (e.g. the marked row was replaced by a re-join, so the
    // old row is `left` while both current slots are joined). Repointing
    // inside the SAME organization is not the cross-org switch F1 forbids,
    // so the id is corrected to its own organization's Monitoramento slot —
    // NOT to the first ready organization in the list (B here).
    const organizations = [
      readyOrg(ORG_B, 'proj-b-m', 'proj-b-a'),
      readyOrg(ORG_A, 'proj-a-m-new', 'proj-a-a'),
    ];
    expect(
      resolveActiveProjectCorrection(organizations, 'proj-a-m-old', [
        markedRow('proj-a-m-old', ORG_A, 'm', 'left'),
        markedRow('proj-a-m-new', ORG_A, 'm'),
        markedRow('proj-a-a', ORG_A, 'a'),
        markedRow('proj-b-m', ORG_B, 'm'),
        markedRow('proj-b-a', ORG_B, 'a'),
      ]),
    ).toEqual({kind: 'correct', projectId: 'proj-a-m-new'});
  });

  test('an id naming no local project fails closed while an organization is non-ready (F7, the leave residue)', () => {
    // A local leave DELETES the project row (verified against the real core
    // in index.navigator.test.tsx) and clears the active id, so the slot the
    // device lost leaves neither a marker nor a row behind. An id that names
    // no local project is therefore the shape a vanished slot has — with a
    // non-ready organization on the device it fails closed rather than
    // handing the user the other organization.
    const organizations = [
      incompleteOrg(ORG_A, {a: 'proj-a-a'}),
      readyOrg(ORG_B, 'proj-b-m', 'proj-b-a'),
    ];
    const rowsAfterLeave = [
      markedRow('proj-a-a', ORG_A, 'a'),
      markedRow('proj-b-m', ORG_B, 'm'),
      markedRow('proj-b-a', ORG_B, 'a'),
    ];
    expect(
      resolveActiveProjectCorrection(organizations, 'proj-a-m', rowsAfterLeave),
    ).toEqual({kind: 'degraded'});
    expect(
      resolveActiveProjectCorrection(organizations, undefined, rowsAfterLeave),
    ).toEqual({kind: 'degraded'});
    // All ready: nothing can have been lost, so the legacy correction stands
    // even for an id the device holds no project for.
    const allReady = [
      readyOrg(ORG_B, 'proj-b-m', 'proj-b-a'),
      readyOrg(ORG_A, 'proj-a-m', 'proj-a-a'),
    ];
    expect(
      resolveActiveProjectCorrection(allReady, 'gone-project', [
        markedRow('proj-b-m', ORG_B, 'm'),
        markedRow('proj-b-a', ORG_B, 'a'),
        markedRow('proj-a-m', ORG_A, 'm'),
        markedRow('proj-a-a', ORG_A, 'a'),
      ]),
    ).toEqual({kind: 'correct', projectId: 'proj-b-m'});
  });

  test('an unclaimed id is still silently corrected when EVERY organization is ready (legacy stays intact, SPEC 1.3)', () => {
    // The conservative gate only suppresses the legacy correction while
    // something is non-ready: with an all-ready device no slot can have
    // vanished, so the documented rootless behaviour is unchanged.
    const organizations = [
      readyOrg('a1', 'proj-a-m', 'proj-a-a'),
      readyOrg('b2', 'proj-b-m', 'proj-b-a'),
    ];
    expect(resolveActiveProjectCorrection(organizations, undefined)).toEqual({
      kind: 'correct',
      projectId: 'proj-a-m',
    });
    expect(
      resolveActiveProjectCorrection(organizations, 'unrelated-project'),
    ).toEqual({kind: 'correct', projectId: 'proj-a-m'});
  });

  test('without a ready organization nothing is corrected (the caller gates on orgStatus)', () => {
    expect(
      resolveActiveProjectCorrection(
        [incompleteOrg('a1', {m: 'proj-a-m'})],
        'proj-a-m',
      ),
    ).toEqual({kind: 'none'});
  });
});
