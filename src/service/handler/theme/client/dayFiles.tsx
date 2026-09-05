/**
 * The day's files as a page: /<ymd>/files is what the day keeps — the rail's
 * pad, the captures, the desktop sweep all leave files here — folders and
 * all, one row each: the kind, the name, the note that lists it, the size.
 * A folder opens in place and the crumb deepens; a file opens in a new tab.
 * A file or a whole folder leaves for the Mac's Trash by the × after its name
 * (a swipe on the phone), or several at once through Select; the toast says
 * what went and holds Undo for a moment.
 */

import { Button, Checkbox } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { Fragment, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Cross } from './day.tsx'
import { fileHref } from './explorer.tsx'
import { dayFileHref, type DayListing, filesHref, type ListedBy, readListing } from './files.tsx'
import { post, sizeLabel } from './keep.ts'
import { revealOpacity, useSwipeToDelete } from './swipe.ts'

// -----------------------------------------------------------------------------
// What the service says
// -----------------------------------------------------------------------------

/** What one row stands for — a folder or a file, by its path inside the day's files. */
export interface Entry {
  /** Relative to the day's files, `photos/a.jpg` */
  path: string
  name: string
  folder: boolean
  /** A folder's files, 1 for a file */
  files: number
  size: number
  kind: string
  listedBy?: ListedBy
}

/** What went to the Trash — the toast's words, and what Undo reverses. */
export interface Removed {
  path: string
  name: string
  folder: boolean
  files: number
  moveId: string
}

// -----------------------------------------------------------------------------
// Paths
// -----------------------------------------------------------------------------

export interface FilesRoute {
  ymd: string
  /** '' for the day's files, else the folder open */
  folder: string
}

/** `/2026-09-03/files` is a day's files, `/2026-09-03/files/photos/raw` a folder inside; null for any other path. */
export function filesRouteOf(pathname: string): FilesRoute | null {
  const match = /^\/(\d{4}-\d{2}-\d{2})\/files(?:\/(.*))?$/.exec(pathname)
  if (!match) return null
  try {
    const folder = (match[2] ?? '')
      .split('/')
      .filter((segment) => segment.length > 0)
      .map(decodeURIComponent)
      .join('/')
    return { ymd: match[1]!, folder }
  } catch {
    return null
  }
}

/** The rows of a listing: folders first, then files, each by its path inside the day's files. */
export function entriesOf(listing: DayListing): Entry[] {
  const at = (name: string) => (listing.path ? `${listing.path}/${name}` : name)
  return [
    ...listing.folders.map(
      (f): Entry => ({ path: at(f.name), name: f.name, folder: true, files: f.files, size: f.size, kind: 'folder' }),
    ),
    ...listing.files.map(
      (f): Entry => ({
        path: at(f.name),
        name: f.name,
        folder: false,
        files: 1,
        size: f.size,
        kind: f.kind,
        ...(f.listedBy ? { listedBy: f.listedBy } : {}),
      }),
    ),
  ]
}

// -----------------------------------------------------------------------------
// Words
// -----------------------------------------------------------------------------

/** `Thu, Sep 3` — the day for a narrow crumb, where the page's full label would not fit. */
export function shortLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** A long file name shortened in the middle for a toast, its start and its ending kept. */
export function shortName(name: string, max = 44): string {
  if (name.length <= max) return name
  const keep = Math.floor((max - 1) / 2)
  return `${name.slice(0, keep)}…${name.slice(name.length - keep)}`
}

/** `1 file`, `12 files` */
export function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** `118 MB`, `1.2 GB` — a total, where the day runs past megabytes */
export function totalLabel(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  return sizeLabel(bytes)
}

/** `13 files, 1 folder · 118 MB` — what the page holds; the folders' files counted in the bytes, not the count. */
export function holdsLine(listing: DayListing): string {
  const parts: string[] = []
  if (listing.files.length > 0 || listing.folders.length === 0) parts.push(count(listing.files.length, 'file'))
  if (listing.folders.length > 0) parts.push(count(listing.folders.length, 'folder'))
  const bytes =
    listing.files.reduce((total, f) => total + f.size, 0) + listing.folders.reduce((total, f) => total + f.size, 0)
  return bytes > 0 ? `${parts.join(', ')} · ${totalLabel(bytes)}` : parts.join(', ')
}

/** The toast's sentence: what went to the Trash. */
export function removedLine(items: Removed[]): string {
  const first = items[0]
  if (!first) return ''
  if (items.length === 1) {
    const name = shortName(first.name)
    if (first.folder && first.files > 0) return `Moved “${name}” and its ${count(first.files, 'file')} to the Trash`
    return `Moved “${name}” to the Trash`
  }
  const folders = items.filter((item) => item.folder).length
  const files = items.length - folders
  const parts: string[] = []
  if (folders > 0) parts.push(count(folders, 'folder'))
  if (files > 0) parts.push(count(files, 'file'))
  return `Moved ${parts.join(' and ')} to the Trash`
}

/** The extension as a chip, or the kind when the extension says less. */
function extChip(entry: Entry): string {
  const dot = entry.name.lastIndexOf('.')
  const ext = dot > 0 ? entry.name.slice(dot + 1).toUpperCase() : ''
  return ext.length > 0 && ext.length <= 5 ? ext : entry.kind.toUpperCase()
}

// -----------------------------------------------------------------------------
// The service
// -----------------------------------------------------------------------------

async function removeEntry(ymd: string, entry: Entry): Promise<Removed> {
  const answer = await post<{ moveId: string; folder: boolean; files: number }>(`/day/${ymd}/files/remove`, {
    path: entry.path,
  })
  return { path: entry.path, name: entry.name, folder: answer.folder, files: answer.files, moveId: answer.moveId }
}

/** Everything the toast holds comes back out of the Trash. */
async function undoRemoved(ymd: string, items: Removed[]): Promise<void> {
  for (const item of items) await post(`/day/${ymd}/files/undo`, { moveId: item.moveId })
}

/** The Finder, on the folder the page shows. */
async function showInFinder(ymd: string, folder: string): Promise<void> {
  await post(`/day/${ymd}/files/reveal`, { path: folder })
}

const POLL_MS = 6000

/**
 * The listing, read once and re-read every few seconds while the tab shows,
 * so a capture from the terminal or a sweep lands here without a reload.
 */
function useListing(ymd: string, folder: string) {
  const [listing, setListing] = useState<DayListing | null>(null)
  const [missing, setMissing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((v) => v + 1), [])
  useEffect(() => {
    let alive = true
    const read = async () => {
      if (document.hidden) return
      try {
        const next = await readListing(ymd, folder)
        if (!alive) return
        setListing(next)
        setMissing(false)
        setProblem(null)
      } catch (err) {
        if (!alive) return
        if ((err as Error).message === 'not there') setMissing(true)
        else setProblem((err as Error).message)
      }
    }
    void read()
    const timer = window.setInterval(() => void read(), POLL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [ymd, folder, version])
  // A new folder shows fresh, not the last one's rows.
  useEffect(() => {
    setListing(null)
    setMissing(false)
  }, [ymd, folder])
  return { listing, missing, problem, reload }
}

// -----------------------------------------------------------------------------
// Rows
// -----------------------------------------------------------------------------

const LEAVE_MS = 380
const TOAST_MS = 8000

/** A plain left click on a link: the page turns in place; anything else is the browser's. */
function inPlace(go: () => void) {
  return (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    go()
  }
}

/**
 * One folder or file. The name opens it; the × after the name (a hover
 * shows it) or a swipe on the phone sends it to the Trash. Selecting, the
 * row is a checkbox and its label.
 */
function FileRow({
  ymd,
  entry,
  leaving,
  selecting,
  picked,
  onPick,
  onOpenFolder,
  onRemove,
}: {
  ymd: string
  entry: Entry
  leaving: boolean
  selecting: boolean
  picked: boolean
  onPick: (entry: Entry) => void
  onOpenFolder: (folder: string) => void
  onRemove: (entry: Entry) => void
}) {
  const swipe = useSwipeToDelete(() => onRemove(entry))
  useEffect(() => {
    if (!leaving) swipe.close()
  }, [leaving])
  const Front = selecting ? 'label' : 'div'
  const size = entry.folder ? count(entry.files, 'file') : sizeLabel(entry.size)
  const name = selecting ? (
    entry.name
  ) : entry.folder ? (
    <a href={filesHref(ymd, entry.path)} onClick={inPlace(() => onOpenFolder(entry.path))}>
      {entry.name}
    </a>
  ) : (
    <a href={dayFileHref(ymd, entry.path)} target="_blank" rel="noreferrer">
      {entry.name}
    </a>
  )
  return (
    <div
      className="sky-frow sky-irow"
      data-phase={leaving ? 'removed' : undefined}
      data-folder={entry.folder || undefined}
      data-picked={picked || undefined}
      ref={swipe.ref}
    >
      {swipe.offset < 0 && !selecting && (
        <div className="sky-irow-back" style={{ width: -swipe.offset }}>
          <button
            type="button"
            className="sky-irow-delete"
            style={{ opacity: revealOpacity(swipe.offset) }}
            tabIndex={swipe.open ? 0 : -1}
            onClick={swipe.commit}
          >
            Delete
          </button>
        </div>
      )}
      <Front
        className="sky-irow-front sky-frow-front"
        data-dragging={swipe.dragging || undefined}
        style={swipe.offset ? { transform: `translateX(${swipe.offset}px)` } : undefined}
        onClickCapture={(event: MouseEvent) => {
          // A tap on an open row puts it back; nothing under the finger fires.
          if (!swipe.open) return
          event.preventDefault()
          event.stopPropagation()
          swipe.close()
        }}
        {...(selecting ? {} : swipe.handlers)}
      >
        {selecting && <Checkbox checked={picked} onChange={() => onPick(entry)} aria-label={entry.name} />}
        <span className="sky-fkind">{entry.folder ? <span className="sky-fchev">▸</span> : extChip(entry)}</span>
        <span className="sky-fmain">
          <span className="sky-fname">
            {name}
            {!selecting && (
              <button
                type="button"
                className="sky-x"
                aria-label="Move to the Trash"
                title="Move to the Trash"
                onClick={() => onRemove(entry)}
              >
                <Cross />
              </button>
            )}
          </span>
          <span className="sky-fmeta">
            <span className="sky-fmeta-size">{entry.folder ? size : `${extChip(entry)} · ${size}`}</span>
            {entry.listedBy && (
              <a className="sky-fnote" href={fileHref(entry.listedBy.path)}>
                {entry.listedBy.title}
              </a>
            )}
          </span>
        </span>
        <span className="sky-fsize">{size}</span>
      </Front>
    </div>
  )
}

// -----------------------------------------------------------------------------
// The page
// -----------------------------------------------------------------------------

export function DayFilesMain({ ymd, folder, go }: { ymd: string; folder: string; go: (to: string) => void }) {
  const { listing, missing, problem, reload } = useListing(ymd, folder)
  const phone = useMediaQuery('(max-width: 900px)') ?? false
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [leaving, setLeaving] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [toast, setToast] = useState<{ items: Removed[]; key: number } | null>(null)
  const toastKey = toast?.key ?? null
  const scrollRef = useRef<HTMLDivElement>(null)

  // The toast holds Undo for a moment; a later removal joins it and the moment starts again.
  useEffect(() => {
    if (toastKey === null) return
    const timer = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toastKey])
  useEffect(() => {
    setSelecting(false)
    setPicked(new Set())
    scrollRef.current?.scrollTo(0, 0)
  }, [ymd, folder])

  const entries = listing ? entriesOf(listing) : []
  const segments = folder ? folder.split('/') : []
  const label = phone ? shortLabel(ymd) : (listing?.label ?? ymd)
  const openFolder = (next: string) => go(filesHref(ymd, next))

  /** Out to the Trash, one after another; the rows fold first, the list re-reads after. */
  const remove = async (targets: Entry[]) => {
    if (targets.length === 0 || busy) return
    setBusy(true)
    setTrouble(null)
    setLeaving((prev) => new Set([...prev, ...targets.map((t) => t.path)]))
    const done: Removed[] = []
    try {
      for (const target of targets) done.push(await removeEntry(ymd, target))
    } catch (err) {
      setTrouble((err as Error).message)
    }
    if (done.length > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, LEAVE_MS))
      setToast((prev) => ({ items: [...(prev?.items ?? []), ...done], key: Date.now() }))
    }
    reload()
    setLeaving(new Set())
    setPicked(new Set())
    setSelecting(false)
    setBusy(false)
  }

  const undo = async () => {
    const items = toast?.items ?? []
    setToast(null)
    try {
      await undoRemoved(ymd, items)
    } catch (err) {
      setTrouble((err as Error).message)
    }
    reload()
  }

  const pick = (entry: Entry) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      return next
    })
  const pickedEntries = entries.filter((e) => picked.has(e.path))
  const pickedBytes = pickedEntries.reduce((total, e) => total + e.size, 0)
  const reveal = async () => {
    setTrouble(null)
    try {
      await showInFinder(ymd, folder)
    } catch (err) {
      setTrouble((err as Error).message)
    }
  }

  return (
    <div className="sky-main sky-files">
      <header className="sky-head">
        <span className="sky-title sky-crumbs">
          {/* The day, then the section, then the folders: the last one stays when the rest give way. */}
          <span className="sky-crumb-dirs">
            <a className="sky-crumb" href={`/${ymd}`} onClick={inPlace(() => go(`/${ymd}`))}>
              {label}
            </a>
            <span className="sky-crumb-sep">›</span>
            {segments.length > 0 && (
              <>
                <a className="sky-crumb" href={filesHref(ymd)} onClick={inPlace(() => openFolder(''))}>
                  File Attachments
                </a>
                <span className="sky-crumb-sep">›</span>
              </>
            )}
            {segments.slice(0, -1).map((segment, i) => {
              const upTo = segments.slice(0, i + 1).join('/')
              return (
                <span key={upTo}>
                  <a className="sky-crumb" href={filesHref(ymd, upTo)} onClick={inPlace(() => openFolder(upTo))}>
                    {segment}
                  </a>
                  <span className="sky-crumb-sep">›</span>
                </span>
              )
            })}
          </span>
          <span className="sky-crumb-name">
            {segments.length > 0 ? segments[segments.length - 1] : 'File Attachments'}
          </span>
        </span>
        {/* The Finder is on this Mac, not in a pocket: the button is a desk thing. */}
        {!phone && !missing ? (
          <nav className="sky-tabs">
            <Button size="sm" onClick={() => void reveal()}>
              Show in Finder
            </Button>
          </nav>
        ) : null}
      </header>

      <div className="sky-scroll" ref={scrollRef}>
        <div className="sky-col sky-fcol">
          {missing ? (
            <div className="sky-blank">
              <p>This folder is not there.</p>
            </div>
          ) : listing === null ? null : entries.length === 0 ? (
            <div className="sky-blank">
              <p>{folder ? 'This folder is empty.' : 'Nothing kept with this day yet.'}</p>
            </div>
          ) : (
            <>
              <div className="sky-fsum">
                {selecting ? (
                  <>
                    <span>
                      {count(picked.size, 'item').replace(/^(\d+) items?$/, '$1 selected')}
                      {pickedBytes > 0 ? ` · ${totalLabel(pickedBytes)}` : ''}
                    </span>
                    <span className="sky-fsum-acts">
                      <Button
                        size="compact-sm"
                        color="red"
                        variant="light"
                        disabled={picked.size === 0 || busy}
                        onClick={() => void remove(pickedEntries)}
                      >
                        {picked.size > 0 ? `Move ${picked.size} to the Trash` : 'Move to the Trash'}
                      </Button>
                      <Button size="compact-sm" variant="subtle" onClick={() => setSelecting(false)}>
                        Cancel
                      </Button>
                    </span>
                  </>
                ) : (
                  <>
                    <span>{holdsLine(listing)}</span>
                    <button type="button" className="sky-fsum-select" onClick={() => setSelecting(true)}>
                      Select
                    </button>
                  </>
                )}
              </div>
              <div className="sky-flist">
                {entries.map((entry) => (
                  <Fragment key={entry.path}>
                    <FileRow
                      ymd={ymd}
                      entry={entry}
                      leaving={leaving.has(entry.path)}
                      selecting={selecting}
                      picked={picked.has(entry.path)}
                      onPick={pick}
                      onOpenFolder={openFolder}
                      onRemove={(target) => void remove([target])}
                    />
                  </Fragment>
                ))}
              </div>
            </>
          )}
          {problem || trouble ? <p className="sky-rail-problem">{trouble ?? problem}</p> : null}
        </div>
      </div>

      {toast && (
        <div className="sky-undo sky-fundo" key={toast.key}>
          <span className="sky-undo-tick" data-how="deleted">
            <Cross />
          </span>
          <span className="sky-undo-text">{removedLine(toast.items)}</span>
          <button type="button" className="sky-undo-btn" onClick={() => void undo()}>
            Undo
          </button>
          <span className="sky-undo-track">
            <span className="sky-undo-fill" />
          </span>
        </div>
      )}
    </div>
  )
}
