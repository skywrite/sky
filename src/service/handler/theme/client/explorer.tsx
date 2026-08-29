import { Button } from '@mantine/core'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'

/**
 * The explorer. The sidebar is the tree — a directory lists itself when
 * opened, never the whole notebook at once — and the column is the file
 * open in it, rendered to read. A file's page is its path: /explorer/<path>.
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

function useDoc(file: string): { doc: ExplorerDoc | null; missing: boolean } {
  const [doc, setDoc] = useState<ExplorerDoc | null>(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    setMissing(false)
    if (!file) {
      setDoc(null)
      return
    }
    let alive = true
    fetch(`/explorer/_api/doc?path=${encodeURIComponent(file)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as ExplorerDoc) : null))
      .catch(() => null)
      .then((body) => {
        if (!alive) return
        // The last file stays on screen until this one arrives — no blank in between.
        if (body) setDoc(body)
        else setMissing(true)
      })
    return () => {
      alive = false
    }
  }, [file])
  return { doc, missing }
}

export function DocView({ file }: { file: string }) {
  const { doc, missing } = useDoc(file)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0)
  }, [doc?.path])
  const segments = file.split('/')
  const name = segments[segments.length - 1]

  return (
    <div className="sky-main">
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
        {file && !missing && (
          <nav className="sky-tabs">
            {/* Editing still happens on the block editor's own page, until it moves in here. */}
            <Button size="sm" component="a" href={`/docs/${segments.map(encodeURIComponent).join('/')}?mode=edit`}>
              Edit
            </Button>
          </nav>
        )}
      </header>

      <div className="sky-scroll" ref={scrollRef}>
        {!file ? (
          <div className="sky-blank">
            <p>Pick a file to read it here.</p>
          </div>
        ) : missing ? (
          <div className="sky-blank">
            <p>
              There is no file at <code>{file}</code>.
            </p>
          </div>
        ) : doc ? (
          <article className="sky-doc">
            {doc.frontmatter && (
              <details className="sky-doc-meta">
                <summary>Frontmatter</summary>
                <pre>{doc.frontmatter}</pre>
              </details>
            )}
            {doc.html ? (
              <div className="sky-doc-body" dangerouslySetInnerHTML={{ __html: doc.html }} />
            ) : (
              <p className="sky-doc-empty">This file is empty.</p>
            )}
          </article>
        ) : null}
      </div>
    </div>
  )
}
