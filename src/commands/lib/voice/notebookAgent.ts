/** Notebook answer shape and source labels for voice research. */

import { ACTIONS_DIR, ACTION_KIND_DIRS, AI_CHATS_DIR, toTimeRef } from '#shared/nbfs/mod.ts'

export interface NotebookAnswer {
  answer: string
  /** Documents actually included in the research context. */
  paths: string[]
}

const KIND_LABELS: Record<string, string> = {
  journal: 'Journal',
  [ACTION_KIND_DIRS.meeting]: 'Meeting',
  [ACTION_KIND_DIRS.message]: 'Message',
  [AI_CHATS_DIR]: 'AI chat',
  [ACTION_KIND_DIRS.note]: 'Note',
  [ACTION_KIND_DIRS.event]: 'Event',
  [ACTION_KIND_DIRS.googleDoc]: 'Google doc',
  decisions: 'Decision',
  ideas: 'Idea',
}

/** The kind folder a day-relative path under actions/ starts with, or its first segment. */
function actionKindDirOf(segments: string[]): string {
  const rest = segments.join('/')
  return Object.values(ACTION_KIND_DIRS).find((dir) => rest === dir || rest.startsWith(`${dir}/`)) ?? segments[0] ?? ''
}

/**
 * Human-readable heading for a notebook document, derived from its path:
 * kind and calendar date instead of cryptic path segments. The delegate
 * model attributes facts to dates far more reliably when every document
 * announces its own — raw paths like `time/2026/W32/08-05/...` got
 * separate days fused into one misdated narrative.
 */
export function describeNotebookPath(path: string): string {
  const parts = path.split('/')
  const file = (parts.at(-1) ?? '').replace(/\.md$/, '')

  const peopleIdx = parts.indexOf('people')
  if (peopleIdx >= 0) return `Person profile — ${file}`

  // Any time-tree layout: toTimeRef canonicalizes the path to its date,
  // including v1.1's year-boundary artifacts (12/29-04 holding 01-02).
  const timeIdx = parts.indexOf('time')
  if (timeIdx >= 0) {
    try {
      const ref = toTimeRef(parts.slice(timeIdx).join('/'))
      const [ymd, ...sub] = ref.split('/')
      const kindDir = sub[0] === ACTIONS_DIR ? actionKindDirOf(sub.slice(1)) : (sub[0] ?? '')
      const kind = KIND_LABELS[kindDir] ?? (kindDir ? kindDir.charAt(0).toUpperCase() + kindDir.slice(1) : 'Document')
      return `${kind} — ${ymd} — ${file}`
    } catch {
      // Not a day path (year-level docs, malformed) — fall through to raw.
    }
  }

  return path
}
