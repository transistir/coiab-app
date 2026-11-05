import {getInitialRoute} from './index';
import type {ActivationStatus} from '../../lib/organization/activation';

const authenticated = 'authenticated' as const;
const unauthenticated = 'unauthenticated' as const;

describe('getInitialRoute', () => {
  test('unauthenticated goes to AuthScreen regardless of everything else', () => {
    expect(
      getInitialRoute(
        unauthenticated,
        undefined,
        'nenhum',
        'ready',
        false,
        null,
      ),
    ).toBe('AuthScreen');
    expect(
      getInitialRoute(unauthenticated, 'device', 'pronta', 'ready', true, null),
    ).toBe('AuthScreen');
    expect(
      getInitialRoute(
        unauthenticated,
        'device',
        'confirmacao',
        'recovery',
        false,
        null,
      ),
    ).toBe('AuthScreen');
  });

  test('no device name goes to IntroToCoMapeo', () => {
    expect(
      getInitialRoute(
        authenticated,
        undefined,
        'nenhum',
        'absent',
        false,
        null,
      ),
    ).toBe('IntroToCoMapeo');
    expect(
      getInitialRoute(authenticated, undefined, 'pronta', 'ready', true, null),
    ).toBe('IntroToCoMapeo');
    expect(
      getInitialRoute(
        authenticated,
        undefined,
        'preparando',
        'preparing',
        true,
        null,
      ),
    ).toBe('IntroToCoMapeo');
  });

  test('a pending document opens the provisioning surface before the activation is consulted (SPEC B §3.3 2-3)', () => {
    // The document is resolved FIRST: while any organization is still being
    // prepared, or is ready only because its confirmation was never
    // acknowledged, nothing may be activated — the device waits for the
    // "Abrir organização" tap no matter what the activation says. The
    // onboarding profile does not change any of these branches.
    for (const profileComplete of [false, true]) {
      expect(
        getInitialRoute(
          authenticated,
          'device',
          'preparando',
          'loading',
          profileComplete,
          null,
        ),
      ).toBe('OrganizationProvisioning');
      expect(
        getInitialRoute(
          authenticated,
          'device',
          'confirmacao',
          'opening',
          profileComplete,
          null,
        ),
      ).toBe('OrganizationProvisioning');
      expect(
        getInitialRoute(
          authenticated,
          'device',
          'confirmacao',
          'ready',
          profileComplete,
          null,
        ),
      ).toBe('OrganizationProvisioning');
    }
    expect(
      getInitialRoute(
        unauthenticated,
        'device',
        'preparando',
        'recovery',
        true,
        null,
      ),
    ).toBe('AuthScreen');
    expect(
      getInitialRoute(
        authenticated,
        undefined,
        'confirmacao',
        'recovery',
        true,
        null,
      ),
    ).toBe('IntroToCoMapeo');
  });

  test('an empty document gates the create/join fork on the onboarding profile (#128)', () => {
    // A `:131`: marker-only projects from spike builds reconstruct as
    // organizations in the core, but the document alone decides — a device
    // with no organizations has nowhere to go but onboarding. The profile is
    // the last step before the fork: without ethnicity and village the cold
    // start must open the profile flow, never Success.
    expect(
      getInitialRoute(authenticated, 'device', 'nenhum', 'absent', false, null),
    ).toBe('EthnicGroupSelection');
    expect(
      getInitialRoute(authenticated, 'device', 'nenhum', 'ready', false, null),
    ).toBe('EthnicGroupSelection');
    expect(
      getInitialRoute(authenticated, 'device', 'nenhum', 'absent', true, null),
    ).toBe('Success');
    expect(
      getInitialRoute(authenticated, 'device', 'nenhum', 'ready', true, null),
    ).toBe('Success');
  });

  test('an empty document routes the three coordination-role states (#129)', () => {
    // The role answered on Success splits the post-profile fork: a
    // coordinator goes straight to creation, a participant to the
    // invitation intro, and an unanswered role back to the question. Only
    // the `nenhum` document consults it.
    expect(
      getInitialRoute(
        authenticated,
        'device',
        'nenhum',
        'absent',
        true,
        'coordinator',
      ),
    ).toBe('CreateOrganization');
    expect(
      getInitialRoute(
        authenticated,
        'device',
        'nenhum',
        'absent',
        true,
        'participant',
      ),
    ).toBe('JoinOrganizationIntro');
    expect(
      getInitialRoute(authenticated, 'device', 'nenhum', 'absent', true, null),
    ).toBe('Success');
    // An incomplete profile always wins over a persisted role.
    expect(
      getInitialRoute(
        authenticated,
        'device',
        'nenhum',
        'absent',
        false,
        'coordinator',
      ),
    ).toBe('EthnicGroupSelection');
    // A settled document never consults the role.
    expect(
      getInitialRoute(
        authenticated,
        'device',
        'pronta',
        'ready',
        true,
        'participant',
      ),
    ).toBe('Home');
  });

  test('a settled document opens Home only on a validated activation', () => {
    expect(
      getInitialRoute(authenticated, 'device', 'pronta', 'ready', false, null),
    ).toBe('Home');
    expect(
      getInitialRoute(authenticated, 'device', 'pronta', 'ready', true, null),
    ).toBe('Home');
  });

  test('a settled document whose activation degraded or has no selection opens the provisioning surface', () => {
    // Recovery: the open organization lost access and nothing is validated
    // yet (§4.2 rule 8). Unavailable: the boot was blocked (pending work, a
    // hydration failure). Selection: several organizations, none selected.
    // As with `preparando`/`confirmacao`, the profile never reroutes a
    // settled document.
    for (const profileComplete of [false, true]) {
      expect(
        getInitialRoute(
          authenticated,
          'device',
          'pronta',
          'recovery',
          profileComplete,
          null,
        ),
      ).toBe('OrganizationProvisioning');
      expect(
        getInitialRoute(
          authenticated,
          'device',
          'pronta',
          'unavailable',
          profileComplete,
          null,
        ),
      ).toBe('OrganizationProvisioning');
      expect(
        getInitialRoute(
          authenticated,
          'device',
          'pronta',
          'selection',
          profileComplete,
          null,
        ),
      ).toBe('OrganizationProvisioning');
    }
  });

  test('an in-flight activation on a settled document is never a route — the navigator holds the loader instead', () => {
    // `loading` | `opening` mean "an activation is running": the
    // RootStackNavigator renders FullScreenCenteredLoader and does not call
    // this at all. The function cannot say where such a device opens; the
    // fail-closed return only keeps a direct caller from handing Home to an
    // unvalidated activation.
    const statuses: ActivationStatus[] = ['loading', 'opening'];
    for (const ativacao of statuses) {
      for (const profileComplete of [false, true]) {
        expect(
          getInitialRoute(
            authenticated,
            'device',
            'pronta',
            ativacao,
            profileComplete,
            null,
          ),
        ).not.toBe('Home');
      }
    }
  });
});
