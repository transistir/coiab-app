/** Includes stopped/unsaved tracks and work before its first core mutation. */
export function hasPendingOrganizationWork({
  draft,
  track,
  media,
  mutations,
  invites,
  archive,
}: {
  draft?: {value?: unknown};
  track?: {
    isTracking?: boolean;
    projectId?: string;
    originStatus?: 'legacy' | 'unresolved';
    docId?: string | null;
    description?: string;
    preset?: unknown;
    locationHistory?: unknown[];
    observationRefs?: unknown[];
  };
  media?: boolean;
  mutations?: number;
  invites?: boolean;
  archive?: boolean;
}): boolean {
  return !!(
    draft?.value ||
    track?.isTracking ||
    track?.projectId ||
    track?.originStatus === 'unresolved' ||
    track?.docId ||
    track?.description ||
    track?.preset ||
    track?.locationHistory?.length ||
    track?.observationRefs?.length ||
    media ||
    mutations ||
    invites ||
    archive
  );
}
