import {useMemo} from 'react';
import {useManyProjects} from '@comapeo/core-react';

import {
  reconstructOrganizations,
  type ReconstructedOrganization,
} from '../../lib/organization/reconstruct';
import {useActiveProjectId} from '../../contexts/ActiveProjectIdStoreContext';

/**
 * The Organizations of this device, reconstructed from the local project
 * list (SPEC 10). Suspends while the project list loads — use inside a
 * Suspense boundary, like the other `@comapeo/core-react` queries.
 */
export function useOrganizations(): ReconstructedOrganization[] {
  const {data: projects} = useManyProjects();

  return useMemo(() => reconstructOrganizations(projects), [projects]);
}

type ReadyOrganization = Extract<ReconstructedOrganization, {state: 'ready'}>;

/**
 * The organization product actions should act on (SPEC 8.6): the ready
 * organization the active project belongs to — either slot, since a
 * reactivation can land on Alertas too (SPEC 8.6's fallback) — else the
 * first ready one, else the first incomplete one. `undefined` when the
 * device holds no organization at all.
 */
export function usePrimaryOrganization():
  ReconstructedOrganization | undefined {
  const organizations = useOrganizations();
  const activeProjectId = useActiveProjectId();

  return useMemo(() => {
    const readyOrganizations = organizations.filter(
      (org): org is ReadyOrganization => org.state === 'ready',
    );
    return (
      readyOrganizations.find(
        org =>
          org.slots.m === activeProjectId || org.slots.a === activeProjectId,
      ) ??
      readyOrganizations[0] ??
      organizations.find(org => org.state === 'incomplete') ??
      undefined
    );
  }, [organizations, activeProjectId]);
}
