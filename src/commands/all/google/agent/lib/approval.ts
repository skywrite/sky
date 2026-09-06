import { resolveFileRef } from '#lib/google/mod.ts'

/**
 * When a mission needs the person's go, and what a go covers.
 *
 * A mission that only creates — a doc from the mission's own content, a
 * deck, a sheet — touches nothing of the person's, so it runs without
 * asking. A mission aimed at an existing file (`file`) changes something
 * that already exists, and an import uploads a local file to Drive; both
 * ask. A go for a targeted mission covers that file: later missions on the
 * same file id run without asking for the rest of the session.
 */
export function missionNeedsApproval(input: Record<string, unknown>): boolean {
  return typeof input.file === 'string' || typeof input.import === 'string'
}

/** The stable key a targeted mission's approval scopes to — its file id. */
export function missionApprovalKey(input: Record<string, unknown>): string | undefined {
  if (typeof input.file !== 'string') return undefined
  return resolveFileRef(input.file)?.fileId
}
