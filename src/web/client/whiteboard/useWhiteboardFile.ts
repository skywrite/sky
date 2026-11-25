/**
 * Persistent state for `time/whiteboard.md`. Opens cleanly even before the file
 * exists, debounces saves with optimistic version checks, resolves conflicts
 * explicitly, and picks up external disk edits when there are no unsaved local changes.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { WhiteboardSnapshot } from '../../../service/handler/whiteboard/mod.ts'
import { subscribeNotebookChanges } from '../lib/notebookChanges.ts'

export type WhiteboardStatusKind = 'loading' | 'blank' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error'

export interface WhiteboardFile {
  kind: WhiteboardStatusKind
  statusText: string
  problem: string | null
  path: string
  exists: boolean
  /** Bumped on open, external update, conflict reload, or programmatic replace (Clear/Undo). */
  shown: { text: string; generation: number } | null
  changed(content: string): void
  current(): string
  flush(): Promise<boolean>
  replace(content: string): Promise<boolean>
  keepMine(): Promise<boolean>
  takeSaved(): void
}

interface Opened {
  path: string
  exists: boolean
  version: number | null
  base: string
}

type Failure = Error & { status?: number; body?: { content?: string; version?: number } }

const API = '/whiteboard/_api'
const SAVE_DEBOUNCE_MS = 650
const POLL_MS = 5000

async function call<T>(method = 'GET', body?: unknown): Promise<T> {
  const json = body === undefined ? undefined : JSON.stringify(body)
  const response = await fetch(
    API,
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

export function useWhiteboardFile(): WhiteboardFile {
  const [kind, setKind] = useState<WhiteboardStatusKind>('loading')
  const [statusText, setStatusText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [path, setPath] = useState('time/whiteboard.md')
  const [exists, setExists] = useState(false)
  const [shown, setShown] = useState<WhiteboardFile['shown']>(null)

  const opened = useRef<Opened | null>(null)
  const text = useRef('')
  const saving = useRef<Promise<boolean> | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const conflict = useRef<{ content: string; version: number } | null>(null)
  const alive = useRef(true)

  const report = useCallback((next: WhiteboardStatusKind, words: string) => {
    if (!alive.current) return
    setKind(next)
    setStatusText(words)
  }, [])

  const show = useCallback((content: string) => {
    if (!alive.current) return
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
          const state = opened.current
          const content = text.current
          if (!state.exists && content === '' && !overwrite) {
            report('blank', '')
            return true
          }
          report('saving', 'Saving…')
          try {
            const saved = await call<WhiteboardSnapshot>('PUT', {
              content,
              version: state.version,
              force: overwrite,
            })
            state.exists = saved.exists
            state.version = saved.version
            state.base = saved.content
            state.path = saved.path
            overwrite = false
            conflict.current = null
            if (alive.current) {
              setPath(saved.path)
              setExists(saved.exists)
              setProblem(null)
            }
          } catch (cause) {
            const failure = cause as Failure
            if (failure.status === 409 && typeof failure.body?.content === 'string') {
              conflict.current = { content: failure.body.content, version: failure.body.version ?? 0 }
              report('conflict', 'Changed elsewhere')
              if (alive.current) {
                setProblem('The whiteboard file changed outside this page. Keep your version, or load the saved file.')
              }
            } else {
              report('error', 'Not saved')
              if (alive.current) setProblem(`${failure.message} Your text is still on this page.`)
            }
            return false
          }
        }
        const current = opened.current
        report(current?.exists ? 'saved' : 'blank', current?.exists ? 'Saved' : '')
        return true
      }
      saving.current = run()
      try {
        return await saving.current
      } finally {
        saving.current = null
      }
    },
    [report],
  )

  const changed = useCallback(
    (content: string) => {
      text.current = content
      const state = opened.current
      if (!state || conflict.current) return
      window.clearTimeout(timer.current)
      timer.current = undefined
      if (content === state.base) {
        report(state.exists ? 'saved' : 'blank', state.exists ? 'Saved' : '')
        return
      }
      report('dirty', 'Unsaved')
      timer.current = window.setTimeout(() => void save(), SAVE_DEBOUNCE_MS)
    },
    [report, save],
  )

  const checkExternal = useCallback(() => {
    const state = opened.current
    if (!state || saving.current || timer.current !== undefined || text.current !== state.base || conflict.current) {
      return
    }
    void call<WhiteboardSnapshot>()
      .then((snapshot) => {
        if (!alive.current || opened.current !== state || text.current !== state.base) return
        if (snapshot.version === state.version && snapshot.exists === state.exists) return
        state.exists = snapshot.exists
        state.version = snapshot.version
        state.base = snapshot.content
        state.path = snapshot.path
        text.current = snapshot.content
        setPath(snapshot.path)
        setExists(snapshot.exists)
        show(snapshot.content)
        report(snapshot.exists ? 'saved' : 'blank', snapshot.exists ? 'Updated from file' : '')
      })
      .catch(() => {})
  }, [report, show])

  useEffect(() => {
    alive.current = true
    void (async () => {
      try {
        const snapshot = await call<WhiteboardSnapshot>()
        if (!alive.current) return
        opened.current = {
          path: snapshot.path,
          exists: snapshot.exists,
          version: snapshot.version,
          base: snapshot.content,
        }
        text.current = snapshot.content
        setPath(snapshot.path)
        setExists(snapshot.exists)
        setProblem(null)
        report(snapshot.exists ? 'saved' : 'blank', snapshot.exists ? 'Saved' : '')
        show(snapshot.content)
      } catch (cause) {
        const failure = cause as Failure
        report('error', 'Could not load')
        if (alive.current) setProblem(failure.message)
      }
    })()
    return () => {
      alive.current = false
    }
  }, [report, show])

  // Refresh promptly when the notebook watcher sees whiteboard.md change, plus a quiet fallback poll.
  useEffect(() => {
    const unsubscribe = subscribeNotebookChanges((notice) => {
      if (notice.type === 'resume') {
        checkExternal()
        return
      }
      if (
        notice.type === 'changed' &&
        (notice.paths === null || notice.paths.some((p) => p.endsWith('whiteboard.md')))
      ) {
        checkExternal()
      }
    })
    const poll = window.setInterval(checkExternal, POLL_MS)
    return () => {
      unsubscribe()
      window.clearInterval(poll)
    }
  }, [checkExternal])

  // Flush unsaved writing when leaving the page or closing the tab.
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const state = opened.current
      if (!state || text.current === state.base) return
      event.preventDefault()
      void save()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      const state = opened.current
      if (state && text.current !== state.base) void save()
    }
  }, [save])

  return {
    kind,
    statusText,
    problem,
    path,
    exists,
    shown,
    changed,
    current: () => text.current,
    flush: () => save(),
    replace: async (content: string) => {
      text.current = content
      show(content)
      return await save(conflict.current !== null)
    },
    keepMine: () => {
      if (alive.current) setProblem(null)
      const kept = conflict.current
      if (kept && opened.current) opened.current.version = kept.version
      return save(true)
    },
    takeSaved: () => {
      const kept = conflict.current
      const state = opened.current
      if (!kept || !state) return
      conflict.current = null
      state.exists = true
      state.version = kept.version
      state.base = kept.content
      text.current = kept.content
      setExists(true)
      setProblem(null)
      report('saved', 'Saved')
      show(kept.content)
    },
  }
}
