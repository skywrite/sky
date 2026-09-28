/**
 * A meeting's page, `/<day>/meetings/<slug>`: the write-up framed the way a
 * person's page is framed. Above the body, a header carries what the
 * frontmatter says — the title, who, when, how long, on what — so the
 * body's own title line and its Time/Date and Attendees sections are not
 * drawn twice. Beside it, the column a person's page has: who as profiles,
 * when, what it is filed under, the meetings before and after it, files,
 * tags, and any card an extension adds. The file itself is untouched and
 * the explorer still shows it as written; Edit opens it there.
 */

import './meetingPage.css'
import { ActionIcon, Button, Menu } from '@mantine/core'
import { type CSSProperties, Fragment, type MouseEvent, useEffect, useRef, useState } from 'react'
import type { MeetingView } from '../../explorer/meeting.ts'
import { type ExplorerDoc, fileHref, RenderedBody, useDocScale } from './explorer.tsx'
import { ExtensionFileActions, ExtensionFileCards } from './extensions.tsx'
import { homeOf, railSectionOf } from './frontmatter/kinds.ts'
import { PropRow } from './frontmatter/rows.tsx'
import { type FrontmatterState, useFrontmatter } from './frontmatter/useFrontmatter.ts'
import { useRail } from './rail.ts'
import { RailToggle } from './railToggle.tsx'

export type { MeetingView } from '../../explorer/meeting.ts'

export interface MeetingRoute {
  ymd: string
  /** The file's name without `.md` */
  slug: string
}

/** `/2026-09-11/meetings/12-00_Zoom_Jane` is a meeting's page; null for any other path. */
export function meetingRouteOf(pathname: string): MeetingRoute | null {
  const match = /^\/(\d{4}-\d{2}-\d{2})\/meetings\/([^/]+)$/.exec(pathname)
  if (!match) return null
  try {
    return { ymd: match[1]!, slug: decodeURIComponent(match[2]!) }
  } catch {
    return null
  }
}

/**
 * The page for a meeting file under a day, from its notebook path; null for
 * any other file, which opens in the explorer. The day folder carries its
 * own month, whichever way the weeks above it are named.
 */
export function meetingHref(path: string): string | null {
  const match = /^time\/(\d{4})\/(?:[^/]+\/){1,2}(\d{2})-(\d{2})\/actions\/meetings\/([^/]+)\.md$/.exec(path)
  return match ? `/${match[1]}-${match[2]}-${match[3]}/meetings/${encodeURIComponent(match[4]!)}` : null
}

const SECTIONS_IN_HEADER = new Set(['time/date', 'attendees', 'time', 'date'])

/**
 * The body without what the header already says: its first title line, and
 * the Time/Date and Attendees sections up to the next section heading.
 */
export function trimMeetingHtml(html: string): string {
  let out = html.replace(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>\s*/i, '')
  out = out.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>[\s\S]*?(?=<h2\b|$)/gi, (block, heading: string) => {
    const name = heading
      .replace(/<[^>]+>/g, '')
      .trim()
      .toLowerCase()
    return SECTIONS_IN_HEADER.has(name) ? '' : block
  })
  return out.trim()
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** `Sep 11` for a day; the calendar alone, no clock. */
export function shortDate(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number)
  return `${MONTHS[(m ?? 1) - 1]} ${d}`
}

export function weekdayOf(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return WEEKDAYS[new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay()]
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The line under the title: when, how long, on what. Who is drawn with links, so it is not part of this. */
export function whenLine(view: Pick<MeetingView, 'day' | 'time' | 'minutes' | 'medium'>): string {
  const parts: string[] = []
  if (view.day) parts.push(`${weekdayOf(view.day)} ${shortDate(view.day)}${view.time ? ` at ${view.time}` : ''}`)
  else if (view.time) parts.push(`at ${view.time}`)
  const length = view.minutes ? `${view.minutes} minutes` : ''
  const medium = view.medium ? `on ${view.medium}` : ''
  const tail = [length, medium].filter(Boolean).join(' ')
  if (tail) parts.push(tail)
  return parts.join(', ')
}

const POLL_MS = 4000

/**
 * The meeting named by a day and a slug: its view and its document, read
 * once and re-read when the file changes on disk — a save in the explorer,
 * a line an extension adds — so the page keeps up in place.
 */
export function useMeetingPage(
  ymd: string,
  slug: string,
): { view: MeetingView | null; doc: ExplorerDoc | null; missing: boolean } {
  const [view, setView] = useState<MeetingView | null>(null)
  const [doc, setDoc] = useState<ExplorerDoc | null>(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let alive = true
    let version: number | null = null
    let file: string | null = null
    setMissing(false)
    const read = async () => {
      try {
        const r = await fetch(`/explorer/_api/meeting?day=${encodeURIComponent(ymd)}&slug=${encodeURIComponent(slug)}`)
        if (!alive) return
        if (r.status === 404) {
          setMissing(true)
          return
        }
        if (!r.ok) return
        const next = (await r.json()) as MeetingView
        const d = await fetch(`/explorer/_api/doc?path=${encodeURIComponent(next.path)}`)
        if (!alive) return
        const body = d.ok ? ((await d.json()) as ExplorerDoc) : null
        if (!alive) return
        file = next.path
        version = body?.version ?? null
        setView(next)
        setDoc(body)
        setMissing(false)
      } catch {
        // The next tick tries again.
      }
    }
    void read()
    const timer = window.setInterval(async () => {
      if (!file) return void read()
      try {
        const r = await fetch(`/docs/_api/content/${file.split('/').map(encodeURIComponent).join('/')}?meta=1`)
        if (!r.ok || !alive) return
        const meta = (await r.json()) as { version: number }
        if (meta.version !== version) await read()
      } catch {
        // The next tick tries again.
      }
    }, POLL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [ymd, slug])
  return { view, doc, missing }
}

function inPlace(go: () => void) {
  return (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    go()
  }
}

function Initials({ name }: { name: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <span className="sky-people-avatar" data-large="true" data-kind="person" aria-hidden="true">
      {letters || '·'}
    </span>
  )
}

/** Above the body: the title and one line of context, the way a person's page opens. */
export function MeetingHeader({ view, navigate }: { view: MeetingView; navigate: (to: string) => void }) {
  const who = view.who
  return (
    <header className="sky-people-profile-header sky-meeting-header">
      <Initials name={who[0]?.name ?? view.title} />
      <div>
        <h1>{view.title}</h1>
        <p>
          {who.length > 0 && (
            <>
              With{' '}
              {who.map((person, index) => (
                <Fragment key={person.name}>
                  {index > 0 && (index === who.length - 1 ? ' and ' : ', ')}
                  {person.href ? (
                    <a
                      href={person.href}
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button) return
                        event.preventDefault()
                        navigate(person.href!)
                      }}
                    >
                      {person.name}
                    </a>
                  ) : (
                    person.name
                  )}
                </Fragment>
              ))}
              {whenLine(view) ? ', ' : ''}
            </>
          )}
          {whenLine(view)}
        </p>
      </div>
    </header>
  )
}

/** The column beside the body, in the person page's vocabulary. */
export function MeetingRail({
  view,
  file,
  state,
  navigate,
  onToggle,
}: {
  view: MeetingView | null
  file: string
  state: FrontmatterState
  navigate: (to: string) => void
  /** Folds the column away — the chevron in its corner */
  onToggle?: () => void
}) {
  const rows = state.rows.filter((row) => homeOf(row.kind) === 'rail')
  const files = rows.filter((row) => railSectionOf(row.kind) === 'files')
  const tags = rows.filter((row) => railSectionOf(row.kind) === 'tags')
  const row = (r: (typeof state.rows)[number]) => (
    <Fragment key={r.key}>
      <PropRow
        row={r}
        file={file}
        readOnly
        resolved={state.resolved}
        focusKey={state.focusKey}
        body={state.body}
        commit={state.commit}
      />
    </Fragment>
  )
  const link = (href: string, label: string) => (
    <a
      href={href}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button) return
        event.preventDefault()
        navigate(href)
      }}
    >
      {label}
    </a>
  )
  const ordinal = (n: number) =>
    `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`

  return (
    <aside className="sky-rail sky-meeting-rail" aria-label="Meeting details">
      {onToggle ? (
        <div className="sky-rail-head">
          <RailToggle open onClick={onToggle} />
        </div>
      ) : null}
      {view ? (
        <>
          <h2>Details</h2>
          <dl>
            {view.who.length > 0 && (
              <>
                <dt>Who</dt>
                <dd>
                  {view.who.map((person) => (
                    <div key={person.name} className="sky-meeting-person">
                      {person.href ? link(person.href, person.name) : <span>{person.name}</span>}
                      {(person.title || person.org) && (
                        <small>{[person.title, person.org].filter(Boolean).join(', ')}</small>
                      )}
                      {person.meetings > 0 && (
                        <small>
                          {ordinal(person.meetings)} meeting
                          {person.met ? `, first met ${shortDate(person.met.slice(0, 10))}` : ''}
                        </small>
                      )}
                    </div>
                  ))}
                </dd>
              </>
            )}
            {(view.day || view.time) && (
              <>
                <dt>When</dt>
                <dd>
                  <span>
                    {view.day ? `${weekdayOf(view.day)}, ${shortDate(view.day)}` : ''}
                    {view.time ? `${view.day ? ' at ' : ''}${view.time}` : ''}
                  </span>
                  {(view.minutes || view.medium) && (
                    <small>
                      {[view.minutes ? `${view.minutes} minutes` : '', view.medium].filter(Boolean).join(', ')}
                    </small>
                  )}
                </dd>
              </>
            )}
            {view.about.length > 0 && (
              <>
                <dt>About</dt>
                <dd>
                  {view.about.map((ref) => (
                    <span key={ref.label}>{ref.href ? link(ref.href, ref.label) : ref.label}</span>
                  ))}
                </dd>
              </>
            )}
          </dl>
          {view.previous.length > 0 && (
            <section>
              <h3>Previous meetings</h3>
              <ul>
                {view.previous.map((m) => (
                  <li key={m.path}>
                    <span className="sky-meeting-date">{shortDate(m.date)}</span>
                    {link(m.href, m.title)}
                  </li>
                ))}
              </ul>
              {view.allWith && view.allWith.count > view.previous.length + 1 && (
                <a
                  className="sky-meeting-all"
                  href={view.allWith.href}
                  onClick={(e) => {
                    e.preventDefault()
                    navigate(view.allWith!.href)
                  }}
                >
                  All {view.allWith.count} meetings with {view.allWith.name.split(' ')[0]}
                </a>
              )}
            </section>
          )}
          {view.next && (
            <section>
              <h3>Next</h3>
              <ul>
                <li>
                  <span className="sky-meeting-date">{shortDate(view.next.date)}</span>
                  {link(view.next.href, view.next.title)}
                </li>
              </ul>
            </section>
          )}
        </>
      ) : (
        <p className="sky-meeting-note">Reading the meeting…</p>
      )}
      {files.length > 0 && (
        <section>
          <h3>Files</h3>
          {files.map(row)}
        </section>
      )}
      {tags.length > 0 && (
        <section>
          <h3>Tags</h3>
          {tags.map(row)}
        </section>
      )}
      <ExtensionFileCards file={file} />
    </aside>
  )
}

/** The page: the day as the way back, the header, the trimmed write-up, and the column. */
export function MeetingMain({ ymd, slug, go }: { ymd: string; slug: string; go: (to: string) => void }) {
  const { view, doc, missing } = useMeetingPage(ymd, slug)
  const file = view?.path ?? ''
  const frontmatter = useFrontmatter(doc?.frontmatter ? doc.frontmatter : null, file)
  const { open: railOpen, toggle: toggleRail } = useRail(`${ymd}/${slug}`)
  const [scale] = useDocScale()
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0)
  }, [ymd, slug])
  const day = `/${ymd}`
  const ready = view !== null && doc !== null

  return (
    <div className="sky-main sky-main-rail" data-rail={railOpen ? 'open' : 'closed'}>
      <div className="sky-doc-column">
        <header className="sky-head">
          <span className="sky-title sky-crumbs">
            <span className="sky-crumb-dirs">
              <a className="sky-crumb" href={day} onClick={inPlace(() => go(day))}>
                {shortDate(ymd)}
              </a>
              <span className="sky-crumb-sep">›</span>
            </span>
            <span className="sky-crumb-name">Meeting</span>
          </span>
          {ready && (
            <nav className="sky-tabs">
              <ExtensionFileActions file={file} />
              {/* Editing belongs to the explorer, where the file is shown as written. */}
              <Button size="sm" onClick={() => go(`${fileHref(file)}?edit`)}>
                Edit
              </Button>
              {!railOpen && <RailToggle open={false} onClick={toggleRail} />}
              <Menu position="bottom-end" shadow="md" width={220}>
                <Menu.Target>
                  <ActionIcon size="lg" aria-label="More">
                    ⋯
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item onClick={() => go(fileHref(file))}>Open in Explorer</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </nav>
          )}
        </header>
        <div className="sky-scroll" ref={scrollRef}>
          {missing ? (
            <div className="sky-blank">
              <p>
                There is no meeting called <code>{slug}</code> on {shortDate(ymd)}.
              </p>
            </div>
          ) : ready ? (
            <article className="sky-doc" style={{ '--sky-doc-scale': scale } as CSSProperties}>
              <MeetingHeader view={view} navigate={go} />
              {doc.html ? (
                <RenderedBody html={trimMeetingHtml(doc.html)} />
              ) : (
                <p className="sky-doc-empty">This file is empty.</p>
              )}
            </article>
          ) : null}
        </div>
      </div>
      {ready && railOpen ? (
        <MeetingRail view={view} file={file} state={frontmatter} navigate={go} onToggle={toggleRail} />
      ) : null}
    </div>
  )
}
