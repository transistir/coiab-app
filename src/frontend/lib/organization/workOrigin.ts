/**
 * Refuses a core write whose persisted work belongs to another project
 * (SPEC A CA09): after an organization switch, a draft or stopped track
 * stamped with project A is never written into project B.
 *
 * Work persisted BEFORE the organization layer carries no origin at all. An
 * absent stamp is not a mismatch — treating it as one would strand pending
 * work of everyone who upgrades the app mid-draft, with no way to save it
 * even inside its original project. Only an EXPLICIT, different origin
 * refuses the write.
 */
export function assertWorkOrigin(
  origem: string | undefined,
  projectId: string,
): void {
  if (origem && origem !== projectId) {
    throw new Error('work-origin-mismatch');
  }
}
