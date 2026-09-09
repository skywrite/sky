import * as path from 'node:path'
import type Document from '#shared/models/Markdown/Document/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import parseTimePath from '#shared/nbfs/parseTimePath.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { explorerHref } from '../explorer/mod.ts'
import { docDate, docTitle } from '../home/docMeta.ts'
import { isPathWithinRoot, isPathWithinRoots } from '../markdown-preview/request.ts'
import {
  SEARCH_KINDS,
  type SearchFilter,
  type SearchKind,
  type SearchResponse,
  type SearchResult,
  type SearchScoring,
} from './types.ts'

interface Entry {
  result: SearchResult
  absolute: string
  names: string[]
  metadata: string
  body: string
  normalizedBody: string
}

const cache = new WeakMap<MarkdownStore, { version: number; base: string; entries: Entry[] }>()
const primaryKinds = new Set(['person', 'org', 'place', 'day'])
const entityKinds = new Set(['person', 'org', 'place', 'project', 'goal', 'decision', 'idea', 'streak', 'tracking'])

function strings(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  return Array.isArray(value) ? value.flatMap(strings) : []
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_–—-]+/g, ' ')
    .trim()
}

function kindOf(file: string, fallback: SearchKind): SearchKind {
  if (fallback !== 'note') return fallback
  if (path.basename(file) === 'day.md' && parseTimePath(file)?.kind === 'day') return 'day'
  for (const [pattern, kind] of [
    [/\/ai-chats\//, 'chat'],
    [/\/(?:actions\/)?meetings\/|\/(?:[^/]*_)?meeting_/, 'meeting'],
    [/\/(?:actions\/)?videos\/|\/(?:[^/]*_)?video_/, 'video'],
    [/\/(?:actions\/)?messages\/|\/(?:email|slack|message)_/i, 'message'],
    [/\/journals\/|\/journal_/, 'journal'],
  ] as const)
    if (pattern.test(file)) return kind
  return fallback
}

function properties(doc: Document): SearchResult['properties'] {
  const labels = [
    ['role', 'Role'],
    ['org', 'Organization'],
    ['organization', 'Organization'],
    ['email', 'Email'],
    ['where', 'Place'],
    ['who', 'People'],
    ['from', 'From'],
    ['status', 'Status'],
    ['rel', 'Links'],
    ['tags', 'Tags'],
  ] as const
  return labels
    .flatMap(([key, label]) => {
      const value = strings(doc.yaml[key]).join(', ')
      return value ? [{ label, value }] : []
    })
    .slice(0, 7)
}

function entriesOf(store: MarkdownStore, base: string): Entry[] {
  const saved = cache.get(store)
  if (saved?.version === store.version && saved.base === base) return saved.entries
  const sources = [
    [store.people.getAll(), 'person'],
    [store.orgs.getAll(), 'org'],
    [store.places.getAll(), 'place'],
    [store.projects.getAll(), 'project'],
    [store.projects.getDocuments(), 'note'],
    [store.goals.getAll(), 'goal'],
    [store.decisions.getAll(), 'decision'],
    [store.ideas.getAll(), 'idea'],
    [store.streaks.getAll(), 'streak'],
    [store.tracking.getAll(), 'tracking'],
    [store.time.getAll(), 'note'],
    [store.library.getAll(), 'library'],
    [store.ai.getAll(), 'note'],
  ] as const
  const seen = new Set<string>()
  const entries: Entry[] = []
  for (const [source, fallback] of sources) {
    for (const { doc, path: absolute } of source.getAllItems()) {
      if (seen.has(absolute) || !isPathWithinRoot(absolute, base)) continue
      seen.add(absolute)
      const relativePath = path.relative(base, absolute)
      const kind = kindOf(relativePath, fallback)
      const date = parseTimePath(relativePath)?.start.toString() ?? docDate(doc, absolute)?.ymd
      const names = [...strings(doc.yaml['name']), ...strings(doc.yaml['aliases']), ...strings(doc.yaml['alt'])]
      const title =
        kind === 'day' && date
          ? `${new PlainDate(date).dayLong} · ${date}`
          : entityKinds.has(kind)
            ? (names[0] ?? docTitle(doc, absolute))
            : docTitle(doc, absolute)
      const props = properties(doc)
      const subtitle = [
        ...strings(doc.yaml['role']),
        ...strings(doc.yaml['org']),
        ...strings(doc.yaml['where']),
        ...strings(doc.yaml['who']),
        ...strings(doc.yaml['summary']),
      ]
        .filter((value) => value !== title)
        .join(' · ')
        .slice(0, 240)
      const body = doc.markdown
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/^\s*```[^\n]*$/gm, '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s*)?)/gm, '')
        .replace(/[*`~]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      entries.push({
        absolute,
        result: {
          relativePath,
          href: kind === 'day' && date ? `/${date}` : explorerHref(relativePath),
          title,
          kind,
          date,
          subtitle: subtitle || undefined,
          properties: props,
        },
        names: [...new Set([title, ...names].map(normalize))],
        metadata: normalize(`${relativePath} ${date ?? ''} ${JSON.stringify(doc.yaml)}`),
        body,
        normalizedBody: normalize(doc.markdown),
      })
    }
  }
  cache.set(store, { version: store.version, base, entries })
  return entries
}

/** Relative days use notebook time, never the browser's timezone. */
export function searchDate(query: string, today: PlainDate): PlainDate | undefined {
  const q = query.trim().toLowerCase()
  if (q === 'today') return today
  if (q === 'yesterday') return today.addDays(-1)
  if (q === 'tomorrow') return today.addDays(1)
  const weekday = /^(?:(last|next) )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.exec(q)
  if (weekday) {
    const target =
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].indexOf(weekday[2]!) + 1
    let delta = (target - today.dayOfWeek + 7) % 7
    if (weekday[1] === 'next') delta ||= 7
    else if (delta > 0 || weekday[1] === 'last') delta -= 7
    return today.addDays(delta)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q)) return undefined
  try {
    return new PlainDate(q)
  } catch {
    return undefined
  }
}

function score(entry: Entry, query: string, terms: string[]): number {
  if (!terms.length) return 1
  const entity = entityKinds.has(entry.result.kind)
  if (entry.names.includes(query)) return entity ? 120 : 90
  if (entry.names.some((name) => terms.every((term) => name.includes(term)))) return entity ? 100 : 80
  if (terms.every((term) => entry.metadata.includes(term) || entry.names.some((name) => name.includes(term)))) return 40
  return terms.every((term) => entry.normalizedBody.includes(term) || entry.metadata.includes(term)) ? 10 : 0
}

function interaction(result: SearchResult, scoring?: SearchScoring): number {
  const scores =
    result.kind === 'person' ? scoring?.personScores : result.kind === 'org' ? scoring?.orgScores : undefined
  if (!scores) return 0
  for (const [name, value] of scores) if (name.toLowerCase() === result.title.toLowerCase()) return value.score
  return 0
}

function snippet(entry: Entry, terms: string[]): string | undefined {
  const lower = entry.body.toLowerCase()
  const positions = terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0)
  const start = positions.length ? Math.max(0, Math.min(...positions) - 70) : 0
  const text = entry.body.slice(start, start + 200)
  return text ? `${start ? '…' : ''}${text}${start + 200 < entry.body.length ? '…' : ''}` : undefined
}

export function validSearchFilter(value: string): SearchFilter {
  return value === 'more' || SEARCH_KINDS.includes(value as SearchKind) ? (value as SearchFilter) : 'all'
}

export function searchAllNotebook(
  store: MarkdownStore,
  base: string,
  query: string,
  options: {
    today: PlainDate
    roots?: string[]
    kind?: SearchFilter
    sort?: string
    offset?: number
    limit?: number
    scoring?: SearchScoring
  },
): SearchResponse {
  const normalized = normalize(query)
  const terms = normalized.split(' ').filter(Boolean)
  const date = searchDate(query, options.today)
  const entries = entriesOf(store, path.resolve(base)).filter(
    (entry) => !options.roots || isPathWithinRoots(entry.absolute, options.roots),
  )
  const hits = entries
    .map((entry) => ({
      entry,
      score: date
        ? Number(entry.result.date === date.ymd) * (entry.result.kind === 'day' ? 200 : 100)
        : score(entry, normalized, terms),
      interaction: interaction(entry.result, options.scoring),
    }))
    .filter((hit) => hit.score > 0)
    .sort(
      (a, b) =>
        (options.sort === 'newest' || !terms.length
          ? (b.entry.result.date ?? '').localeCompare(a.entry.result.date ?? '')
          : 0) ||
        b.score - a.score ||
        b.interaction - a.interaction ||
        (b.entry.result.date ?? '').localeCompare(a.entry.result.date ?? '') ||
        a.entry.result.title.localeCompare(b.entry.result.title) ||
        a.entry.absolute.localeCompare(b.entry.absolute),
    )
  const resultOf = (entry: Entry): SearchResult => ({ ...entry.result, snippet: snippet(entry, date ? [] : terms) })
  const dayEntry = date ? hits.find((hit) => hit.entry.result.kind === 'day')?.entry : undefined
  const day: SearchResult | undefined = date
    ? dayEntry
      ? resultOf(dayEntry)
      : {
          relativePath: '',
          href: `/${date.ymd}`,
          title: `${date.dayLong} · ${date.ymd}`,
          kind: 'day',
          date: date.ymd,
          subtitle: 'Open this day',
          properties: [],
        }
    : undefined
  const kind = options.kind ?? 'all'
  if (day) {
    const count = hits.filter((hit) => hit.entry.result.kind !== 'day').length
    day.subtitle = count ? `${count} ${count === 1 ? 'record' : 'records'} on this day` : 'Open this day'
  }
  const filtered = hits.filter(
    ({ entry }) =>
      kind === 'all' || (kind === 'more' ? !primaryKinds.has(entry.result.kind) : entry.result.kind === kind),
  )
  const offset = options.offset ?? 0
  const results = filtered.slice(offset, offset + (options.limit ?? 20)).map(({ entry }) => resultOf(entry))
  return {
    query,
    results,
    total: filtered.length,
    offset,
    today: options.today.ymd,
    day,
    dayItems: date
      ? hits
          .filter((hit) => hit.entry.result.kind !== 'day')
          .slice(0, 3)
          .map(({ entry }) => resultOf(entry))
      : [],
  }
}
