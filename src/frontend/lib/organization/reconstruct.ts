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
 *   marker survives a `joining`/`left` row, which contributes no slot.
 * - 'unmarked': a project this device holds that never was a slot (the
 *   pre-org era, a standalone/debug project).
 * - 'absent': no row holds that id at all. Either the project was removed
 *   from the device (a leave deletes the row outright — CoMapeo core does
 *   not keep a `left` row for a local leave) or the id is stale. The id
 *   names nothing this device can operate, either way.
 */
export type ProjectProvenance =
  | {kind: 'absent'}
  | {kind: 'unmarked'}
  | {kind: 'organization'; organizationId: string};

export function projectProvenance(
  projects: ReadonlyArray<LocalProjectRow>,
  projectId: string | undefined,
): ProjectProvenance {
  if (projectId === undefined) return {kind: 'absent'};
  const row = projects.find(project => project.projectId === projectId);
  if (!row) return {kind: 'absent'};
  const marker = parseMarker(row.projectDescription ?? '');
  return marker
    ? {kind: 'organization', organizationId: marker.organizationId}
    : {kind: 'unmarked'};
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
