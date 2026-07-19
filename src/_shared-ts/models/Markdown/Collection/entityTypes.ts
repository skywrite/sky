/**
 * Entity types for markdown document collections.
 *
 * Used for:
 * - Detecting document type from file path
 * - Sorting documents in output (lower priority = earlier in output)
 * - Type hints when creating collections
 */

/** Entity type for collection items */
export type CollectionEntityType =
  | 'org'
  | 'person'
  | 'project'
  | 'decision'
  | 'goal'
  | 'idea'
  | 'place'
  | 'message'
  | 'meeting'
  | 'video'
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
 * 2. Decisions and goals - strategic context
 * 3. Activity (messages, meetings, journals) - chronological content
 * 4. Day files and generic documents - catch-all
 */
export const ENTITY_TYPE_PRIORITY: Record<CollectionEntityType, number> = {
  org: 0,
  person: 1,
  project: 2,
  decision: 3,
  goal: 4,
  idea: 5,
  place: 6,
  message: 7,
  meeting: 8,
  video: 9,
  journal: 10,
  chat: 11,
  document: 12,
  day: 13,
}

/**
 * Path patterns for detecting entity type.
 * Checked in order - first match wins.
 */
const PATH_PATTERNS: Array<{ pattern: RegExp | ((path: string) => boolean); type: CollectionEntityType }> = [
  { pattern: (p) => p.includes('/orgs/') || p.includes('/organizations/'), type: 'org' },
  { pattern: (p) => p.includes('/people/') || p.includes('/people-'), type: 'person' },
  // Only the canonical _project/ files (overview.md) are projects. The
  // second entry is a terminal catch-all: other files in a project folder
  // are plain documents, and must not fall through to later patterns via
  // subdir names like .../meetings/ or .../slides/.
  { pattern: (p) => p.includes('/projects/') && p.includes('/_project/'), type: 'project' },
  { pattern: (p) => p.includes('/projects/'), type: 'document' },
  { pattern: (p) => p.includes('/decisions/'), type: 'decision' },
  { pattern: (p) => p.includes('/goals/'), type: 'goal' },
  { pattern: (p) => p.includes('/ideas/'), type: 'idea' },
  { pattern: (p) => p.includes('/places/'), type: 'place' },
  { pattern: (p) => p.includes('/messages/') || p.includes('/slack/') || p.includes('/email/'), type: 'message' },
  { pattern: (p) => p.includes('/meeting/') || p.includes('/meetings/'), type: 'meeting' },
  { pattern: (p) => p.includes('/videos/'), type: 'video' },
  { pattern: (p) => p.includes('/journal/'), type: 'journal' },
  { pattern: (p) => p.includes('/ai-chats/'), type: 'chat' },
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
