/**
 * The Organization marker stored in `projectDescription` of the two internal
 * projects of a COIAB Organization (SPEC-46 §4.1).
 *
 *   coiab-org:v1:<organizationId>:<slot>:<name>
 *
 * - `organizationId`: exactly 16 lowercase hex chars.
 * - `slot`: `m` (Monitoramento) or `a` (Alertas).
 * - `name`: `encodeURIComponent(organizationName)` — never contains a literal
 *   `:`, so the marker always splits into exactly 5 segments.
 *
 * Dependency-free on purpose: this file is imported by the React Native app
 * AND by node integration tests. No expo, react, or node imports here.
 */

export type Slot = 'm' | 'a';

export const SLOTS = ['m', 'a'] as const;

export const SLOT_PROJECT_NAMES: Record<Slot, string> = {
  m: 'Monitoramento',
  a: 'Alertas',
};

export type OrgMarker = {
  organizationId: string;
  slot: Slot;
  organizationName: string;
};

export const ORGANIZATION_ID_PATTERN = /^[0-9a-f]{16}$/;

/**
 * SPEC 4.1: a create/rename must never mint a marker that cannot be parsed
 * back, so a malformed organization id is rejected here exactly as
 * `parseMarker` would reject it — and a nameless organization has nothing to
 * display anywhere — whitespace-only names are rejected too.
 */
export function markerFor(
  organizationId: string,
  slot: Slot,
  organizationName: string,
): string {
  if (!ORGANIZATION_ID_PATTERN.test(organizationId)) {
    throw new Error('organization id must be 16 lowercase hex chars');
  }
  if (organizationName.trim().length === 0) {
    throw new Error('organization name must not be empty or whitespace');
  }
  return `coiab-org:v1:${organizationId}:${slot}:${encodeURIComponent(organizationName)}`;
}

/**
 * Strict parse: exactly 5 colon-separated segments, literal `coiab-org` +
 * `v1`, a 16-char lowercase-hex organization id, a valid slot, and a
 * non-empty name that decodes as percent-encoding — the same checks
 * `markerFor` enforces when minting (SPEC 4.1, validation symmetry).
 * Anything else invalid → undefined.
 */
export function parseMarker(description: string): OrgMarker | undefined {
  const segments = description.split(':');
  if (segments.length !== 5) return undefined;
  const [prefix, version, organizationId, slot, encodedName] = segments as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (prefix !== 'coiab-org' || version !== 'v1') return undefined;
  if (!ORGANIZATION_ID_PATTERN.test(organizationId)) return undefined;
  if (slot !== 'm' && slot !== 'a') return undefined;
  if (encodedName.length === 0) return undefined; // nothing emits a nameless marker
  let organizationName: string;
  try {
    organizationName = decodeURIComponent(encodedName);
  } catch {
    return undefined;
  }
  // Symmetry with `markerFor`: a minted marker never carries a whitespace-only
  // name, so a parsed one must not either.
  if (organizationName.trim().length === 0) return undefined;
  return {organizationId, slot, organizationName};
}

/** A description claims the Organization marker namespace (SPEC 10.1). */
export function isReservedMarker(description: string): boolean {
  return description.startsWith('coiab-org:');
}

/** A project description holds an Organization marker (internal project). */
export function isInternalOrgProject(description: string | undefined): boolean {
  return parseMarker(description ?? '') !== undefined;
}
