import {getInitialRoute} from './index';

const authenticated = 'authenticated' as const;
const unauthenticated = 'unauthenticated' as const;

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
});
