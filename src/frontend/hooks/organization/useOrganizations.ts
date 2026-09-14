import {useEffect, useMemo} from 'react';
import {useManyProjects} from '@comapeo/core-react';

import {
  reconstructOrganizations,
  type ReconstructedOrganization,
} from '../../lib/organization/reconstruct';
import {clearOrganizationCreationProvenance} from '../../lib/organization/creationProvenance';
import {useActiveProjectId} from '../../contexts/ActiveProjectIdStoreContext';

/**
 * The Organizations of this device, reconstructed from the local project
 * list (SPEC 10). Suspends while the project list loads — use inside a
 * Suspense boundary, like the other `@comapeo/core-react` queries.
 */
export function useOrganizations(): ReconstructedOrganization[] {
  const {data: projects} = useManyProjects();

  const organizations = useMemo(
    () => reconstructOrganizations(projects),
    [projects],
  );

  // Provenance reconciliation (SPEC 5/E7): a creation provenance record
  // means "a create was interrupted here". If reconstruction sees the whole
  // organization (both slots present), the creation in fact completed — the
  // record is stale (e.g. the app died between fan-out completion and its
  // cleanup) and must be cleared now, so a later slot removal can never be
  // "concluded" by fabricating a replacement project. Genuinely incomplete
  // organizations keep their record and the conclude-creation offer.
  useEffect(() => {
    for (const organization of organizations) {
      if (organization.state === 'ready') {
        clearOrganizationCreationProvenance(organization.organizationId);
      }
    }
  }, [organizations]);

  return organizations;
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
