import { readTextFile, walkToArray } from '#shared/fs/mod.ts'
import MessageDocument from '#shared/models/Message/mod.ts'
import parseDateFromDayPath from '#shared/nbfs/parseDateFromDayPath.ts'

export type MessageRecord = {
  path: string
  /** YYYY-MM-DD from the day-dir path — corpus slicing compares these strings */
  date: string
  medium: string
  /** Conversation identity: `to` when present, else `from` (DMs captured from-only) */
  channel?: string
  from?: string
  summary?: string
  tags: string[]
  rel: string[]
  body: string
}

export type TagCount = { tag: string; count: number }

export type CorpusLoad = { records: MessageRecord[]; skipped: number }

// Both filename generations: `slack_*.md` (pre time-prefix) and `HH-MM_slack_*.md`.
// The hour can exceed 23 — late-night files use extended hours (e.g. 25-30).
const MESSAGE_FILE_RE = /^(?:\d\d-\d\d_)?(slack|email|message|meeting)_.+\.md$/

export function mediumOfBasename(name: string): string | undefined {
  return MESSAGE_FILE_RE.exec(name)?.[1]
}

export function recordFromMarkdown(filePath: string, contents: string, medium: string): MessageRecord {
  const doc = MessageDocument.fromMarkdown(contents)
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  return {
    path: filePath,
    date: parseDateFromDayPath(filePath).toString(),
    medium,
    channel: str(doc.yaml['to']) ?? str(doc.yaml['from']),
    from: str(doc.yaml['from']),
    summary: str(doc.yaml['summary']),
    tags: Array.from(doc.tags),
    rel: relStrings(doc.yaml['rel']),
    body: doc.markdown,
  }
}

/** rel: is a string or a YAML array in the wild — normalize to trimmed strings. */
function relStrings(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim())
  }
  return []
}

/**
 * Load message-medium records under a time dir, sorted by day then path.
 * Unparseable files (no day path, broken frontmatter) are counted, not fatal.
 */
export async function loadMessageCorpus(timeDir: string, mediums: string[]): Promise<CorpusLoad> {
  const wanted = new Set(mediums)
  const entries = await walkToArray(timeDir, { exts: ['.md'] })
  const records: MessageRecord[] = []
  let skipped = 0
  for (const entry of entries) {
    const medium = mediumOfBasename(entry.name)
    if (!medium || !wanted.has(medium)) continue
    try {
      records.push(recordFromMarkdown(entry.path, await readTextFile(entry.path), medium))
    } catch {
      skipped++
    }
  }
  records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.path < b.path ? -1 : 1))
  return { records, skipped }
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

export function channelHistory(records: MessageRecord[], channel: string | undefined): TagCount[] {
  if (!channel) return []
  return buildTagMenu(records.filter((r) => r.channel === channel))
}

/** Rel values previously used in the channel, most-used first. */
export function channelRelHistory(records: MessageRecord[], channel: string | undefined): TagCount[] {
  if (!channel) return []
  const counts = new Map<string, number>()
  for (const r of records) {
    if (r.channel !== channel) continue
    for (const value of r.rel) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
    (a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1),
  )
}

/** Most frequent exact tag-set previously used in the channel — the rubber-stamp baseline. */
export function channelMajoritySet(records: MessageRecord[], channel: string | undefined): string[] {
  return channelMajorityBy(records, channel, (r) => r.tags)
}

/** Most frequent exact rel-set previously used in the channel. */
export function channelMajorityRel(records: MessageRecord[], channel: string | undefined): string[] {
  return channelMajorityBy(records, channel, (r) => r.rel)
}

function channelMajorityBy(
  records: MessageRecord[],
  channel: string | undefined,
  valuesOf: (record: MessageRecord) => string[],
): string[] {
  if (!channel) return []
  const counts = new Map<string, { values: string[]; count: number }>()
  for (const r of records) {
    const values = valuesOf(r)
    if (r.channel !== channel || values.length === 0) continue
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
