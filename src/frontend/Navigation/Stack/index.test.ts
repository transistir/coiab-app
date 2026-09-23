import {getInitialRoute} from './index';
import type {ActivationStatus} from '../../lib/organization/activation';

const authenticated = 'authenticated' as const;
const unauthenticated = 'unauthenticated' as const;

describe('getInitialRoute', () => {
  test('unauthenticated goes to AuthScreen regardless of everything else', () => {
    expect(getInitialRoute(unauthenticated, undefined, 'nenhum', 'ready')).toBe(
      'AuthScreen',
    );
    expect(getInitialRoute(unauthenticated, 'device', 'pronta', 'ready')).toBe(
      'AuthScreen',
    );
    expect(
      getInitialRoute(unauthenticated, 'device', 'confirmacao', 'recovery'),
    ).toBe('AuthScreen');
  });

  test('no device name goes to IntroToCoMapeo', () => {
    expect(getInitialRoute(authenticated, undefined, 'nenhum', 'absent')).toBe(
      'IntroToCoMapeo',
    );
    expect(getInitialRoute(authenticated, undefined, 'pronta', 'ready')).toBe(
      'IntroToCoMapeo',
    );
    expect(
      getInitialRoute(authenticated, undefined, 'preparando', 'preparing'),
    ).toBe('IntroToCoMapeo');
  });

  test('a pending document opens the provisioning surface before the activation is consulted (SPEC B §3.3 2-3)', () => {
    // The document is resolved FIRST: while any organization is still being
    // prepared, or is ready only because its confirmation was never
    // acknowledged, nothing may be activated — the device waits for the
    // "Abrir organização" tap no matter what the activation says.
    expect(
      getInitialRoute(authenticated, 'device', 'preparando', 'loading'),
    ).toBe('OrganizationProvisioning');
    expect(
      getInitialRoute(authenticated, 'device', 'confirmacao', 'opening'),
    ).toBe('OrganizationProvisioning');
    expect(
      getInitialRoute(authenticated, 'device', 'confirmacao', 'ready'),
    ).toBe('OrganizationProvisioning');
    expect(
      getInitialRoute(unauthenticated, 'device', 'preparando', 'recovery'),
    ).toBe('AuthScreen');
    expect(
      getInitialRoute(authenticated, undefined, 'confirmacao', 'recovery'),
    ).toBe('IntroToCoMapeo');
  });

  test('an empty document goes to Success regardless of the core (marker-only organizations are unrecognized)', () => {
    // A `:131`: marker-only projects from spike builds reconstruct as
    // organizations in the core, but the document alone decides — the
    // create/join fork is the only landing for a device with no
    // organizations at all.
    expect(getInitialRoute(authenticated, 'device', 'nenhum', 'absent')).toBe(
      'Success',
    );
    expect(getInitialRoute(authenticated, 'device', 'nenhum', 'ready')).toBe(
      'Success',
    );
  });

  test('a settled document opens Home only on a validated activation', () => {
    expect(getInitialRoute(authenticated, 'device', 'pronta', 'ready')).toBe(
      'Home',
    );
  });

  test('a settled document whose activation degraded or has no selection opens the provisioning surface', () => {
    // Recovery: the open organization lost access and nothing is validated
    // yet (§4.2 rule 8). Unavailable: the boot was blocked (pending work, a
    // hydration failure). Selection: several organizations, none selected.
    expect(getInitialRoute(authenticated, 'device', 'pronta', 'recovery')).toBe(
      'OrganizationProvisioning',
    );
    expect(
      getInitialRoute(authenticated, 'device', 'pronta', 'unavailable'),
    ).toBe('OrganizationProvisioning');
    expect(
      getInitialRoute(authenticated, 'device', 'pronta', 'selection'),
    ).toBe('OrganizationProvisioning');
  });

  test('an in-flight activation on a settled document is never a route — the navigator holds the loader instead', () => {
    // `loading` | `opening` mean "an activation is running": the
    // RootStackNavigator renders FullScreenCenteredLoader and does not call
    // this at all. The function cannot say where such a device opens; the
    // fail-closed return only keeps a direct caller from handing Home to an
    // unvalidated activation.
    const statuses: ActivationStatus[] = ['loading', 'opening'];
    for (const ativacao of statuses) {
      expect(
        getInitialRoute(authenticated, 'device', 'pronta', ativacao),
      ).not.toBe('Home');
    }
  });
});
