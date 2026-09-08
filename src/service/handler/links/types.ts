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
  /** Geographic context distinguishes places with the same name. */
  hint?: string
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
