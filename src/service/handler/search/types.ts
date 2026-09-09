export const SEARCH_KINDS = [
  'person',
  'org',
  'place',
  'day',
  'project',
  'meeting',
  'video',
  'chat',
  'message',
  'journal',
  'note',
  'library',
  'goal',
  'decision',
  'idea',
  'streak',
  'tracking',
] as const

export type SearchKind = (typeof SEARCH_KINDS)[number]
export type SearchFilter = SearchKind | 'all' | 'more'

export interface SearchResult {
  relativePath: string
  href: string
  title: string
  kind: SearchKind
  date?: string
  subtitle?: string
  snippet?: string
  properties: Array<{ label: string; value: string }>
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  total: number
  offset: number
  today: string
  day?: SearchResult
  dayItems: SearchResult[]
}

export interface SearchScoring {
  personScores: Map<string, { score: number }>
  orgScores: Map<string, { score: number }>
}
