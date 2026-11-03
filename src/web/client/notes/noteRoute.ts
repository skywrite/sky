/**
 * A note's page lives under its day, the way a meeting's does: `/2026-10-28/notes/Atlas-launch-plan`,
 * the file's name without `.md`. `/2026-10-28/notes/new` is a blank note that has no file yet.
 */

export const NEW_NOTE = 'new'

export interface NoteRoute {
  ymd: string
  /** The file's name without `.md`, or `new` for a blank note */
  slug: string
}

/** The note a path names; null for any other path. */
export function noteRouteOf(pathname: string): NoteRoute | null {
  const match = /^\/(\d{4}-\d{2}-\d{2})\/notes\/([^/]+)$/.exec(pathname)
  if (!match) return null
  try {
    return { ymd: match[1]!, slug: decodeURIComponent(match[2]!) }
  } catch {
    return null
  }
}

export function noteHref(ymd: string, slug: string): string {
  return `/${ymd}/notes/${encodeURIComponent(slug)}`
}

/**
 * The page for a note filed under a day, from its notebook path; null for any other file, which
 * opens in the explorer. The day folder carries its own month, whichever way the weeks are named.
 */
export function noteHrefOf(path: string): string | null {
  const match = /^time\/(\d{4})\/(?:[^/]+\/){1,2}(\d{2})-(\d{2})\/actions\/notes\/([^/]+)\.md$/.exec(path)
  return match ? noteHref(`${match[1]}-${match[2]}-${match[3]}`, match[4]!) : null
}
