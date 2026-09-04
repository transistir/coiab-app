import {resolveDeepLinkInviteTarget} from './deepLinkTarget';
import {markerFor} from './marker';
import type {InviteLike} from './bundle';

const ORG_ID = 'a1b2c3d4e5f60718';
const ORG_NAME = 'Org Um';

function makeInvite(overrides: Partial<InviteLike> = {}): InviteLike {
  return {
    inviteId: 'invite-1',
    projectDescription: markerFor(ORG_ID, 'm', ORG_NAME),
    invitorDeviceId: 'invitor-1',
    roleName: 'Coordinator',
    receivedAt: 1,
    state: 'pending',
    ...overrides,
  };
}

describe('resolveDeepLinkInviteTarget', () => {
  test('an invite carrying a valid Organization marker routes to the organization surface', () => {
    expect(resolveDeepLinkInviteTarget([makeInvite()], 'invite-1')).toBe(
      'organization',
    );
  });

  test('a plain invite routes to the legacy surface', () => {
    expect(
      resolveDeepLinkInviteTarget(
        [makeInvite({projectDescription: 'Coastal Cleanup'})],
        'invite-1',
      ),
    ).toBe('legacy');
  });

  test('a description without a marker routes to the legacy surface', () => {
    expect(
      resolveDeepLinkInviteTarget(
        [makeInvite({projectDescription: undefined})],
        'invite-1',
      ),
    ).toBe('legacy');
  });

  test('a reserved-but-unparseable description routes to the legacy surface', () => {
    expect(
      resolveDeepLinkInviteTarget(
        [makeInvite({projectDescription: 'coiab-org:v1:nope'})],
        'invite-1',
      ),
    ).toBe('legacy');
  });

  test('an invite missing from the list resolves to undefined', () => {
    expect(resolveDeepLinkInviteTarget([], 'invite-1')).toBeUndefined();
    expect(
      resolveDeepLinkInviteTarget(
        [makeInvite({inviteId: 'other'})],
        'invite-1',
      ),
    ).toBeUndefined();
  });
});
