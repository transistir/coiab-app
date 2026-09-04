import {parseMarker} from './marker';
import type {InviteLike} from './bundle';

/**
 * P5 O1: which invite surface a deep-linked invite id must open — an invite
 * carrying a valid Organization marker routes to the single Organization
 * surface (SPEC 7.1); any other invite found in the list falls through to
 * the legacy per-project sheet. An invite the list does not (yet) know
 * resolves to `undefined` so the caller waits for the invite list to update
 * instead of guessing the legacy surface for a marker invite that has not
 * arrived yet.
 */
export function resolveDeepLinkInviteTarget(
  invites: ReadonlyArray<InviteLike>,
  inviteId: string,
): 'organization' | 'legacy' | undefined {
  const invite = invites.find(invite => invite.inviteId === inviteId);
  if (!invite) return undefined;
  return parseMarker(invite.projectDescription ?? '')
    ? 'organization'
    : 'legacy';
}
