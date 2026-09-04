/**
 * Replicas of the `@comapeo/core-react` internal query-key factories
 * (12.0.3 `dist/esm/lib/react-query.js`). They live in a non-exported module
 * (the package exports map allows only the root), but the Organization hooks
 * mutate core state through direct `clientApi` calls, which bypass
 * core-react's own invalidation — so they must invalidate these exact keys
 * to keep mounted queries (`useOrganizations`, the startup gate, member
 * lists) fresh. Keep in sync with the installed core-react version: drift
 * silently disables cache invalidation.
 *
 * react-query invalidation is prefix-based, so the members key below matches
 * both the plain and the `{includeLeft}` variants.
 */
const ROOT_QUERY_KEY = '@comapeo/core-react';

export const projectsQueryKey = [ROOT_QUERY_KEY, 'projects'] as const;

export const invitesQueryKey = [ROOT_QUERY_KEY, 'invites'] as const;

export const membersQueryKey = (projectId: string) =>
  [ROOT_QUERY_KEY, 'projects', projectId, 'members'] as const;
