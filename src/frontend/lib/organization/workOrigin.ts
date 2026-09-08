/** An absent project is legacy only when a persisted-version migration says so. */
export type WorkOrigin = {
  projectId?: string;
  originStatus?: 'legacy' | 'unresolved';
};

export function newWorkOrigin(projectId: string | undefined): WorkOrigin {
  return projectId?.trim() ? {projectId} : {originStatus: 'unresolved'};
}

/** Only pre-origin payload versions may call this migration. */
export function migrateWorkOrigin<T extends WorkOrigin>(state: T): T {
  if (state.projectId?.trim() || state.originStatus) return state;
  return {
    ...state,
    originStatus: state.projectId === undefined ? 'legacy' : 'unresolved',
  };
}

/** Refuse unknown/new origins and writes into a different project (SPEC A CA09). */
export function assertWorkOrigin(
  origem: string | null | undefined,
  projectId: string,
  originStatus?: WorkOrigin['originStatus'],
): void {
  if (originStatus === 'unresolved') throw new Error('work-origin-unresolved');
  if (!origem?.trim()) {
    if (originStatus === 'legacy') return;
    throw new Error('work-origin-unresolved');
  }
  if (origem !== projectId) throw new Error('work-origin-mismatch');
}
