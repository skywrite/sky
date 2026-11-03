/**
 * A note written on the day's page. The day stays the way back; the explorer's editor holds the
 * note, with a formatting row and a "/" menu over it; a switch shows the same file as plain
 * markdown. A blank note has no file until something is written, and its first save files it
 * under the day.
 */

import './notes.css'
import { ActionIcon, Button, Menu, SegmentedControl } from '@mantine/core'
import {
  type CSSProperties,
  type DragEvent,
  Fragment,
  type MouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { type EditorHandle, mountEditor } from '../editor/wysiwyg/mod.ts'
import { fileHref, resolveImageSrc, useDocScale } from '../explorer/explorer.tsx'
import { useOutline } from '../frontmatter/outline.ts'
import { DocumentRail } from '../frontmatter/Rail.tsx'
import { useFrontmatter } from '../frontmatter/useFrontmatter.ts'
import { shortDate } from '../meetings/meetingPage.tsx'
import { useRail } from '../shell/rail.ts'
import { RailToggle } from '../shell/railToggle.tsx'
import { FormatIcon } from './FormatIcon.tsx'
import { InsertMenu } from './InsertMenu.tsx'
import { frontmatterOf, hasBody, noteTimeOf, noteTitleOf } from './noteDocument.ts'
import { NEW_NOTE, noteHref } from './noteRoute.ts'
import { NoteSource } from './NoteSource.tsx'
import { NoteToolbar } from './NoteToolbar.tsx'
import { type NoteCategory, useNoteFile } from './useNoteFile.ts'

type View = 'rich' | 'markdown'

const CATEGORIES: NoteCategory[] = ['Professional', 'Personal']

function inPlace(go: () => void) {
  return (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    go()
  }
}

function attachApi(path: string): string {
  return `/docs/_api/attach/${path.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * The page at `/<ymd>/notes/<name>`. A blank note's first save gives it a name, and the address
 * follows without opening the note again; any other change of address opens that note.
 */
export function NoteMain({
  ymd,
  slug,
  go,
}: {
  ymd: string
  slug: string
  go: (to: string, replace?: boolean) => void
}) {
  const created = useRef<string | null>(null)
  const [opened, setOpened] = useState({ ymd, slug, open: slug, session: 0 })
  if (opened.ymd !== ymd || opened.slug !== slug) {
    if (opened.ymd === ymd && created.current === slug) {
      created.current = null
      setOpened({ ...opened, slug })
    } else setOpened({ ymd, slug, open: slug, session: opened.session + 1 })
  }
  const onCreated = useCallback(
    (name: string) => {
      created.current = name
      go(noteHref(ymd, name), true)
    },
    [go, ymd],
  )
  return (
    <Fragment key={opened.session}>
      <NotePage ymd={opened.ymd} slug={opened.open} go={go} onCreated={onCreated} />
    </Fragment>
  )
}

function NotePage({
  ymd,
  slug,
  go,
  onCreated,
}: {
  ymd: string
  slug: string
  go: (to: string, replace?: boolean) => void
  onCreated: (slug: string) => void
}) {
  const editor = useRef<EditorHandle | null>(null)
  const editorRoot = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pick = useRef<HTMLInputElement>(null)
  const [view, setView] = useState<View>('rich')
  const viewRef = useRef<View>(view)
  viewRef.current = view
  const [source, setSource] = useState('')
  const [frontmatterText, setFrontmatterText] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [blank, setBlank] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [startedAt] = useState(() => new ZonedDateTime().time)
  const file = useNoteFile(ymd, slug, {
    onCreated,
    onStamped: (content) => {
      // The first save wrote the note's summary, time and type into its front matter.
      if (viewRef.current === 'markdown') setSource(content)
      else {
        const stamped = frontmatterOf(content)
        editor.current?.setFrontmatter(stamped)
        setFrontmatterText(stamped)
      }
    },
  })
  const fileRef = useRef(file)
  fileRef.current = file

  // Every edit: the save it asks for, and what the page shows from it.
  const took = useCallback((content: string) => {
    fileRef.current.changed(content)
    setTitle(noteTitleOf(content))
    setBlank(!hasBody(content))
  }, [])

  const shown = file.shown
  useEffect(() => {
    if (!shown) return
    setTitle(noteTitleOf(shown.text))
    setBlank(!hasBody(shown.text))
    if (viewRef.current === 'markdown') setSource(shown.text)
  }, [shown])

  const switchView = (next: string) => {
    if (next !== 'rich' && next !== 'markdown') return
    if (next === view) return
    if (next === 'markdown') {
      const content = editor.current?.content() ?? file.current()
      took(content)
      setSource(content)
    }
    setView(next)
  }

  const attach = async (files: File[]) => {
    if (files.length === 0) return
    if (!file.currentPath()) await file.flush()
    const path = file.currentPath()
    if (!path) {
      setNotice('Give the note a title or a line first; a file is kept beside the note once it is saved.')
      return
    }
    setNotice(null)
    editor.current?.attach(files, attachApi(path))
  }
  const onImage = () => pick.current?.click()

  const frontmatter = useFrontmatter(
    view === 'rich' ? frontmatterText : frontmatterOf(source),
    file.path ?? '',
    view === 'rich' && shown
      ? (text) => {
          editor.current?.setFrontmatter(text)
          setFrontmatterText(text)
        }
      : undefined,
  )
  const { open: railOpen, toggle: toggleRail } = useRail(`notes/${ymd}`)
  const [scale] = useDocScale()
  const outline = useOutline(scrollRef, [shown?.generation, view])

  const missing = file.kind === 'missing'
  const ready = shown !== null && !missing
  const dayHref = `/${ymd}`
  const dayLabel = `${new PlainDate(ymd).dayLong}, ${shortDate(ymd)}`
  useEffect(() => {
    document.title = missing
      ? 'sky · Note not found'
      : `sky · ${title || (file.kind === 'loading' ? 'Note' : file.path ? 'Untitled note' : 'New note')}`
  }, [missing, title, file.kind, file.path])

  const copyPath = async () => {
    if (!file.path) return
    try {
      await navigator.clipboard.writeText(file.path)
      setNotice('Path copied')
    } catch {
      setNotice(file.path)
    }
  }
  const dropFiles = (event: DragEvent) => {
    if (view !== 'rich' || !event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    if (event.type === 'drop') void attach([...event.dataTransfer.files])
  }

  return (
    <div className="sky-main sky-main-rail sky-note-page" data-rail={railOpen ? 'open' : 'closed'}>
      <div className="sky-doc-column">
        <header className="sky-head">
          <span className="sky-title sky-crumbs">
            <span className="sky-crumb-dirs">
              <a className="sky-crumb" href={dayHref} onClick={inPlace(() => go(dayHref))}>
                {dayLabel}
              </a>
              <span className="sky-crumb-sep">›</span>
            </span>
            <span className="sky-crumb-name">Note</span>
          </span>
          {ready && (
            <nav className="sky-tabs">
              {file.statusText && (
                <span className="sky-head-count" data-state={file.kind} role="status">
                  {file.statusText}
                </span>
              )}
              {file.kind === 'conflict' && (
                <>
                  <Button size="sm" variant="primary" onClick={() => void file.keepMine()}>
                    Keep mine
                  </Button>
                  <Button size="sm" onClick={file.takeSaved}>
                    Use the saved one
                  </Button>
                </>
              )}
              <SegmentedControl
                className="sky-note-view"
                aria-label="View"
                size="xs"
                radius="md"
                value={view}
                onChange={switchView}
                data={[
                  { value: 'rich', label: 'Rich text' },
                  { value: 'markdown', label: 'Markdown' },
                ]}
              />
              {!railOpen && <RailToggle open={false} onClick={toggleRail} />}
              <Menu position="bottom-end" shadow="md" width={220}>
                <Menu.Target>
                  <ActionIcon size="lg" aria-label="More">
                    ⋯
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item disabled={!file.path} onClick={() => file.path && go(fileHref(file.path))}>
                    Open in Explorer
                  </Menu.Item>
                  <Menu.Item disabled={!file.path} onClick={() => void copyPath()}>
                    Copy path
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </nav>
          )}
        </header>
        {ready && view === 'rich' && <NoteToolbar editor={editor} root={editorRoot} onImage={onImage} />}
        {(file.problem || notice) && ready && (
          <p className="sky-note-notice" role={file.problem ? 'alert' : 'status'}>
            {file.problem ?? notice}
          </p>
        )}
        <div className="sky-scroll" ref={scrollRef} onDragOver={dropFiles} onDrop={dropFiles}>
          {missing ? (
            <div className="sky-blank">
              <p>
                There is no note called <code>{slug}</code> on {dayLabel}.
              </p>
              <p>
                <a href={dayHref} onClick={inPlace(() => go(dayHref))}>
                  Back to the day
                </a>{' '}
                or{' '}
                <a href={noteHref(ymd, NEW_NOTE)} onClick={inPlace(() => go(noteHref(ymd, NEW_NOTE)))}>
                  start a new note
                </a>
                .
              </p>
            </div>
          ) : file.kind === 'error' && !shown ? (
            <div className="sky-blank">
              <p>{file.problem}</p>
            </div>
          ) : ready ? (
            <article className="sky-doc sky-note" style={{ '--sky-doc-scale': scale } as CSSProperties}>
              <NoteMeta
                time={noteTimeOf(view === 'rich' ? frontmatterText : frontmatterOf(source)) ?? startedAt}
                category={file.category}
                onCategory={file.setCategory}
              />
              {view === 'rich' ? (
                <NoteEditor
                  text={file.current()}
                  generation={shown.generation}
                  handle={editor}
                  root={editorRoot}
                  path={file.path}
                  focus={slug === NEW_NOTE && shown.generation === 1}
                  untitled={!title}
                  blank={blank}
                  onChange={took}
                  onFrontmatter={setFrontmatterText}
                  onFiles={(files) => void attach(files)}
                  onError={setNotice}
                />
              ) : (
                <NoteSource
                  text={source}
                  path={file.path}
                  onChange={(text) => {
                    setSource(text)
                    took(text)
                  }}
                />
              )}
            </article>
          ) : null}
        </div>
        <input
          ref={pick}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])]
            event.currentTarget.value = ''
            void attach(files)
          }}
        />
        {ready && view === 'rich' && <InsertMenu editor={editor} root={editorRoot} onImage={onImage} />}
      </div>
      {ready && railOpen ? (
        <DocumentRail state={frontmatter} file={file.path ?? ''} day={ymd} outline={outline} onToggle={toggleRail} />
      ) : null}
    </div>
  )
}

/** The line over the title: when the note was written, and which of the day's lists names it. */
function NoteMeta({
  time,
  category,
  onCategory,
}: {
  time: string
  category: NoteCategory
  onCategory: (category: NoteCategory) => void
}) {
  return (
    <div className="sky-note-meta">
      <span className="sky-note-time">
        <FormatIcon name="clock" size={16} />
        {time}
      </span>
      <Menu position="bottom-start" shadow="md" width={190}>
        <Menu.Target>
          <button type="button" className="sky-note-category" aria-label={`Category: ${category}`}>
            {category}
            <FormatIcon name="chevron" size={13} />
          </button>
        </Menu.Target>
        <Menu.Dropdown>
          {CATEGORIES.map((option) => (
            <Menu.Item
              key={option}
              onClick={() => onCategory(option)}
              rightSection={option === category ? <span aria-hidden="true">✓</span> : null}
            >
              {option}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    </div>
  )
}

/**
 * The explorer's editor in its local mode: the page saves, so edits report back. It mounts the
 * text it is given once per showing; a new `generation` shows a new text.
 */
function NoteEditor({
  text,
  generation,
  handle,
  root,
  path,
  focus,
  untitled,
  blank,
  onChange,
  onFrontmatter,
  onFiles,
  onError,
}: {
  text: string
  generation: number
  handle: RefObject<EditorHandle | null>
  root: RefObject<HTMLDivElement | null>
  path: string | null
  focus: boolean
  untitled: boolean
  blank: boolean
  onChange: (content: string) => void
  onFrontmatter: (text: string | null) => void
  onFiles: (files: File[]) => void
  onError: (text: string) => void
}) {
  const hooks = useRef({ onChange, onFrontmatter, onFiles, onError, path })
  hooks.current = { onChange, onFrontmatter, onFiles, onError, path }
  useEffect(() => {
    const element = root.current
    if (!element) return
    const mounted = mountEditor(
      element,
      {
        apiPath: '',
        content: text,
        version: 0,
        local: true,
        hideFrontmatter: true,
        resolveImage: (src) => (hooks.current.path ? resolveImageSrc(hooks.current.path, src) : src),
      },
      {
        onStatus: (kind, words) => {
          if (kind === 'error') hooks.current.onError(words)
        },
        onConflict: () => {},
        onChange: (content) => hooks.current.onChange(content),
        onFrontmatter: (frontmatter) => hooks.current.onFrontmatter(frontmatter),
        onFiles: (files) => hooks.current.onFiles(files),
      },
    )
    handle.current = mounted
    hooks.current.onFrontmatter(mounted.frontmatter())
    if (focus) mounted.focusStart()
    return () => {
      handle.current = null
      mounted.destroy()
    }
    // A new showing remounts; the text, the focus and the hooks are read when it does.
  }, [generation, handle, root]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      className="sky-doc-body sky-wysiwyg sky-note-editor"
      ref={root}
      role="textbox"
      aria-label="Note"
      aria-multiline="true"
      data-untitled={untitled || undefined}
      data-blank={blank || undefined}
    />
  )
}
