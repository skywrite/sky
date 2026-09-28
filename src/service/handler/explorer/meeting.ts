/**
 * A meeting file, read for its page: who was there as profiles, when and
 * how, what it is filed under, and the meetings before and after it with
 * the same people or about the same organizations. Nothing here changes a
 * file. The people and the thread come from the notebook's own index and
 * the backlinks the vocabulary already keeps, so a meeting's page shows
 * what the person's page would say about the same files.
 */

import * as path from 'node:path'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { MeetingDocument } from '#shared/models/Meeting/mod.ts'
import dayDir from '#shared/nbfs/dayDir.ts'
import parseTimePath from '#shared/nbfs/parseTimePath.ts'
import { When } from '#universal/dates/nbdt/mod.ts'
import { readMarkdownContent } from '../markdown-preview/content.ts'
import { resolveMarkdownPreviewRequest, toNotebookRelativePath } from '../markdown-preview/request.ts'
import { type PeopleIndex, profileHref, type ProfileSummary } from '../people/types.ts'
import { type Backlink, backlinksOf } from '../vocabulary/mod.ts'
import { explorerHref } from './mod.ts'

export interface MeetingPerson {
  name: string
  /** The profile page, when the name resolves to one */
  href?: string
  title?: string
  org?: string
  /** Meetings in the notebook that name this person, this one included */
  meetings: number
  /** Which one this is, counting from the first: 1 for a first meeting */
  nth: number
  /** `met:` on the profile */
  met?: string
}

export interface MeetingRef {
  label: string
  href?: string
}

export interface MeetingLink {
  path: string
  href: string
  /** YYYY-MM-DD */
  date: string
  title: string
}

export interface MeetingView {
  path: string
  title: string
  /** YYYY-MM-DD, from the day folder */
  day: string | null
  /** HH:MM, from `when:` */
  time: string | null
  minutes: number | null
  medium: string
  who: MeetingPerson[]
  /** `rel:` resolved: organizations, projects, people */
  about: MeetingRef[]
  /** Newest first, before this meeting's day */
  previous: MeetingLink[]
  /** The nearest one after this meeting's day */
  next: MeetingLink | null
  /** Every meeting with the first attendee, for the "all N" link */
  allWith: { name: string; href: string; count: number } | null
  tags: string[]
}

export interface MeetingViewOptions {
  /** Where the days live: a day and a slug become `<day folder>/actions/meetings/<slug>.md` */
  timeDir: string
  /** The notebook's index; null before it is built */
  store: () => MarkdownStore | null
  /** The people pages' index, for a profile's route; null when the pages are off */
  profiles: () => { index(): Promise<PeopleIndex> } | null
}

const PREVIOUS_SHOWN = 4

/** The file's name without its extension: its slug under its day. */
export function meetingSlug(relativePath: string): string {
  return (relativePath.split('/').pop() ?? '').replace(/\.md$/, '')
}

/**
 * The meeting's page, `/<day>/meetings/<slug>`; null for a file that is not
 * a meeting under a day. The explorer keeps showing the file as written.
 */
export function meetingHref(relativePath: string): string | null {
  if (!isMeetingPath(relativePath)) return null
  const time = parseTimePath(relativePath)
  if (time?.kind !== 'day') return null
  return `/${time.date.toString()}/meetings/${encodeURIComponent(meetingSlug(relativePath))}`
}

/** A day and a slug as the file's path, relative to the notebook. */
export function meetingPathOf(day: string, slug: string, timeDir: string, base: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^[^/\\]+$/.test(slug) || slug.startsWith('.')) return null
  const file = path.join(timeDir, dayDir(day), 'actions', 'meetings', `${slug}.md`)
  return toNotebookRelativePath(base, file)
}

/** A meeting write-up: a markdown file in a day's `actions/meetings/`. */
export function isMeetingPath(relativePath: string): boolean {
  return /(^|\/)actions\/meetings\/[^/]+\.md$/.test(relativePath)
}

/** The names in `who:` — a string, a list, or one string joined by commas or "and". */
export function attendeeNames(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\s*[,;]\s*|\s+and\s+|\s*&\s*/) : []
  return [
    ...new Set(
      list
        .filter((n): n is string => typeof n === 'string')
        .map(strip)
        .filter(Boolean),
    ),
  ]
}

const strip = (name: string) =>
  name
    .replace(/^\[\[|\]\]$/g, '')
    .replace(/\|.*$/, '')
    .trim()

/** The title: `summary:`, else the body's first heading, else the file's name after the time and medium. */
export function meetingTitle(doc: MeetingDocument, relativePath: string): string {
  const summary = doc.summary?.trim()
  if (summary) return summary
  const heading = /^#\s+(.+?)\s*$/m.exec(doc.toMarkdown({ yaml: false }))?.[1]?.trim()
  if (heading && heading.toLowerCase() !== 'meeting') return heading
  const stem = relativePath.split('/').pop()?.replace(/\.md$/, '') ?? relativePath
  const parts = stem.split('_')
  return (parts.length >= 4 ? parts.slice(3).join(' ') : (parts[parts.length - 1] ?? stem)).replace(/-/g, ' ')
}

/** HH:MM and the length from `when:`; what a range or a bare time gives when the value is off-grammar. */
export function meetingTime(raw: unknown): { time: string | null; minutes: number | null } {
  try {
    const when = When.fromYaml(raw)
    const time = /(\d{2}:\d{2})$/.exec(when.datetime.toString())?.[1] ?? null
    return { time, minutes: when.durationMinutes }
  } catch {
    const times = [...String(raw ?? '').matchAll(/\b(\d{1,2}):(\d{2})\b/g)].map(
      (m) => [Number(m[1]), Number(m[2])] as const,
    )
    if (times.length === 0) return { time: null, minutes: null }
    const [h, m] = times[0]
    const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    const end = times[1]
    const minutes = end ? end[0] * 60 + end[1] - (h * 60 + m) : null
    return { time, minutes: minutes !== null && minutes > 0 ? minutes : null }
  }
}

/** What this meeting names, each with the meetings that name the same thing, and how much that counts. */
export interface ThreadSource {
  links: Backlink[]
  /** Attendees count double: a meeting with the same person is the thread; one about the same org is context. */
  weight: number
}

/**
 * The thread: the meetings before this day and the first one after, this
 * file left out. Each candidate scores by how much it shares with this
 * meeting, the people it was with, the people and organizations it is filed
 * under, so a meeting with the same person outranks one that merely names
 * the same organization. The four best come first, shown newest first.
 */
export function threadOf(
  sources: ThreadSource[],
  self: string,
  day: string | null,
): { previous: MeetingLink[]; next: MeetingLink | null } {
  const scored = new Map<string, { link: MeetingLink; score: number }>()
  for (const source of sources) {
    const seen = new Set<string>()
    for (const link of source.links) {
      if (link.path === self || !isMeetingPath(link.path) || !link.date || seen.has(link.path)) continue
      seen.add(link.path)
      const entry = scored.get(link.path)
      if (entry) entry.score += source.weight
      else
        scored.set(link.path, {
          link: {
            path: link.path,
            href: meetingHref(link.path) ?? explorerHref(link.path),
            date: link.date,
            title: link.label,
          },
          score: source.weight,
        })
    }
  }
  const byScore = (a: { link: MeetingLink; score: number }, b: { link: MeetingLink; score: number }) =>
    b.score - a.score || b.link.date.localeCompare(a.link.date) || a.link.title.localeCompare(b.link.title)
  const newestFirst = (a: MeetingLink, b: MeetingLink) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title)
  const all = [...scored.values()]
  const before = day ? all.filter((c) => c.link.date < day) : all
  const previous = before
    .sort(byScore)
    .slice(0, PREVIOUS_SHOWN)
    .map((c) => c.link)
    .sort(newestFirst)
  const later = day ? all.filter((c) => c.link.date > day) : []
  const best = later.length ? Math.max(...later.map((c) => c.score)) : 0
  const next = later
    .filter((c) => c.score === best)
    .map((c) => c.link)
    .sort((a, b) => a.date.localeCompare(b.date))[0]
  return { previous, next: next ?? null }
}

export async function readMeetingView(
  query: { path?: string; day?: string; slug?: string },
  options: { markdownBaseDir: string; markdownDirs: string[] } & MeetingViewOptions,
): Promise<{ ok: true; view: MeetingView } | { ok: false; status: 400 | 403 | 404 | 503; message: string }> {
  const param =
    query.path ??
    (query.day && query.slug ? meetingPathOf(query.day, query.slug, options.timeDir, options.markdownBaseDir) : null)
  if (!param) return { ok: false, status: 400, message: 'a path, or a day and a slug, is required' }
  const request = resolveMarkdownPreviewRequest(param, undefined, options.markdownBaseDir, options.markdownDirs)
  if (!request.ok) return request
  const relativePath = request.value.relativePath
  if (!isMeetingPath(relativePath)) return { ok: false, status: 404, message: `${relativePath} is not a meeting` }
  const store = options.store()
  if (!store) return { ok: false, status: 503, message: 'the notebook index is still being built' }

  let content: string
  try {
    content = (await readMarkdownContent(request.value.filePath)).content
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      return { ok: false, status: 404, message: `no file at ${relativePath}` }
    throw err
  }
  const doc = MeetingDocument.fromMarkdown(content)
  const base = options.markdownBaseDir
  const time = parseTimePath(relativePath)
  const day = time?.kind === 'day' ? time.date.toString() : null
  const index = await options.profiles()?.index()
  const summaryOf = (rel: string): ProfileSummary | undefined =>
    index?.people.find((p) => p.id === rel) ?? index?.orgs.find((o) => o.id === rel)

  const who: MeetingPerson[] = []
  const peopleLinks: Backlink[] = []
  const relatedLinks: Backlink[] = []
  const orgLinks: Backlink[] = []
  for (const name of attendeeNames(doc.yaml['who'])) {
    const ref = store.resolve(name)
    if (ref.type !== 'person') {
      who.push({ name, meetings: 1, nth: 1 })
      continue
    }
    const rel = toNotebookRelativePath(base, ref.path)
    const links = backlinksOf(store, base, rel)
    peopleLinks.push(...links)
    // The attendee's organization is part of the thread even when the file is not filed under it.
    const org = ref.value.org ? store.resolve(ref.value.org) : null
    if (org && org.type === 'org') orgLinks.push(...backlinksOf(store, base, toNotebookRelativePath(base, org.path)))
    const summary = summaryOf(rel)
    const meetings = links.filter((l) => isMeetingPath(l.path))
    const named = meetings.some((l) => l.path === relativePath)
    const earlier = meetings.filter((l) => l.path !== relativePath && l.date && day && l.date <= day).length
    who.push({
      name: summary?.name ?? ref.value.name ?? name,
      ...(summary ? { href: profileHref(summary) } : {}),
      ...(ref.value.title ? { title: ref.value.title } : {}),
      ...(ref.value.org ? { org: ref.value.org } : {}),
      meetings: meetings.length + (named ? 0 : 1),
      nth: earlier + 1,
      ...(ref.value.met ? { met: ref.value.met.toString() } : {}),
    })
  }

  const about: MeetingRef[] = []
  const rel = doc.yaml['rel']
  for (const raw of Array.isArray(rel) ? rel : typeof rel === 'string' ? [rel] : []) {
    if (typeof raw !== 'string') continue
    const ref = store.resolve(raw)
    if (ref.type === 'org' || ref.type === 'person' || ref.type === 'project') {
      const path = toNotebookRelativePath(base, ref.path)
      if (ref.type === 'org') orgLinks.push(...backlinksOf(store, base, path))
      if (ref.type === 'person') relatedLinks.push(...backlinksOf(store, base, path))
      const summary = ref.type === 'project' ? undefined : summaryOf(path)
      about.push({ label: ref.value.name ?? strip(raw), href: summary ? profileHref(summary) : explorerHref(path) })
    } else if (ref.type === 'unresolved') {
      about.push({ label: strip(raw) })
    }
  }

  const thread = threadOf(
    [
      { links: peopleLinks, weight: 2 },
      { links: relatedLinks, weight: 1 },
      { links: orgLinks, weight: 1 },
    ],
    relativePath,
    day,
  )
  const first = who.find((p) => p.href)
  const { time: hhmm, minutes } = meetingTime(doc.yaml['when'])
  return {
    ok: true,
    view: {
      path: relativePath,
      title: meetingTitle(doc, relativePath),
      day,
      time: hhmm,
      minutes,
      medium: doc.medium,
      who,
      about,
      previous: thread.previous,
      next: thread.next,
      allWith: first?.href ? { name: first.name, href: first.href, count: first.meetings } : null,
      tags: [...doc.tags],
    },
  }
}
