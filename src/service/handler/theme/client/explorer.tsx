import { ActionIcon, Button, Menu } from '@mantine/core'
import {
  type CSSProperties,
  Fragment,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { IdentityLine } from './frontmatter/Identity.tsx'
import { useOutline } from './frontmatter/outline.ts'
import { DocumentRail } from './frontmatter/Rail.tsx'
import { useFrontmatter } from './frontmatter/useFrontmatter.ts'
import { useRail } from './rail.ts'
import { RailToggle } from './railToggle.tsx'
import { highlightCodeBlocks } from './wysiwyg/highlight.ts'
import { type EditorHandle, type EditorStatusKind, mountEditor } from './wysiwyg/mod.ts'

/**
 * The explorer. The sidebar is the tree — a directory lists itself when
 * opened, never the whole notebook at once — and the column is the page
 * open in it: a file rendered to read (or, after Edit, as blocks to change
 * in place), a directory as the files it holds. A page is its path:
 * /explorer/<path>; /explorer itself lists the roots.
 */

export interface ExplorerEntry {
  name: string
  /** Relative to the notebook root */
  path: string
  kind: 'dir' | 'file'
}

interface Listing {
  path: string
  entries: ExplorerEntry[]
}

export interface ExplorerDoc {
  path: string
  frontmatter: string
  html: string
  version: number
  /** The day a document under time/ belongs to, `YYYY-MM-DD` */
  day?: string
}

/** The page for a notebook file. */
export function fileHref(path: string): string {
  return `/explorer/${path.split('/').map(encodeURIComponent).join('/')}`
}

/** `../people/Jane.md` seen from `time/2026/08/24-30/08-28` — a link as a document writes it, as a notebook path. */
export function resolvePath(fromDir: string, link: string): string {
  if (/^[a-z]+:/i.test(link) || link.startsWith('/')) return link
  const parts = fromDir ? fromDir.split('/') : []
  for (const part of link.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  return parts.join('/')
}

/** The notebook path a URL names: '' for the explorer itself, null when the URL is another page. */
export function explorerFileOf(pathname: string): string | null {
  if (pathname === '/explorer') return ''
  if (!pathname.startsWith('/explorer/')) return null
  try {
    return pathname.slice('/explorer/'.length).split('/').map(decodeURIComponent).join('/')
  } catch {
    return ''
  }
}

/** The directories above a file, outermost first: `a/b/c.md` → `a`, `a/b`. */
function ancestorsOf(file: string): string[] {
  const parts = file.split('/').slice(0, -1)
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

function encodeSegments(file: string): string {
  return file.split('/').map(encodeURIComponent).join('/')
}

/** What the tree knows about a directory: not yet, on its way, gone, or its entries. */
type Known = 'loading' | 'missing' | ExplorerEntry[]

// -----------------------------------------------------------------------------
// The tree
// -----------------------------------------------------------------------------

export function Tree({ file, onOpen }: { file: string; onOpen: (path: string) => void }) {
  const [dirs, setDirs] = useState<Record<string, Known>>({})
  const [open, setOpen] = useState<Set<string>>(() => new Set(ancestorsOf(file)))
  const asked = useRef(new Set<string>())

  // Each directory is listed once, the first time it is needed.
  const load = useCallback((dir: string) => {
    if (asked.current.has(dir)) return
    asked.current.add(dir)
    setDirs((prev) => ({ ...prev, [dir]: 'loading' }))
    fetch(`/explorer/_api/dir${dir ? `?path=${encodeURIComponent(dir)}` : ''}`)
      .then(async (r) => (r.ok ? ((await r.json()) as Listing).entries : 'missing'))
      .catch((): Known => 'missing')
      .then((known) => setDirs((prev) => ({ ...prev, [dir]: known })))
  }, [])

  useEffect(() => load(''), [load])

  // The open file's branch unfolds down to it.
  useEffect(() => {
    const above = ancestorsOf(file)
    if (above.length === 0) return
    setOpen((prev) => new Set([...prev, ...above]))
    for (const dir of above) load(dir)
  }, [file, load])

  // …and its row comes into view once the branch has loaded — once per file, not on every listing.
  const shown = useRef('')
  useEffect(() => {
    if (!file || shown.current === file) return
    const row = document.querySelector<HTMLElement>('.sky-tree-row[data-active="true"]')
    if (!row) return
    shown.current = file
    row.scrollIntoView({ block: 'nearest' })
  }, [file, dirs])

  const toggle = (dir: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
    load(dir)
  }

  return (
    <div className="sky-tree">
      <Rows dir="" depth={0} dirs={dirs} open={open} file={file} toggle={toggle} onOpen={onOpen} />
    </div>
  )
}

function Rows({
  dir,
  depth,
  dirs,
  open,
  file,
  toggle,
  onOpen,
}: {
  dir: string
  depth: number
  dirs: Record<string, Known>
  open: Set<string>
  file: string
  toggle: (dir: string) => void
  onOpen: (path: string) => void
}) {
  const known = dirs[dir]
  const indent = { paddingLeft: 10 + depth * 16 }
  // A note sits where the names do — past the chevron's width.
  const noteIndent = { paddingLeft: 28 + depth * 16 }
  if (known === undefined || known === 'loading') {
    return (
      <div className="sky-tree-note" style={noteIndent}>
        …
      </div>
    )
  }
  if (known === 'missing') {
    return (
      <div className="sky-tree-note" style={noteIndent}>
        Not there
      </div>
    )
  }
  if (known.length === 0) {
    return (
      <div className="sky-tree-note" style={noteIndent}>
        Empty
      </div>
    )
  }
  return (
    <>
      {known.map((entry) =>
        entry.kind === 'dir' ? (
          <Fragment key={entry.path}>
            <button
              type="button"
              className="sky-tree-row"
              data-kind="dir"
              data-open={open.has(entry.path)}
              data-active={entry.path === file}
              data-branch={file.startsWith(`${entry.path}/`)}
              style={indent}
              onClick={() => toggle(entry.path)}
            >
              <span className="sky-tree-chev">▸</span>
              <span className="sky-tree-name">{entry.name}</span>
            </button>
            {open.has(entry.path) && (
              <Rows
                dir={entry.path}
                depth={depth + 1}
                dirs={dirs}
                open={open}
                file={file}
                toggle={toggle}
                onOpen={onOpen}
              />
            )}
          </Fragment>
        ) : (
          <button
            key={entry.path}
            type="button"
            className="sky-tree-row"
            data-kind="file"
            data-active={entry.path === file}
            style={indent}
            onClick={() => onOpen(entry.path)}
          >
            <span className="sky-tree-chev" />
            <span className="sky-tree-name">{entry.name.replace(/\.md$/i, '')}</span>
          </button>
        ),
      )}
    </>
  )
}

// -----------------------------------------------------------------------------
// The file
// -----------------------------------------------------------------------------

const POLL_MS = 4000

/**
 * What the path names — a file rendered, or a directory listed — read once
 * and re-read whenever it changes on disk: a save or a new capture from the
 * terminal or another session shows up here within seconds, in place.
 */
function useDoc(file: string, paused: boolean): { doc: ExplorerDoc | null; listing: Listing | null; missing: boolean } {
  const [doc, setDoc] = useState<ExplorerDoc | null>(null)
  const [listing, setListing] = useState<Listing | null>(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    // While the editor has the file it does the watching; when it hands back, this reads afresh.
    if (paused) return
    setMissing(false)
    let alive = true
    let shown: 'doc' | 'dir' | null = null
    let version: number | null = null
    let listed = ''
    const read = async (): Promise<ExplorerDoc | null> => {
      try {
        const r = await fetch(`/explorer/_api/doc?path=${encodeURIComponent(file)}`)
        return r.ok ? ((await r.json()) as ExplorerDoc) : null
      } catch {
        return null
      }
    }
    const list = async (): Promise<Listing | null> => {
      try {
        const r = await fetch(`/explorer/_api/dir${file ? `?path=${encodeURIComponent(file)}` : ''}`)
        return r.ok ? ((await r.json()) as Listing) : null
      } catch {
        return null
      }
    }
    const showDoc = (body: ExplorerDoc) => {
      shown = 'doc'
      version = body.version
      setDoc(body)
      setListing(null)
      setMissing(false)
    }
    const showDir = (body: Listing) => {
      shown = 'dir'
      listed = JSON.stringify(body.entries)
      setListing(body)
      setDoc(null)
      setMissing(false)
    }
    // A path is tried as a file first, then as a directory; '' is the roots.
    // The last page stays on screen until this one arrives — no blank in between.
    const resolve = async () => {
      const body = file ? await read() : null
      if (!alive) return
      if (body) return showDoc(body)
      const dir = await list()
      if (!alive) return
      if (dir) showDir(dir)
      else if (file) setMissing(true)
    }
    void resolve()
    const timer = window.setInterval(async () => {
      if (shown === 'doc') {
        try {
          const r = await fetch(`/docs/_api/content/${encodeSegments(file)}?meta=1`)
          if (!r.ok || !alive) return
          const meta = (await r.json()) as { version: number }
          if (meta.version === version) return
          const body = await read()
          if (alive && body) showDoc(body)
        } catch {
          // The next tick tries again.
        }
      } else if (shown === 'dir') {
        const dir = await list()
        if (alive && dir && JSON.stringify(dir.entries) !== listed) showDir(dir)
      } else {
        // Nothing there yet — it may appear.
        await resolve()
      }
    }, POLL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [file, paused])
  return { doc, listing, missing }
}

// The reader's text size, kept across files and visits.
const SCALE_KEY = 'sky-doc-scale'
const SCALE_MIN = 0.8
const SCALE_MAX = 1.4
const SCALE_STEP = 0.1

function clampScale(value: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(value * 10) / 10))
}

function useDocScale(): [number, (next: number) => void] {
  const [scale, setScale] = useState(() => {
    try {
      const stored = Number.parseFloat(localStorage.getItem(SCALE_KEY) ?? '1')
      return Number.isFinite(stored) ? clampScale(stored) : 1
    } catch {
      return 1
    }
  })
  const set = (next: number) => {
    const value = clampScale(next)
    setScale(value)
    try {
      localStorage.setItem(SCALE_KEY, String(value))
    } catch {
      // Then the size lasts for this visit only.
    }
  }
  return [scale, set]
}

/** A word in the header about what just happened, gone again after a moment. */
function useNote(): [string | null, (text: string | null, holdMs?: number) => void] {
  const [note, setNote] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const say = useCallback((text: string | null, holdMs = 4000) => {
    window.clearTimeout(timer.current)
    setNote(text)
    if (text && Number.isFinite(holdMs)) timer.current = window.setTimeout(() => setNote(null), holdMs)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return [note, say]
}

type EditorStatus = { kind: EditorStatusKind | 'loading'; text: string }

/** An image source as written in a file → the URL that serves it: notebook-relative paths go through the file API. */
function resolveImageSrc(file: string, src: string): string {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(src)) return src
  const parts = file.split('/').slice(0, -1)
  for (const part of src.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(decodeSegment(part))
  }
  return `/docs/_api/file/${parts.map(encodeURIComponent).join('/')}`
}

/** A path segment as written in markdown — percent-encoded or not — as the name on disk. */
function decodeSegment(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/** The caret leaves the document upward: the identity line's last field takes it. */
function focusIdentityInput() {
  const inputs = document.querySelectorAll<HTMLElement>(
    '.sky-identity:not([data-readonly]) input, .sky-identity:not([data-readonly]) textarea',
  )
  inputs[inputs.length - 1]?.focus()
}

/**
 * The editor, mounted into the column for one file: the file read once, then
 * its own DOM until the file changes or editing ends. What it reports — status,
 * a conflict — goes up to the header through the hooks.
 */
function Editor({
  file,
  handle,
  onStatus,
  onConflict,
  onFrontmatter,
}: {
  file: string
  handle: RefObject<EditorHandle | null>
  onStatus: (status: EditorStatus) => void
  onConflict: (visible: boolean) => void
  /** The front matter as the editor holds it — on open, and after undo, reload or `---` */
  onFrontmatter: (text: string | null) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let alive = true
    let mounted: EditorHandle | null = null
    onStatus({ kind: 'loading', text: 'Opening…' })
    onConflict(false)
    onFrontmatter(null)
    void (async () => {
      try {
        const apiPath = `/docs/_api/content/${encodeSegments(file)}`
        const r = await fetch(apiPath)
        const body = (await r.json()) as { message?: string; content: string; version: number }
        if (!r.ok) throw new Error(body.message ?? 'Could not open the file to edit')
        if (!alive) return
        mounted = mountEditor(
          root,
          {
            apiPath,
            attachPath: `/docs/_api/attach/${encodeSegments(file)}`,
            content: body.content,
            version: body.version,
            resolveImage: (src) => resolveImageSrc(file, src),
            hideFrontmatter: true,
          },
          {
            onStatus: (kind, text) => onStatus({ kind, text }),
            onConflict,
            onFrontmatter,
            onReachTop: focusIdentityInput,
          },
        )
        handle.current = mounted
        onFrontmatter(mounted.frontmatter())
      } catch (err) {
        if (alive)
          onStatus({ kind: 'error', text: err instanceof Error ? err.message : 'Could not open the file to edit' })
      }
    })()
    return () => {
      alive = false
      handle.current = null
      mounted?.destroy()
    }
  }, [file, handle, onStatus, onConflict, onFrontmatter])
  return <div className="sky-doc-body sky-wysiwyg" ref={rootRef} />
}

/**
 * The rendered body of a file, its code blocks colored the way the editor colors them (FEN-1).
 * The HTML goes in by hand, once per change: React re-applies `dangerouslySetInnerHTML` on every
 * render of the page, which would strip the coloring again.
 */
function RenderedBody({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    root.innerHTML = html
    highlightCodeBlocks(root)
  }, [html])
  return <div className="sky-doc-body" ref={ref} />
}

/**
 * A directory in the column: the files it holds, one row per entry, each a
 * page. Plain links, so the app's link handling turns the page in place and
 * a middle click still opens a tab.
 */
function DirListing({ entries }: { entries: ExplorerEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="sky-blank">
        <p>This directory is empty.</p>
      </div>
    )
  }
  return (
    <nav className="sky-dir" aria-label="Files">
      {entries.map((entry) => (
        <a key={entry.path} className="sky-dir-row" data-kind={entry.kind} href={fileHref(entry.path)}>
          <span className="sky-dir-chev">{entry.kind === 'dir' ? '▸' : ''}</span>
          <span className="sky-dir-name">{entry.kind === 'file' ? entry.name.replace(/\.md$/i, '') : entry.name}</span>
        </a>
      ))}
    </nav>
  )
}

export function DocView({ file }: { file: string }) {
  // Editing is per file — turning the page ends it.
  const [editingFile, setEditingFile] = useState<string | null>(null)
  const editing = file !== '' && editingFile === file
  const { doc, listing, missing } = useDoc(file, editing)
  const [scale, setScale] = useDocScale()
  const [note, say] = useNote()
  const [exporting, setExporting] = useState(false)
  const [status, setStatus] = useState<EditorStatus | null>(null)
  const [conflict, setConflict] = useState(false)
  const editor = useRef<EditorHandle | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0)
  }, [doc?.path, listing?.path])
  // The front matter the editor holds while editing; the read document's otherwise.
  const [editFrontmatter, setEditFrontmatter] = useState<string | null>(null)
  const frontmatterText = editing ? editFrontmatter : doc?.frontmatter ? doc.frontmatter : null
  const frontmatter = useFrontmatter(
    frontmatterText,
    file,
    editing
      ? (text) => {
          editor.current?.setFrontmatter(text)
          setEditFrontmatter(text)
        }
      : undefined,
  )
  const { open: railOpen, toggle: toggleRail } = useRail(file)
  const outline = useOutline(scrollRef, [doc?.path, doc?.html, editing])
  const segments = file.split('/')
  const name = segments[segments.length - 1]

  const exportPdf = async () => {
    if (exporting) return
    setExporting(true)
    say('Exporting PDF…', Number.POSITIVE_INFINITY)
    try {
      const r = await fetch(`/docs/_api/export-pdf/${encodeSegments(file)}`, { method: 'POST' })
      const body = (await r.json()) as { pdfPath?: string; message?: string }
      if (!r.ok || !body.pdfPath) throw new Error(body.message ?? 'Export failed')
      say(`PDF saved · ${body.pdfPath.split('/').pop()}`)
    } catch (err) {
      say(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(file)
      say('Path copied')
    } catch {
      say(file)
    }
  }

  return (
    <div className="sky-main sky-main-rail" data-rail={railOpen ? 'open' : 'closed'}>
      <div className="sky-doc-column">
        <header className="sky-head">
          {file ? (
            <span className="sky-title sky-crumbs">
              {/* When the path is too long, the directories give way first; the name stays. */}
              <span className="sky-crumb-dirs">
                {segments.slice(0, -1).map((segment, i) => (
                  <Fragment key={i}>
                    <span className="sky-crumb">{segment}</span>
                    <span className="sky-crumb-sep">/</span>
                  </Fragment>
                ))}
              </span>
              <span className="sky-crumb-name">{name}</span>
            </span>
          ) : (
            <span className="sky-title">Explorer</span>
          )}
          {/* The buttons belong to a file; a directory's page has none. */}
          {file && !missing && (editing || doc) && (
            <nav className="sky-tabs">
              {editing && status && (
                <span className="sky-head-count" data-state={status.kind}>
                  {status.text}
                </span>
              )}
              {note && <span className="sky-head-count">{note}</span>}
              {editing && conflict && (
                <>
                  <Button size="sm" variant="light" onClick={() => editor.current?.reload()}>
                    Reload disk version
                  </Button>
                  <Button size="sm" variant="light" color="red" onClick={() => editor.current?.overwrite()}>
                    Overwrite disk version
                  </Button>
                </>
              )}
              {editing ? (
                <Button size="sm" onClick={() => setEditingFile(null)}>
                  Done
                </Button>
              ) : (
                <Button size="sm" onClick={() => setEditingFile(file)}>
                  Edit
                </Button>
              )}
              {!railOpen && <RailToggle open={false} onClick={toggleRail} />}
              <Menu position="bottom-end" shadow="md" width={220}>
                <Menu.Target>
                  <ActionIcon size="lg" aria-label="More">
                    ⋯
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Text size · {Math.round(scale * 100)}%</Menu.Label>
                  <Menu.Item
                    closeMenuOnClick={false}
                    disabled={scale <= SCALE_MIN}
                    onClick={() => setScale(scale - SCALE_STEP)}
                  >
                    Smaller
                  </Menu.Item>
                  <Menu.Item
                    closeMenuOnClick={false}
                    disabled={scale >= SCALE_MAX}
                    onClick={() => setScale(scale + SCALE_STEP)}
                  >
                    Larger
                  </Menu.Item>
                  {scale !== 1 && (
                    <Menu.Item closeMenuOnClick={false} onClick={() => setScale(1)}>
                      Default size
                    </Menu.Item>
                  )}
                  <Menu.Divider />
                  <Menu.Item disabled={exporting} onClick={() => void exportPdf()}>
                    Export PDF
                  </Menu.Item>
                  <Menu.Item onClick={() => void copyPath()}>Copy path</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </nav>
          )}
        </header>

        <div className="sky-scroll" ref={scrollRef}>
          {missing ? (
            <div className="sky-blank">
              <p>
                There is no file at <code>{file}</code>.
              </p>
            </div>
          ) : editing ? (
            <article className="sky-doc" style={{ '--sky-doc-scale': scale } as CSSProperties}>
              <IdentityLine state={frontmatter} file={file} onLeave={() => editor.current?.focusStart()} />
              <Editor
                file={file}
                handle={editor}
                onStatus={setStatus}
                onConflict={setConflict}
                onFrontmatter={setEditFrontmatter}
              />
            </article>
          ) : listing ? (
            <DirListing entries={listing.entries} />
          ) : doc ? (
            <article className="sky-doc" style={{ '--sky-doc-scale': scale } as CSSProperties}>
              <IdentityLine state={frontmatter} file={doc.path} />
              {doc.html ? <RenderedBody html={doc.html} /> : <p className="sky-doc-empty">This file is empty.</p>}
            </article>
          ) : null}
        </div>
      </div>
      {file && !missing && railOpen && (editing || doc) ? (
        <DocumentRail state={frontmatter} file={file} day={doc?.day ?? null} outline={outline} onToggle={toggleRail} />
      ) : null}
    </div>
  )
}
