import {
  getInitialRoute,
  resolveActiveProjectCorrection,
  type ActiveProjectCorrection,
} from './index';
import type {ReconstructedOrganization} from '../../lib/organization/reconstruct';

const authenticated = 'authenticated' as const;
const unauthenticated = 'unauthenticated' as const;

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

  test('without a ready organization nothing is corrected (the caller gates on orgStatus)', () => {
    expect(
      resolveActiveProjectCorrection(
        [incompleteOrg('a1', {m: 'proj-a-m'})],
        'proj-a-m',
      ),
    ).toEqual({kind: 'none'});
  });
});
