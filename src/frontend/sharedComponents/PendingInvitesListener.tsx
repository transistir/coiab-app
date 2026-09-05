import {useManyInvites} from '@comapeo/core-react';
import {useEffect} from 'react';
import {isEditingScreen, isInviteScreen} from '../lib/screenNameChecks';
import {parseMarker} from '../lib/organization/marker';
import type {InviteLike} from '../lib/organization/bundle';
import type {ReconstructedOrganization} from '../lib/organization/reconstruct';
import {useOrganizations} from '../hooks/organization/useOrganizations';

/**
 * Which invite surface (if any) the currently pending invites ask for:
 * SPEC 7.1 — an invite carrying a valid Organization marker opens the single
 * Organization surface (the screen re-groups the invites into a bundle,
 * complete or not); otherwise the plain invite falls through to the legacy
 * per-project sheet. `undefined` = do nothing.
 *
 * A marker invite whose organization is ALREADY fully local (`ready`) asks
 * for nothing: its accept completed despite rejecting (Bug 46's
 * reject-but-completed), so re-opening the dismissed sheet here would loop
 * navigate ↔ dismiss forever. Every other organization's invites still
 * route, including a plain invite after a suppressed marker one.
 */
export function selectPendingInviteRoute(
  invites: ReadonlyArray<InviteLike>,
  currentRouteName: string | undefined,
  localOrganizations: ReadonlyArray<
    Pick<ReconstructedOrganization, 'organizationId' | 'state'>
  >,
): PendingInviteRoute | undefined {
  const pending = invites.filter(i => i.state === 'pending');
  if (pending.length === 0 || !currentRouteName) return undefined;

  // if user is already interacting with an invite, do nothing
  if (isInviteScreen(currentRouteName)) return undefined;

  if (isEditingScreen(currentRouteName)) return undefined;

  const readyOrganizations = new Set(
    localOrganizations
      .filter(org => org.state === 'ready')
      .map(org => org.organizationId),
  );

  let plainInviteId: string | undefined;
  for (const invite of pending) {
    const marker = parseMarker(invite.projectDescription ?? '');
    if (marker) {
      if (readyOrganizations.has(marker.organizationId)) continue;
      return {
        type: 'organization',
        organizationId: marker.organizationId,
        inviteId: invite.inviteId,
      };
    }
    plainInviteId ??= invite.inviteId;
  }

  return plainInviteId === undefined
    ? undefined
    : {type: 'plain', inviteId: plainInviteId};
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
  // Suspends like the invite list (rendered inside a Suspense boundary).
  const organizations = useOrganizations();

  useEffect(() => {
    const route = selectPendingInviteRoute(
      invites,
      currentRouteName,
      organizations,
    );
    if (!route) return;
    if (route.type === 'organization') {
      navigateToOrgInviteScreen(route.organizationId, route.inviteId);
    } else {
      navigateToInviteScreen(route.inviteId);
    }
  }, [
    invites,
    organizations,
    currentRouteName,
    navigateToInviteScreen,
    navigateToOrgInviteScreen,
  ]);
  return null;
};
