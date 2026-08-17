import { PORT_SERVER } from '#config'

// Corpus records come from the service's GraphQL query layer: the domain
// model decides what is a message, meeting, or journal. Basename parsing used
// to decide mediums here and silently dropped every meeting and journal —
// those file names carry Zoom/In-Person/... tokens, never "meeting". Service
// unreachable → empty corpus and callers abstain (degrade to empty, never a
// parallel filesystem path).

export type MessageRecord = {
  path: string
  /** YYYY-MM-DD — corpus slicing compares these strings */
  date: string
  /** Corpus medium: slack | email | message (any other message platform) | meeting | journal | chat | note */
  medium: string
  /** Conversation identity: `to:` (meetings: `who:`), else `from` (DMs captured from-only); unset for journals, chats and notes */
  to?: string
  from?: string
  summary?: string
  tags: string[]
  rel: string[]
  /** Full document markdown — loaded only withBody (evals re-classify records); empty otherwise */
  body: string
}

export type TagCount = { tag: string; count: number }

export type CorpusLoad = { records: MessageRecord[] }

// GraphQL row shapes, matching the fields the loader selects.
export type MessageRow = {
  medium: string
  from?: string | null
  to?: string | null
  date: string
  summary?: string | null
  tags: string[]
  rel: string[]
  path: string
  markdown?: string
}
export type MeetingRow = {
  who?: string | null
  date: string
  summary?: string | null
  tags: string[]
  rel: string[]
  path: string
  markdown?: string
}
export type JournalRow = {
  date: string
  tags: string[]
  rel: string[]
  path: string
  markdown?: string
}
export type ChatRow = {
  date: string
  summary?: string | null
  tags: string[]
  rel: string[]
  path: string
  markdown?: string
}
export type NoteRow = {
  date: string
  summary?: string | null
  tags: string[]
  rel: string[]
  path: string
  markdown?: string
}
export type CorpusRows = {
  messages?: MessageRow[]
  meetings?: MeetingRow[]
  journals?: JournalRow[]
  chats?: ChatRow[]
  notes?: NoteRow[]
}

/** Message-domain platforms fold into three corpus mediums: slack, email, and message (all others). */
export function corpusMediumOf(messageMedium: string): string {
  const lower = messageMedium.toLowerCase()
  return lower === 'slack' || lower === 'email' ? lower : 'message'
}

/** Map GraphQL rows into corpus records, keeping only the requested mediums, sorted by day then path. */
export function recordsFromRows(rows: CorpusRows, mediums: string[]): MessageRecord[] {
  const wanted = new Set(mediums)
  const str = (v: string | null | undefined): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined
  const records: MessageRecord[] = []

  for (const row of rows.messages ?? []) {
    const medium = corpusMediumOf(row.medium)
    if (!wanted.has(medium)) continue
    records.push({
      path: row.path,
      date: row.date,
      medium,
      to: str(row.to) ?? str(row.from),
      from: str(row.from),
      summary: str(row.summary),
      tags: row.tags,
      rel: row.rel,
      body: row.markdown ?? '',
    })
  }
  if (wanted.has('meeting')) {
    for (const row of rows.meetings ?? []) {
      records.push({
        path: row.path,
        date: row.date,
        medium: 'meeting',
        to: str(row.who),
        summary: str(row.summary),
        tags: row.tags,
        rel: row.rel,
        body: row.markdown ?? '',
      })
    }
  }
  if (wanted.has('journal')) {
    for (const row of rows.journals ?? []) {
      records.push({
        path: row.path,
        date: row.date,
        medium: 'journal',
        tags: row.tags,
        rel: row.rel,
        body: row.markdown ?? '',
      })
    }
  }
  if (wanted.has('chat')) {
    for (const row of rows.chats ?? []) {
      records.push({
        path: row.path,
        date: row.date,
        medium: 'chat',
        summary: str(row.summary),
        tags: row.tags,
        rel: row.rel,
        body: row.markdown ?? '',
      })
    }
  }
  if (wanted.has('note')) {
    for (const row of rows.notes ?? []) {
      records.push({
        path: row.path,
        date: row.date,
        medium: 'note',
        summary: str(row.summary),
        tags: row.tags,
        rel: row.rel,
        body: row.markdown ?? '',
      })
    }
  }

  records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.path < b.path ? -1 : 1))
  return records
}

// The resolvers cap queries without an explicit limit at 500 — far below the
// corpus. An explicit limit above the cap is honored.
const QUERY_LIMIT = 100_000
const QUERY_TIMEOUT_MS = 15_000

export type LoadCorpusOptions = {
  /** Fetch full document markdown into `body`. Evals re-classify records; runtime menus never need it. */
  withBody?: boolean
}

/**
 * Load corpus records of the given mediums from the service:
 * slack | email | message (any other message platform) | meeting | journal | chat | note.
 * Derived fresh on every call — the store follows the notebook files, so
 * landing in a file IS joining the corpus, with no separate state to maintain.
 */
export async function loadMessageCorpus(mediums: string[], opts: LoadCorpusOptions = {}): Promise<CorpusLoad> {
  const wanted = new Set(mediums)
  const body = opts.withBody ? ' markdown' : ''
  const parts: string[] = []
  if (wanted.has('slack') || wanted.has('email') || wanted.has('message')) {
    parts.push(`messages(limit: ${QUERY_LIMIT}) { medium from to date summary tags rel path${body} }`)
  }
  if (wanted.has('meeting')) {
    parts.push(`meetings(limit: ${QUERY_LIMIT}) { who date summary tags rel path${body} }`)
  }
  if (wanted.has('journal')) {
    parts.push(`journals(limit: ${QUERY_LIMIT}) { date tags rel path${body} }`)
  }
  if (wanted.has('chat')) {
    parts.push(`chats(limit: ${QUERY_LIMIT}) { date summary tags rel path${body} }`)
  }
  if (wanted.has('note')) {
    parts.push(`notes(limit: ${QUERY_LIMIT}) { date summary tags rel path${body} }`)
  }
  if (parts.length === 0) return { records: [] }

  const data = await queryService(`{ ${parts.join(' ')} }`)
  if (!data) return { records: [] }
  return { records: recordsFromRows(data as CorpusRows, mediums) }
}

async function queryService(query: string): Promise<unknown> {
  try {
    const response = await fetch(`http://localhost:${PORT_SERVER}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    })
    const json = (await response.json()) as { data?: unknown }
    return json.data
  } catch {
    return undefined
  }
}

/** Records from strictly earlier days — same-day neighbors are excluded so intra-day order never matters. */
export function sliceBefore(records: MessageRecord[], date: string): MessageRecord[] {
  return records.filter((r) => r.date < date)
}

/** Tag frequencies across records, most-used first (name breaks ties). */
export function buildTagMenu(records: MessageRecord[]): TagCount[] {
  const counts = new Map<string, number>()
  for (const r of records) {
    for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
    (a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1),
  )
}

/** Tags previously used in the conversation `to` identifies, most-used first. */
export function tagHistoryFor(records: MessageRecord[], to: string | undefined): TagCount[] {
  if (!to) return []
  return buildTagMenu(records.filter((r) => r.to === to))
}

/** Rel values previously used in the conversation, most-used first. */
export function relHistoryFor(records: MessageRecord[], to: string | undefined): TagCount[] {
  if (!to) return []
  const counts = new Map<string, number>()
  for (const r of records) {
    if (r.to !== to) continue
    for (const value of r.rel) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
    (a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1),
  )
}

/** Most frequent exact tag-set previously used in the conversation — the rubber-stamp baseline. */
export function majorityTagsFor(records: MessageRecord[], to: string | undefined): string[] {
  return majorityBy(records, to, (r) => r.tags)
}

/** Most frequent exact rel-set previously used in the conversation. */
export function majorityRelFor(records: MessageRecord[], to: string | undefined): string[] {
  return majorityBy(records, to, (r) => r.rel)
}

function majorityBy(
  records: MessageRecord[],
  to: string | undefined,
  valuesOf: (record: MessageRecord) => string[],
): string[] {
  if (!to) return []
  const counts = new Map<string, { values: string[]; count: number }>()
  for (const r of records) {
    const values = valuesOf(r)
    if (r.to !== to || values.length === 0) continue
    const key = [...values].sort().join('; ')
    const existing = counts.get(key)
    if (existing) existing.count++
    else counts.set(key, { values, count: 1 })
  }
  let best: { values: string[]; count: number } | undefined
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry
  }
  return best?.values ?? []
}
