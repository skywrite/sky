import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import * as path from 'node:path'
import { ALL_LAYOUTS } from '#shared/nbfs/layout/registry.ts'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'

export interface CaptureContextSource {
  id: string
  path: string
  label: string
  content: string
}

interface CaptureContextOptions {
  notebookDir: string
  timeDir: string
  relDir?: string
  today: PlainDate
  intent: string
}

const DAY_LOOKBACK = 28
const WEEK_LOOKBACK = 8
const MAX_FILE_BYTES = 96 * 1024
const MAX_SOURCE_CHARS = 4000
const MAX_CONTEXT_CHARS = 24_000
const MAX_TIME_SOURCES = 8
const MAX_REL_SOURCES = 4
const MAX_REL_READS = 24
const MAX_REL_ENTRIES = 4000
const MAX_DIRECTORY_ENTRIES = 1000
const MAX_REL_DIRECTORIES = 400
const OMITTED = '\n[… excerpt omitted …]\n'
const STOP_WORDS = new Set(
  'a an and are as at be been but by can could do done for from get getting going have help how i in into is it its just like make me my of on or our really should some something that the their them then there these they this through to want was we what when where which who will with would you your'.split(
    ' ',
  ),
)

interface Candidate {
  file: string
  label: string
  age: number
  weekly: boolean
}

function words(value: string): Set<string> {
  return new Set(
    (value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
      (word) => word.length > 2 && !STOP_WORDS.has(word),
    ),
  )
}

function relevance(value: string, terms: Set<string>): number {
  const found = words(value)
  return [...terms].filter((term) => found.has(term)).length
}

function within(root: string, file: string): boolean {
  const relative = path.relative(root, file)
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function absent(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code ?? '')
}

/** Keep contiguous, verbatim windows; the omission marker is never presented as source prose. */
function excerpt(content: string, terms: Set<string>, budget: number): string {
  if (content.length <= budget) return content
  const windowSize = Math.floor((budget - OMITTED.length) / 2)
  let best = 0
  let bestScore = -1
  for (let offset = windowSize; offset < content.length; offset += Math.floor(windowSize / 2)) {
    const score = relevance(content.slice(offset, offset + windowSize), terms)
    if (score >= bestScore) {
      best = offset
      bestScore = score
    }
  }
  const start = Math.max(windowSize, Math.min(best, content.length - windowSize))
  return content.slice(0, windowSize) + OMITTED + content.slice(start, start + windowSize)
}

function timeCandidates(options: CaptureContextOptions): Candidate[] {
  const candidates = new Map<string, Candidate>()
  const add = (relative: string, label: string, age: number, weekly: boolean) => {
    const file = path.resolve(options.notebookDir, options.timeDir, relative)
    if (!candidates.has(file)) candidates.set(file, { file, label, age, weekly })
  }
  for (const layout of ALL_LAYOUTS) {
    for (let age = 0; age < DAY_LOOKBACK; age++) {
      const date = options.today.addDays(-age)
      add(layout.dayFile(date), `${date.ymd} — day`, age, false)
      add(path.join(layout.dayDir(date), 'summary.md'), `${date.ymd} — day summary`, age, false)
    }
    // startInYear also finds week records correctly across clipped year-boundary buckets.
    let week = Week.of(options.today)
    for (let age = 0; age < WEEK_LOOKBACK; age++) {
      const label = `${week.startInYear.ymd}–${week.endInYear.ymd}`
      for (const [name, kind] of [
        ['week.md', 'week plan'],
        ['summary.md', 'week summary'],
        ['checkins.md', 'week check-ins'],
      ]) {
        add(path.join(layout.weekDir(week.startInYear), name), `${label} — ${kind}`, age * 7, true)
      }
      week = week.previous()
    }
  }
  return [...candidates.values()]
}

/**
 * First-pass context for capture, not an exhaustive notebook search. Recent plans are
 * useful orientation even without a lexical match; older day records must earn a place.
 * Relationship files are discovered by names and local links from that relevant context.
 */
export async function loadCaptureContext(
  options: CaptureContextOptions,
  signal?: AbortSignal,
): Promise<{ sources: CaptureContextSource[]; limited: boolean }> {
  signal?.throwIfAborted()
  const root = path.resolve(options.notebookDir)
  let actualRoot: string
  try {
    actualRoot = await realpath(root)
  } catch (error) {
    if (absent(error)) return { sources: [], limited: false }
    throw error
  }
  let limited = false
  const terms = words(options.intent)
  const sources: CaptureContextSource[] = []
  const safe = async (file: string): Promise<boolean> => {
    signal?.throwIfAborted()
    if (!within(root, file)) {
      limited = true
      return false
    }
    let cursor = root
    try {
      for (const part of path.relative(root, file).split(path.sep)) {
        cursor = path.join(cursor, part)
        if ((await lstat(cursor)).isSymbolicLink()) {
          limited = true
          return false
        }
      }
      if (!within(actualRoot, await realpath(file))) {
        limited = true
        return false
      }
      return true
    } catch (error) {
      if (!absent(error)) limited = true
      return false
    }
  }
  const read = async (file: string): Promise<string | undefined> => {
    if (!(await safe(file))) return
    let handle
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      const info = await handle.stat()
      if (!info.isFile() || !(await safe(file))) return
      const current = await lstat(file)
      if (current.ino !== info.ino || current.dev !== info.dev) {
        limited = true
        return
      }
      const buffer = Buffer.alloc(Math.min(MAX_FILE_BYTES, info.size))
      signal?.throwIfAborted()
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      signal?.throwIfAborted()
      let content = buffer.subarray(0, bytesRead).toString('utf8')
      if (info.size > MAX_FILE_BYTES) {
        limited = true
        // Check-ins append over time; preserve the latest entries as well as the opening context.
        const tail = Buffer.alloc(MAX_FILE_BYTES / 2)
        const result = await handle.read(tail, 0, tail.length, info.size - tail.length)
        content = content.slice(0, MAX_FILE_BYTES / 2) + OMITTED + tail.subarray(0, result.bytesRead).toString('utf8')
      }
      return content.trim() ? content : undefined
    } catch (error) {
      signal?.throwIfAborted()
      if (!absent(error)) limited = true
      return undefined
    } finally {
      await handle?.close()
    }
  }

  const loaded: (Candidate & { content: string; matches: number; rank: number })[] = []
  const candidates = timeCandidates(options)
  for (let start = 0; start < candidates.length; start += 8) {
    await Promise.all(
      candidates.slice(start, start + 8).map(async (candidate) => {
        const content = await read(candidate.file)
        if (!content) return
        const matches = relevance(content, terms)
        if (!matches && !(candidate.weekly && candidate.age <= 7) && candidate.age !== 0) return
        const orientation = candidate.weekly
          ? path.basename(candidate.file) === 'week.md'
            ? 3
            : path.basename(candidate.file) === 'checkins.md'
              ? 2
              : 1
          : 0
        const rank = matches * 12 + Math.max(0, 8 - candidate.age / 7) + orientation
        loaded.push({ ...candidate, content, matches, rank })
      }),
    )
  }
  loaded.sort((a, b) => b.rank - a.rank || a.age - b.age || a.file.localeCompare(b.file))
  // Only a small orientation sample should ride when the intention has no matching records.
  const selected = loaded.filter((item, index) => item.matches > 0 || index < 2).slice(0, MAX_TIME_SOURCES)
  if (loaded.some((item) => item.matches > 0 && !selected.includes(item))) limited = true

  const add = (file: string, label: string, content: string) => {
    if (sources.some((source) => source.path === path.relative(root, file))) return
    const remaining = MAX_CONTEXT_CHARS - sources.reduce((sum, source) => sum + source.content.length, 0)
    if (remaining < 500) {
      limited = true
      return
    }
    const relative = path.relative(root, file)
    const body = excerpt(content, terms, Math.min(MAX_SOURCE_CHARS, remaining))
    if (body.length < content.length) limited = true
    sources.push({
      id: `context-${createHash('sha256').update(relative).digest('hex').slice(0, 16)}`,
      path: relative,
      label,
      content: body,
    })
  }

  // Reserve room for people and organizations even when several day records are large.
  for (const candidate of selected) add(candidate.file, candidate.label, excerpt(candidate.content, terms, 2500))
  if (selected.some((candidate) => candidate.content.length > 2500)) limited = true
  const relatedText = [options.intent, ...sources.map((source) => source.content)].join('\n')
  const relRoots = [...new Set([options.relDir ?? 'rel', 'people', 'orgs'].map((dir) => path.resolve(root, dir)))]
  const isRelationship = (file: string) => relRoots.some((dir) => within(dir, file)) && file.endsWith('.md')
  const profiles = new Map<string, number>()
  for (const source of selected) {
    for (const match of source.content.matchAll(/\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g)) {
      let ref: string
      try {
        ref = decodeURIComponent(match[1] ?? match[2]).split('#')[0]!
      } catch {
        continue
      }
      if (!ref || /^[a-z][a-z\d+.-]*:/i.test(ref)) continue
      const file = ref.startsWith('/') ? path.resolve(root, `.${ref}`) : path.resolve(path.dirname(source.file), ref)
      const notebookRef = path.resolve(root, ref)
      for (const linked of [file, notebookRef]) {
        if (isRelationship(linked)) profiles.set(linked, 100)
      }
    }
  }

  let entriesSeen = 0
  let directoriesSeen = 0
  const visit = async (dir: string, depth: number): Promise<void> => {
    signal?.throwIfAborted()
    if (depth > 4 || entriesSeen >= MAX_REL_ENTRIES || directoriesSeen >= MAX_REL_DIRECTORIES) {
      limited = true
      return
    }
    if (!(await safe(dir))) return
    directoriesSeen++
    const entries: { name: string; directory: boolean; file: boolean }[] = []
    try {
      for await (const entry of await opendir(dir)) {
        signal?.throwIfAborted()
        if (++entriesSeen > MAX_REL_ENTRIES || entries.length >= MAX_DIRECTORY_ENTRIES) {
          limited = true
          break
        }
        if (entry.isSymbolicLink()) {
          limited = true
          continue
        }
        if (entry.name.startsWith('.')) continue
        entries.push({ name: entry.name, directory: entry.isDirectory(), file: entry.isFile() })
      }
    } catch (error) {
      signal?.throwIfAborted()
      if (!absent(error)) limited = true
      return
    }
    entries.sort((a, b) => b.name.localeCompare(a.name))
    for (const entry of entries) {
      const file = path.join(dir, entry.name)
      if (entry.directory) {
        await visit(file, depth + 1)
      } else if (entry.file && entry.name.endsWith('.md')) {
        const name = path.basename(entry.name, '.md')
        const nameTerms = words(name)
        const direct = relevance(options.intent, nameTerms)
        const contextual = relevance(relatedText, nameTerms)
        if (direct || contextual) profiles.set(file, Math.max(profiles.get(file) ?? 0, direct * 30 + contextual * 5))
      }
    }
  }
  for (const dir of relRoots) await visit(dir, 0)
  const rankedProfiles = [...profiles].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (rankedProfiles.length > MAX_REL_READS) limited = true
  let included = 0
  for (const [file] of rankedProfiles.slice(0, MAX_REL_READS)) {
    if (included >= MAX_REL_SOURCES) {
      limited = true
      break
    }
    const content = await read(file)
    if (!content) continue
    add(file, path.basename(file, '.md').replaceAll('-', ' '), content)
    included++
  }
  signal?.throwIfAborted()
  return { sources, limited }
}
