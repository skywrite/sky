/**
 * Entity types for markdown document collections.
 *
 * Used for:
 * - Detecting document type from file path
 * - Sorting documents in output (lower priority = earlier in output)
 * - Type hints when creating collections
 */

import { isAIChatPath, isActionPath } from '#shared/nbfs/mod.ts'

/** Entity type for collection items */
export type CollectionEntityType =
  | 'org'
  | 'person'
  | 'project'
  | 'decision'
  | 'goal'
  | 'streak'
  | 'tracking'
  | 'idea'
  | 'place'
  | 'memory'
  | 'message'
  | 'meeting'
  | 'video'
  | 'recap'
  | 'journal'
  | 'chat'
  | 'day'
  | 'document'

/** An item in the collection */
export interface CollectionItem<T = unknown> {
  doc: T
  path: string
  type: CollectionEntityType
  /** 0 = root (explicitly added), 1+ = relationship traversal depth */
  depth: number
}

/**
 * Priority order for sorting documents in output.
 * Lower numbers appear earlier in the output.
 *
 * Order rationale:
 * 1. Entities (org, person, project) - context about who/what
 * 2. Decisions, goals, and AI memory - standing strategic context
 * 3. Activity (messages, meetings, journals) - chronological content
 * 4. Day files and generic documents - catch-all
 */
export const ENTITY_TYPE_PRIORITY: Record<CollectionEntityType, number> = {
  org: 0,
  person: 1,
  project: 2,
  decision: 3,
  goal: 4,
  memory: 5,
  streak: 6,
  tracking: 7,
  idea: 8,
  place: 9,
  message: 10,
  meeting: 11,
  video: 12,
  recap: 13,
  journal: 14,
  chat: 15,
  document: 16,
  day: 17,
}

/**
 * Path patterns for detecting entity type.
 * Checked in order - first match wins.
 */
const PATH_PATTERNS: Array<{ pattern: RegExp | ((path: string) => boolean); type: CollectionEntityType }> = [
  // library/ is topic-organized reference material; its subject dirs may
  // shadow entity dir names (library/ideas/, library/things/), so it must
  // claim its paths before any entity pattern can.
  { pattern: (p) => p.includes('/library/'), type: 'document' },
  // The AI's cross-session memory notes. Only ai/memory/ is typed — other
  // future ai/ subdirs fall through to 'document'.
  { pattern: (p) => p.includes('/ai/memory/'), type: 'memory' },
  { pattern: (p) => p.includes('/orgs/') || p.includes('/organizations/'), type: 'org' },
  { pattern: (p) => p.includes('/people/') || p.includes('/people-'), type: 'person' },
  // Only the canonical _project/overview.md is the project itself — the
  // _project/ dir also holds log.md/assets.md, which are documents. The
  // second entry is a terminal catch-all: other files in a project folder
  // are plain documents, and must not fall through to later patterns via
  // subdir names like .../meetings/ or .../slides/.
  { pattern: (p) => p.includes('/projects/') && p.endsWith('/_project/overview.md'), type: 'project' },
  { pattern: (p) => p.includes('/projects/'), type: 'document' },
  { pattern: (p) => p.includes('/decisions/'), type: 'decision' },
  { pattern: (p) => p.includes('/goals/'), type: 'goal' },
  { pattern: (p) => p.includes('/streaks/'), type: 'streak' },
  // Definitions only — record CSVs live outside the corpus; the guard keeps
  // a stray md under any data/ tracking dir from masquerading as a definition.
  { pattern: (p) => p.includes('/tracking/') && !p.includes('/data/'), type: 'tracking' },
  { pattern: (p) => p.includes('/ideas/'), type: 'idea' },
  { pattern: (p) => p.includes('/places/'), type: 'place' },
  { pattern: (p) => isActionPath('message', p) || p.includes('/slack/') || p.includes('/email/'), type: 'message' },
  { pattern: (p) => p.includes('/meeting/') || isActionPath('meeting', p), type: 'meeting' },
  { pattern: (p) => isActionPath('video', p), type: 'video' },
  { pattern: (p) => isActionPath('recap', p), type: 'recap' },
  { pattern: (p) => p.includes('/journal/'), type: 'journal' },
  // Saved chats: the kind folders are named once, in nbfs, and the checks live beside the names.
  { pattern: isAIChatPath, type: 'chat' },
  { pattern: (p) => p.endsWith('/day.md') || p.endsWith('/_day.md'), type: 'day' },
]

/**
 * Detect entity type from file path.
 *
 * @param path - File path to analyze
 * @returns Detected entity type, or 'document' if no pattern matches
 *
 * @example
 * detectTypeFromPath('/people/john.md')           // 'person'
 * detectTypeFromPath('/decisions/2026/01/foo.md') // 'decision'
 * detectTypeFromPath('/random/file.md')           // 'document'
 */
export function detectTypeFromPath(path: string): CollectionEntityType {
  for (const { pattern, type } of PATH_PATTERNS) {
    if (typeof pattern === 'function') {
      if (pattern(path)) return type
    } else {
      if (pattern.test(path)) return type
    }
  }
  return 'document'
}
