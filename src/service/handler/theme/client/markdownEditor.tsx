import { Button } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { mountEditor, type EditorHandle, type EditorFormat } from './wysiwyg/mod.ts'

export interface MarkdownWriter {
  flush(): Promise<boolean>
}
interface Snapshot {
  content: string
  version: number
}
interface Draft extends Snapshot {
  base: string
}

async function request(
  apiPath: string,
  input?: { content: string; version: number; force: boolean },
): Promise<Snapshot> {
  const response = await fetch(
    apiPath,
    input
      ? {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
          keepalive: input.content.length < 20_000,
        }
      : undefined,
  )
  const body = (await response.json()) as Snapshot & { message?: string }
  if (!response.ok)
    throw Object.assign(new Error(body.message ?? 'Your answer could not be saved. Try again.'), {
      status: response.status,
    })
  return body
}

/** The same editor as Explorer, with recoverable drafts for an embedded answer. */
export function MarkdownEditor({
  apiPath,
  draftKey,
  label,
  onReady,
}: {
  apiPath: string
  draftKey: string
  label: string
  onReady(writer: MarkdownWriter | null): void
}) {
  const root = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorHandle | null>(null)
  const callbacks = useRef({ onReady })
  callbacks.current = { onReady }
  const controls = useRef<{ save(force?: boolean): Promise<boolean>; reload(): Promise<void> } | null>(null)
  const [status, setStatus] = useState('Opening…')
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [savedElsewhere, setSavedElsewhere] = useState('')
  useEffect(() => {
    const element = root.current
    if (!element) return
    let alive = true
    let current: Draft | null = null
    let blocked = false
    let saving: Promise<boolean> | null = null
    let timer: number | undefined
    const key = `sky:writing:${draftKey}`
    const report = (message: string) => {
      if (alive) setStatus(message)
    }
    const problem = (message: string) => {
      if (alive) setError(message)
    }
    const dirty = () => current !== null && current.content !== current.base
    const remember = () => {
      if (!current) return
      try {
        if (dirty()) localStorage.setItem(key, JSON.stringify(current))
        else localStorage.removeItem(key)
      } catch {
        problem('This browser cannot keep a recovery draft. Keep this page open until your answer is saved.')
      }
    }
    const changed = (content: string) => {
      if (!current || content === current.content) return
      current.content = content
      remember()
      if (!blocked) report(dirty() ? 'Unsaved changes' : 'Saved')
      window.clearTimeout(timer)
      if (dirty()) timer = window.setTimeout(() => void save(), 800)
    }
    const mount = (content: string) => {
      editor.current?.destroy()
      editor.current = mountEditor(
        element,
        { apiPath, content, version: 0, local: true },
        {
          onChange: changed,
          onStatus: () => {},
          onConflict: () => {},
        },
      )
    }
    const save = async (force = false): Promise<boolean> => {
      if (alive && editor.current) changed(editor.current.content())
      window.clearTimeout(timer)
      if (saving) {
        if (!(await saving)) return false
        return save(force)
      }
      if (!current || (blocked && !force)) return false
      if (!dirty() && !force) return true
      const run = async () => {
        while (current && (dirty() || force)) {
          const content = current.content
          report('Saving…')
          try {
            const saved = await request(apiPath, { content, version: current.version, force })
            current.version = saved.version
            current.base = saved.content
            // The service may normalize an empty answer without creating a file.
            if (current.content === content) current.content = saved.content
            blocked = false
            force = false
            if (alive) {
              setConflict(false)
              setError('')
            }
            remember()
          } catch (cause) {
            blocked = (cause as { status?: number }).status === 409
            if (alive) setConflict(blocked)
            if (blocked) {
              const saved = await request(apiPath).catch(() => null)
              if (alive) setSavedElsewhere(saved?.content ?? '')
            }
            problem(cause instanceof Error ? cause.message : 'Your answer could not be saved.')
            report('Not saved')
            return false
          }
        }
        report('Saved')
        return true
      }
      saving = run()
      try {
        return await saving
      } finally {
        saving = null
      }
    }
    const reload = async () => {
      try {
        const saved = await request(apiPath)
        if (!alive) return
        current = { ...saved, base: saved.content }
        blocked = false
        setConflict(false)
        setError('')
        remember()
        mount(saved.content)
        report(saved.content ? 'Saved' : 'Ready to write')
      } catch (cause) {
        problem(cause instanceof Error ? cause.message : 'Could not load your answer.')
      }
    }
    controls.current = { save, reload }
    void (async () => {
      try {
        const saved = await request(apiPath)
        if (!alive) return
        let draft: Draft | null = null
        try {
          const raw = localStorage.getItem(key)
          if (raw) {
            const value = JSON.parse(raw) as Draft
            if (
              typeof value.content === 'string' &&
              typeof value.base === 'string' &&
              Number.isSafeInteger(value.version)
            )
              draft = value
          }
        } catch {
          /* The saved file remains usable if browser storage is unavailable. */
        }
        current = draft && draft.content !== saved.content ? draft : { ...saved, base: saved.content }
        if (draft && dirty() && draft.version !== saved.version) {
          blocked = true
          setConflict(true)
          setSavedElsewhere(saved.content)
          problem('Your recovered draft and the saved answer differ. Choose which version to keep.')
        }
        mount(current.content)
        report(blocked ? 'Not saved' : dirty() ? 'Draft recovered' : saved.content ? 'Saved' : 'Ready to write')
        callbacks.current.onReady({ flush: () => save() })
        if (dirty() && !blocked) void save()
      } catch (cause) {
        problem(cause instanceof Error ? cause.message : 'Could not open this answer.')
        report('Could not open')
      }
    })()
    const poll = window.setInterval(() => {
      if (!alive || !current || saving || blocked || dirty()) return
      const before = current
      void request(apiPath)
        .then((saved) => {
          if (!alive || current !== before || dirty() || saving || saved.version === current.version) return
          current = { ...saved, base: saved.content }
          mount(saved.content)
          report('Updated from file')
        })
        .catch(() => {})
    }, 5000)
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (editor.current) changed(editor.current.content())
      if (dirty()) {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      if (editor.current) changed(editor.current.content())
      alive = false
      window.clearInterval(poll)
      window.clearTimeout(timer)
      window.removeEventListener('beforeunload', beforeUnload)
      callbacks.current.onReady(null)
      void save()
      editor.current?.destroy()
      editor.current = null
      controls.current = null
    }
  }, [apiPath, draftKey])
  const formats: Array<[EditorFormat, string]> = [
    ['bold', 'Bold'],
    ['italic', 'Italic'],
    ['bullets', 'List'],
    ['undo', 'Undo'],
  ]
  return (
    <div className="sky-journal-writer">
      <div className="sky-journal-editor-tools">
        <div role="toolbar" aria-label={`${label} formatting`}>
          {formats.map(([command, title]) => (
            <Button
              key={command}
              size="compact-sm"
              aria-label={title}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor.current?.format(command)}
            >
              {title}
            </Button>
          ))}
        </div>
        <span role="status">{status}</span>
      </div>
      <div className="sky-doc-body sky-wysiwyg" ref={root} role="textbox" aria-label={label} aria-multiline="true" />
      {error && (
        <div className="sky-journal-error" role="alert">
          <p>{error}</p>
          {conflict ? (
            <>
              <details>
                <summary>Review saved answer</summary>
                <pre>{savedElsewhere || '(Empty answer)'}</pre>
              </details>
              <Button onClick={() => void controls.current?.save(true)}>Replace saved answer with mine</Button>
              <Button onClick={() => void controls.current?.reload()}>Discard my draft and load saved answer</Button>
            </>
          ) : (
            <Button
              onClick={() => {
                if (editor.current) void controls.current?.save()
                else
                  void controls.current
                    ?.reload()
                    .then(() =>
                      callbacks.current.onReady({ flush: () => controls.current?.save() ?? Promise.resolve(false) }),
                    )
              }}
            >
              Retry
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
