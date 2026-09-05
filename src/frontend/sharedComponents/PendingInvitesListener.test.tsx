import {render, waitFor} from '@testing-library/react-native';
import {useManyInvites} from '@comapeo/core-react';

import {
  PendingInvitesListener,
  selectPendingInviteRoute,
} from './PendingInvitesListener';
import {markerFor} from '../lib/organization/marker';
import type {InviteLike} from '../lib/organization/bundle';

jest.mock('@comapeo/core-react', () => ({
  useManyInvites: jest.fn(),
}));

const useManyInvitesMock = useManyInvites as jest.Mock;

const ORG_ID = 'a1b2c3d4e5f60718';

function makeInvite(overrides?: Partial<InviteLike>): InviteLike {
  return {
    inviteId: 'invite-1',
    projectDescription: undefined,
    invitorDeviceId: 'invitor-1',
    roleName: 'Coordinator',
    receivedAt: 1,
    state: 'pending',
    ...overrides,
  };
}

const MARKER_DESCRIPTION = markerFor(ORG_ID, 'm', 'Org Um');

describe('selectPendingInviteRoute', () => {
  test('a marker invite routes to the Organization invite screen', () => {
    expect(
      selectPendingInviteRoute(
        [
          makeInvite({
            inviteId: 'invite-marker',
            projectDescription: MARKER_DESCRIPTION,
          }),
        ],
        'Home',
      ),
    ).toStrictEqual({
      type: 'organization',
      organizationId: ORG_ID,
      inviteId: 'invite-marker',
    });
  });

  test('a plain invite routes to the legacy invite screen', () => {
    expect(
      selectPendingInviteRoute(
        [makeInvite({inviteId: 'invite-plain'})],
        'Home',
      ),
    ).toStrictEqual({type: 'plain', inviteId: 'invite-plain'});
  });

  test('a marker invite wins even when a plain invite arrived first', () => {
    const route = selectPendingInviteRoute(
      [
        makeInvite({inviteId: 'invite-plain', receivedAt: 1}),
        makeInvite({
          inviteId: 'invite-marker',
          projectDescription: MARKER_DESCRIPTION,
          receivedAt: 2,
        }),
      ],
      'Home',
    );
    expect(route).toStrictEqual({
      type: 'organization',
      organizationId: ORG_ID,
      inviteId: 'invite-marker',
    });
  });

  test('a reserved-but-unparseable description is not treated as a marker invite', () => {
    expect(
      selectPendingInviteRoute(
        [
          makeInvite({
            inviteId: 'invite-corrupted',
            projectDescription: 'coiab-org:v9:not-an-id',
          }),
        ],
        'Home',
      ),
    ).toStrictEqual({type: 'plain', inviteId: 'invite-corrupted'});
  });

  test('does nothing while an invite screen is open', () => {
    expect(
      selectPendingInviteRoute(
        [makeInvite({projectDescription: MARKER_DESCRIPTION})],
        'InviteReceived',
      ),
    ).toBeUndefined();
  });

  test('does nothing while an editing screen is open', () => {
    expect(
      selectPendingInviteRoute([makeInvite()], 'ObservationEdit'),
    ).toBeUndefined();
  });

  test('does nothing with no pending invites', () => {
    expect(
      selectPendingInviteRoute([makeInvite({state: 'joined'})], 'Home'),
    ).toBeUndefined();
  });

  test('does nothing without a current route', () => {
    expect(selectPendingInviteRoute([makeInvite()], undefined)).toBeUndefined();
  });
});

describe('PendingInvitesListener', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('navigates to the Organization invite screen for a marker invite', async () => {
    useManyInvitesMock.mockReturnValue({
      data: [
        makeInvite({
          inviteId: 'invite-marker',
          projectDescription: MARKER_DESCRIPTION,
        }),
      ],
    });
    const navigateToOrgInviteScreen = jest.fn();
    const navigateToInviteScreen = jest.fn();

    render(
      <PendingInvitesListener
        currentRouteName="Home"
        navigateToInviteScreen={navigateToInviteScreen}
        navigateToOrgInviteScreen={navigateToOrgInviteScreen}
      />,
    );

    await waitFor(() => {
      expect(navigateToOrgInviteScreen).toHaveBeenCalledTimes(1);
    });
    expect(navigateToOrgInviteScreen).toHaveBeenCalledWith(
      ORG_ID,
      'invite-marker',
    );
    expect(navigateToInviteScreen).not.toHaveBeenCalled();
  });
});
