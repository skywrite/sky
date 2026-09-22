export type LinkKind =
  | 'video'
  | 'meeting'
  | 'chat'
  | 'message'
  | 'journal'
  | 'note'
  | 'day'
  | 'person'
  | 'org'
  | 'project'
  | 'place'
  | 'library'

export const PRIMARY_LINK_KINDS: readonly LinkKind[] = ['person', 'org', 'project']

/** A notebook reference, with enough context to choose the right record. */
export interface LinkItem {
  value: string
  path: string
  title: string
  /** Other names the record answers to; selections retain the canonical value. */
  aliases?: string[]
  kind: LinkKind
  date?: string
  people?: string
  summary?: string
  /** Distinct indexed records linking to this person, org, or project. */
  linkCount?: number
  /** Promoted into the frequently linked section of an unqueried search. */
  frequent?: boolean
  /** Geographic context distinguishes places with the same name. */
  hint?: string
  /** A known country becomes a notebook record when selected. Search itself never writes. */
  needsCreation?: boolean
  parent?: { path: string; title: string; turn: number }
}

export interface LinkSearch {
  items: LinkItem[]
  total: number
  today: string
}

export interface ImportLinksHost {
  validate: (values: string[]) => Promise<void>
  update: (file: string, add: string[], remove: string[]) => Promise<void>
}
