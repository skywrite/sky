/**
 * What each front matter key is, for the panel: the control it gets, where its completions come
 * from, and the shape it is written in. Keys the notebook uses the most are named; anything else
 * is text, a list of chips, or a map of sub-rows by its YAML shape.
 */

export type RowKind =
  | 'people'
  | 'tags'
  | 'rel'
  | 'orgs'
  | 'places'
  | 'files'
  | 'date'
  | 'picker'
  | 'text'
  | 'long'
  | 'auto'
  | 'list'
  | 'map'

/** Keys with a kind of their own, whatever directory the document is in. */
const KINDS: Record<string, RowKind> = {
  tags: 'tags',
  rel: 'rel',
  who: 'people',
  from: 'people',
  to: 'people',
  cc: 'people',
  org: 'orgs',
  where: 'places',
  attachments: 'files',
  when: 'date',
  met: 'date',
  date: 'date',
  started: 'date',
  ended: 'date',
  created: 'auto',
  updated: 'auto',
  firstVisited: 'auto',
  medium: 'picker',
  type: 'picker',
  status: 'picker',
  kind: 'picker',
  sector: 'picker',
  subcategory: 'picker',
  cadence: 'picker',
  importance: 'picker',
  genre: 'picker',
  provider: 'picker',
  model: 'picker',
  tz: 'picker',
  summary: 'long',
  context: 'long',
  question: 'long',
  ask: 'long',
  description: 'long',
}

/** Kinds whose value is a list of chips. */
export const CHIP_KINDS: ReadonlySet<RowKind> = new Set(['people', 'tags', 'rel', 'orgs', 'places', 'list'])

/** Kinds that complete from the notebook's entities, and which completion they ask for. */
export const ENTITY_KINDS: Partial<Record<RowKind, 'people' | 'tags' | 'rel' | 'orgs' | 'places'>> = {
  people: 'people',
  tags: 'tags',
  rel: 'rel',
  orgs: 'orgs',
  places: 'places',
}

/** The kind of a key, given the YAML shape its value has. */
export function kindOf(key: string, shape: 'scalar' | 'seq' | 'map' | 'missing'): RowKind {
  const named = KINDS[key]
  if (shape === 'map') return 'map'
  if (named) return named
  if (shape === 'seq') return 'list'
  return 'text'
}

/** The keys a document in a directory usually has, in the order the panel suggests them. */
const SUGGESTED: Record<string, string[]> = {
  time: ['when', 'who', 'from', 'to', 'cc', 'medium', 'where', 'tags', 'rel', 'attachments', 'summary', 'context'],
  people: ['name', 'alt', 'org', 'title', 'email', 'phone', 'location', 'met', 'sites', 'tags', 'rel'],
  orgs: ['name', 'sector', 'subcategory', 'site', 'tags', 'rel', 'summary'],
  projects: ['name', 'status', 'who', 'tags', 'rel', 'summary', 'context'],
  places: ['name', 'address', 'site', 'phone', 'firstVisited', 'type', 'tags'],
  library: ['title', 'author', 'url', 'tags', 'rel', 'summary'],
  journal: ['when', 'tags', 'rel'],
  things: ['title', 'author', 'genre', 'cadence', 'importance', 'tags', 'rel'],
}

export function suggestedKeys(dir: string): string[] {
  return SUGGESTED[dir] ?? ['tags', 'rel']
}

/** The type mark shown before an entity chip. */
export const TYPE_MARKS: Record<string, string> = {
  person: '◉',
  project: '◆',
  org: '▣',
  place: '⌂',
  library: '▤',
  day: '▦',
}

/** Where a row lives: on the identity line under the title, folded below it, or in the rail. */
export type Home = 'identity' | 'below' | 'rail'

export function homeOf(kind: RowKind): Home {
  switch (kind) {
    case 'date':
    case 'people':
    case 'picker':
    case 'places':
    case 'orgs':
    case 'text':
      return 'identity'
    case 'long':
      return 'below'
    default:
      return 'rail'
  }
}

/** The rail section a rail row belongs to. */
export type RailSection = 'tags' | 'links' | 'files' | 'document'

export function railSectionOf(kind: RowKind): RailSection {
  if (kind === 'tags') return 'tags'
  if (kind === 'rel') return 'links'
  if (kind === 'files') return 'files'
  return 'document'
}
