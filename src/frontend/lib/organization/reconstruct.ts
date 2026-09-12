import {isReservedMarker, parseMarker, SLOTS, type Slot} from './marker';

/**
 * SPEC 10: rebuild the Organizations of a device from local project state
 * alone — `listProjects()` rows, no per-project settings reads (no N+1).
 */
export type ReconstructedOrganization =
  | {
      state: 'ready';
      organizationId: string;
      organizationName: string | undefined;
      slots: Record<Slot, string>;
    }
  | {
      state: 'incomplete';
      organizationId: string;
      organizationName: string | undefined;
      slots: Partial<Record<Slot, string>>;
    }
  | {
      // Two local projects claim the same (organization, slot) — e.g. a
      // retried create or a hand-edited marker. Overwriting one id with the
      // other would route product actions to an arbitrary project while
      // reporting the org as fine, so the state is surfaced instead.
      state: 'invalid';
      organizationId: string;
      reason: 'duplicate-slot' | 'unsupported-marker';
      organizationName: string | undefined;
      slots: Partial<Record<Slot, string>>;
    };

/**
 * A local project row as `listProjects()` returns it — the only input this
 * module reads (SPEC 10). Named so callers that need the RAW rows (marker
 * provenance for a project id, below) share the same shape.
 *
 * `status: 'left'` is part of the row shape but NOT reachable through the
 * app's seam: `listProjects()` defaults to `{includeLeft: false}`
 * (node_modules/@comapeo/core/src/mapeo-manager.js:636) and only emits a
 * `left` row when a caller opts in (:680), so a left project is simply
 * missing from the array (:692). It is accepted here so the module stays
 * correct if a caller ever passes `includeLeft: true`.
 */
export type LocalProjectRow = {
  projectId: string;
  projectDescription?: string;
  status: 'joined' | 'joining' | 'left';
};

/**
 * What the LOCAL project rows say about where a project id came from (SPEC
 * 10.1 provenance), for callers that must tell a legacy/standalone id apart
 * from an organization slot the reconstruction above no longer reports:
 * - 'organization': the row carries a `coiab-org` marker, so the id is (or
 *   was) that organization's slot. Read regardless of join status — the
 *   marker survives a row that contributes no slot, which through this seam
 *   means a `joining` row (an invite accepted but never synced; see
 *   `LocalProjectRow` on why `left` rows do not arrive here).
 * - 'corrupt': the row CLAIMS the reserved `coiab-org:` namespace but does
 *   not parse (truncated, hand-edited, or a version this device cannot
 *   read). It is still ownership evidence — an internal project of SOME
 *   organization — so it must never be mistaken for a standalone project
 *   and switched across organizations (F8). Which organization it belongs
 *   to is unknowable, so the caller can only fail closed.
 * - 'unmarked': a project this device holds that never was a slot (the
 *   pre-org era, a standalone/debug project).
 * - 'absent': no row holds that id at all — the id is stale, OR the project
 *   was left/removed on this device. A leave KEEPS the project keys row
 *   with `hasLeftProject: true` and deletes only the project settings
 *   (node_modules/@comapeo/core/src/mapeo-manager.js:1007-1047 — the upsert
 *   at :1041, the settings delete at :1044-1047), but that row is invisible
 *   through this seam (see `LocalProjectRow`), so a left project reaches the
 *   app as ABSENT, with no marker left to trace it by. The id names nothing
 *   this device can operate, either way.
 */
export type ProjectProvenance =
  | {kind: 'absent'}
  | {kind: 'unmarked'}
  | {kind: 'corrupt'}
  | {kind: 'organization'; organizationId: string};

export function projectProvenance(
  projects: ReadonlyArray<LocalProjectRow>,
  projectId: string | undefined,
): ProjectProvenance {
  if (projectId === undefined) return {kind: 'absent'};
  const row = projects.find(project => project.projectId === projectId);
  if (!row) return {kind: 'absent'};
  const description = row.projectDescription ?? '';
  const marker = parseMarker(description);
  if (marker) {
    return {kind: 'organization', organizationId: marker.organizationId};
  }
  // Same call the reconstruction above makes for a joined row it cannot read
  // (`unsupported-marker`): the reserved namespace is claimed, so the row is
  // internal even though nothing here can say to which organization.
  return isReservedMarker(description) ? {kind: 'corrupt'} : {kind: 'unmarked'};
}

export function reconstructOrganizations(
  projects: ReadonlyArray<LocalProjectRow>,
): ReconstructedOrganization[] {
  const slotsByOrg = new Map<string, Partial<Record<Slot, string>>>();
  const namesByOrg = new Map<string, string>();
  const invalidOrgs = new Set<string>();
  // A description that claims the reserved `coiab-org:` namespace but does
  // not parse is a version/format the device cannot handle (SPEC 10.1):
  // surfacing it keeps the failure visible instead of silently treating an
  // internal project as unmarked.
  const unsupported = new Map<string, ReconstructedOrganization>();

  for (const project of projects) {
    // A `ProjectInfo` row only contributes a local slot while `joined`
    // (SPEC 3.10): `joining` and `left` rows keep their marker but hold no
    // local slot, so they are skipped — the org degrades to incomplete.
    if (project.status !== 'joined') continue;
    const description = project.projectDescription ?? '';
    const marker = parseMarker(description);
    if (!marker) {
      if (isReservedMarker(description)) {
        unsupported.set(description, {
          state: 'invalid',
          // No id exists yet — key by the raw description, deterministically.
          organizationId: description,
          reason: 'unsupported-marker',
          organizationName: undefined,
          slots: {},
        });
      }
      continue; // unmarked projects are ignored
    }
    const slots = slotsByOrg.get(marker.organizationId) ?? {};
    if (slots[marker.slot] !== undefined) {
      invalidOrgs.add(marker.organizationId);
    }
    slots[marker.slot] = project.projectId;
    slotsByOrg.set(marker.organizationId, slots);
    // Name resolution (SPEC 4.4): slot m wins; slot a fills the gap for an
    // org that has no m marker. Rename divergence is NOT an error.
    if (marker.slot === 'm' || !namesByOrg.has(marker.organizationId)) {
      namesByOrg.set(marker.organizationId, marker.organizationName);
    }
  }

  return [...slotsByOrg.keys(), ...unsupported.keys()]
    .sort()
    .map(organizationId => {
      const entry = unsupported.get(organizationId);
      if (entry) return entry;
      const slots = slotsByOrg.get(organizationId)!;
      const organizationName = namesByOrg.get(organizationId);
      if (invalidOrgs.has(organizationId)) {
        return {
          state: 'invalid' as const,
          organizationId,
          reason: 'duplicate-slot' as const,
          organizationName,
          slots,
        };
      }
      return SLOTS.every(slot => slots[slot] !== undefined)
        ? {
            state: 'ready' as const,
            organizationId,
            organizationName,
            slots: slots as Record<Slot, string>,
          }
        : {
            state: 'incomplete' as const,
            organizationId,
            organizationName,
            slots,
          };
    });
}
