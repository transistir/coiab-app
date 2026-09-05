import {useManyInvites} from '@comapeo/core-react';
import {useEffect} from 'react';
import {isEditingScreen, isInviteScreen} from '../lib/screenNameChecks';
import {parseMarker} from '../lib/organization/marker';
import type {InviteLike} from '../lib/organization/bundle';

/**
 * Which invite surface (if any) the currently pending invites ask for:
 * SPEC 7.1 — an invite carrying a valid Organization marker opens the single
 * Organization surface (the screen re-groups the invites into a bundle,
 * complete or not); otherwise the plain invite falls through to the legacy
 * per-project sheet. `undefined` = do nothing.
 */
export function selectPendingInviteRoute(
  invites: ReadonlyArray<InviteLike>,
  currentRouteName: string | undefined,
): PendingInviteRoute | undefined {
  const pending = invites.filter(i => i.state === 'pending');
  if (pending.length === 0 || !currentRouteName) return undefined;

  // if user is already interacting with an invite, do nothing
  if (isInviteScreen(currentRouteName)) return undefined;

  if (isEditingScreen(currentRouteName)) return undefined;

  for (const invite of pending) {
    const marker = parseMarker(invite.projectDescription ?? '');
    if (marker) {
      return {
        type: 'organization',
        organizationId: marker.organizationId,
        inviteId: invite.inviteId,
      };
    }
  }

  return {type: 'plain', inviteId: pending[0]!.inviteId};
}

export type PendingInviteRoute =
  | {type: 'organization'; organizationId: string; inviteId: string}
  | {type: 'plain'; inviteId: string};

export const PendingInvitesListener = ({
  currentRouteName,
  navigateToInviteScreen,
  navigateToOrgInviteScreen,
}: {
  currentRouteName: string | undefined;
  navigateToInviteScreen: (inviteId: string) => void;
  navigateToOrgInviteScreen: (organizationId: string, inviteId: string) => void;
}) => {
  const {data: invites} = useManyInvites();

  useEffect(() => {
    const route = selectPendingInviteRoute(invites, currentRouteName);
    if (!route) return;
    if (route.type === 'organization') {
      navigateToOrgInviteScreen(route.organizationId, route.inviteId);
    } else {
      navigateToInviteScreen(route.inviteId);
    }
  }, [
    invites,
    currentRouteName,
    navigateToInviteScreen,
    navigateToOrgInviteScreen,
  ]);
  return null;
};
