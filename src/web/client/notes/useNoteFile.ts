/**
 * A note's file as the page keeps it. A blank note has none until its first save files it under
 * the day; from then on each pause saves the page's text over the file, version-checked, so an
 * edit made elsewhere is never overwritten unseen. While the page is open, its text is the note.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { BLANK_NOTE, frontmatterOf, saveDelay } from './noteDocument.ts'
import { NEW_NOTE } from './noteRoute.ts'

export type NoteCategory = 'Professional' | 'Personal'

export type NoteStatusKind = 'loading' | 'blank' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict' | 'missing'

export interface NoteFile {
  kind: NoteStatusKind
  /** What the header says about the save, empty when there is nothing to say */
  statusText: string
  /** A failure in plain words, with the note's text still on the page */
  problem: string | null
  /** The note's notebook path once it has a file */
  path: string | null
  category: NoteCategory
  /** The text the page shows anew — on opening, or after taking the file's version */
  shown: { text: string; generation: number } | null
  /** An edit, from the editor or the Markdown view */
  changed(content: string): void
  /** The text the page holds now */
  current(): string
  /** The note's path now, a save just made included */
  currentPath(): string | null
  /** Saves now; true once the file holds what the page holds */
  flush(): Promise<boolean>
  /** After a conflict: the page's text over the file's */
  keepMine(): Promise<boolean>
  /** After a conflict: the file's text in place of the page's */
  takeSaved(): void
  setCategory(category: NoteCategory): void
}

interface Opened {
  path: string | null
  slug: string
  version: number
  /** What the file holds, as far as the page knows */
  base: string
}

type Failure = Error & { status?: number; body?: { content?: string; version?: number } }

const POLL_MS = 5000

function contentApi(path: string): string {
  return `/docs/_api/content/${path.split('/').map(encodeURIComponent).join('/')}`
}

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const json = body === undefined ? undefined : JSON.stringify(body)
  const response = await fetch(
    url,
    json === undefined
      ? { method }
      : { method, headers: { 'content-type': 'application/json' }, body: json, keepalive: json.length < 60_000 },
  )
  const answer = (await response.json().catch(() => ({}))) as { error?: string; message?: string }
  if (!response.ok) {
    const failure: Failure = new Error(answer.error ?? answer.message ?? `The request failed (${response.status}).`)
    failure.status = response.status
    failure.body = answer as Failure['body']
    throw failure
  }
  return answer as T
}

/**
 * Opens the note `slug` names under the day, or a blank one for `new`. `onCreated` hears the name
 * the first save gave the file; `onStamped` the text with the front matter the server wrote then.
 */
export function useNoteFile(
  ymd: string,
  slug: string,
  hooks: { onCreated(slug: string): void; onStamped(content: string): void },
): NoteFile {
  const [kind, setKind] = useState<NoteStatusKind>('loading')
  const [statusText, setStatusText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const [category, setCategoryState] = useState<NoteCategory>('Professional')
  const [shown, setShown] = useState<NoteFile['shown']>(null)
  const opened = useRef<Opened | null>(null)
  const text = useRef('')
  const categoryRef = useRef<NoteCategory>('Professional')
  const saving = useRef<Promise<boolean> | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const conflict = useRef<{ content: string; version: number } | null>(null)
  const alive = useRef(true)
  const hookRef = useRef(hooks)
  hookRef.current = hooks

  const report = useCallback((next: NoteStatusKind, words: string) => {
    if (!alive.current) return
    setKind(next)
    setStatusText(words)
  }, [])

  const show = useCallback((content: string) => {
    setShown((previous) => ({ text: content, generation: (previous?.generation ?? 0) + 1 }))
  }, [])

  const save = useCallback(
    async (force = false): Promise<boolean> => {
      window.clearTimeout(timer.current)
      timer.current = undefined
      if (saving.current) {
        if (!(await saving.current)) return false
        return save(force)
      }
      const run = async (): Promise<boolean> => {
        let overwrite = force
        while (opened.current && (text.current !== opened.current.base || overwrite)) {
          const note = opened.current
          const content = text.current
          if (!note.path && saveDelay(content, false) === null) {
            report('blank', '')
            return true
          }
          report('saving', 'Saving…')
          try {
            if (!note.path) {
              const created = await call<{
                path: string
                slug: string
                content: string
                version: number
                problem: string | null
              }>(`/day/${ymd}/notes`, 'POST', { content, category: categoryRef.current })
              opened.current = {
                path: created.path,
                slug: created.slug,
                version: created.version,
                base: created.content,
              }
              if (alive.current) {
                setPath(created.path)
                setProblem(created.problem)
              }
              // The first save wrote the front matter's summary, time and type; the page takes them,
              // keeping anything written while the save was out.
              const stamped =
                text.current === content ? created.content : withFrontmatterOf(text.current, created.content)
              text.current = stamped
              // A save on the way out of the page files the note and leaves the address alone.
              if (alive.current) {
                hookRef.current.onStamped(stamped)
                hookRef.current.onCreated(created.slug)
              }
            } else {
              const saved = await call<{ version: number }>(contentApi(note.path), 'PUT', {
                content,
                version: note.version,
                force: overwrite,
              })
              note.version = saved.version
              note.base = content
              overwrite = false
              conflict.current = null
            }
          } catch (cause) {
            const failure = cause as Failure
            if (failure.status === 409 && typeof failure.body?.content === 'string') {
              conflict.current = { content: failure.body.content, version: failure.body.version ?? 0 }
              report('conflict', 'Changed elsewhere')
              if (alive.current)
                setProblem(
                  'This note was changed outside this page since it opened. Keep your version, or use the saved one.',
                )
            } else {
              report('error', 'Not saved')
              if (alive.current) setProblem(`${failure.message} Your writing is still on this page.`)
            }
            return false
          }
        }
        report(opened.current?.path ? 'saved' : 'blank', opened.current?.path ? 'Saved' : '')
        return true
      }
      saving.current = run()
      try {
        return await saving.current
      } finally {
        saving.current = null
      }
    },
    [report, ymd],
  )

  const changed = useCallback(
    (content: string) => {
      text.current = content
      const note = opened.current
      // In a conflict the writing goes on, and waits for the person's choice to be saved.
      if (!note || conflict.current) return
      window.clearTimeout(timer.current)
      timer.current = undefined
      if (content === note.base) {
        report(note.path ? 'saved' : 'blank', note.path ? 'Saved' : '')
        return
      }
      const delay = saveDelay(content, note.path !== null)
      if (delay === null) {
        report('blank', '')
        return
      }
      report('dirty', note.path ? 'Unsaved' : 'Not saved yet')
      timer.current = window.setTimeout(() => void save(), delay)
    },
    [report, save],
  )

  // Open the note, or start a blank one.
  useEffect(() => {
    alive.current = true
    if (slug === NEW_NOTE) {
      opened.current = { path: null, slug: NEW_NOTE, version: 0, base: BLANK_NOTE }
      text.current = BLANK_NOTE
      report('blank', '')
      show(BLANK_NOTE)
    } else {
      void (async () => {
        try {
          const found = await call<{ path: string; category: NoteCategory | null }>(
            `/day/${ymd}/notes/${encodeURIComponent(slug)}`,
          )
          const file = await call<{ content: string; version: number }>(contentApi(found.path))
          if (!alive.current) return
          opened.current = { path: found.path, slug, version: file.version, base: file.content }
          text.current = file.content
          categoryRef.current = found.category ?? 'Professional'
          setCategoryState(categoryRef.current)
          setPath(found.path)
          report('saved', 'Saved')
          show(file.content)
        } catch (cause) {
          const failure = cause as Failure
          report(failure.status === 404 ? 'missing' : 'error', '')
          if (alive.current) setProblem(failure.message)
        }
      })()
    }
    return () => {
      alive.current = false
    }
  }, [ymd, slug, report, show])

  // An edit made outside the page — the explorer, a command — shows here when the page has none of its own.
  useEffect(() => {
    const poll = window.setInterval(() => {
      const note = opened.current
      if (!note?.path || saving.current || timer.current !== undefined || text.current !== note.base) return
      void call<{ content: string; version: number }>(contentApi(note.path))
        .then((file) => {
          if (opened.current !== note || text.current !== note.base || file.version === note.version) return
          note.version = file.version
          note.base = file.content
          text.current = file.content
          show(file.content)
          report('saved', 'Updated from file')
        })
        .catch(() => {})
    }, POLL_MS)
    return () => window.clearInterval(poll)
  }, [report, show])

  // Leaving with unsaved writing saves it on the way out.
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const note = opened.current
      if (!note || text.current === note.base || saveDelay(text.current, note.path !== null) === null) return
      event.preventDefault()
      void save()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      const note = opened.current
      if (note && text.current !== note.base) void save()
    }
  }, [save])

  return {
    kind,
    statusText,
    problem,
    path,
    category,
    shown,
    changed,
    current: () => text.current,
    currentPath: () => opened.current?.path ?? null,
    flush: () => save(),
    keepMine: () => {
      if (alive.current) setProblem(null)
      const kept = conflict.current
      if (kept && opened.current) opened.current.version = kept.version
      return save(true)
    },
    takeSaved: () => {
      const kept = conflict.current
      const note = opened.current
      if (!kept || !note) return
      conflict.current = null
      note.version = kept.version
      note.base = kept.content
      text.current = kept.content
      setProblem(null)
      report('saved', 'Saved')
      show(kept.content)
    },
    setCategory: (next) => {
      categoryRef.current = next
      setCategoryState(next)
      const note = opened.current
      if (!note?.path) return
      void call(`/day/${ymd}/notes/${encodeURIComponent(note.slug)}/category`, 'PUT', { category: next }).catch(
        (cause: Error) => {
          if (alive.current) setProblem(`The note stays in its list: ${cause.message}`)
        },
      )
    },
  }
}

/** `content` with its front matter taken from `stamped`, its body left as it is. */
function withFrontmatterOf(content: string, stamped: string): string {
  const frontmatter = frontmatterOf(stamped)
  if (frontmatter === null) return content
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  return `---\n${frontmatter}\n---\n${body.startsWith('\n') ? body : `\n${body}`}`
}
