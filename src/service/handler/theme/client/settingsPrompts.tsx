import { Button, Modal, TextInput } from '@mantine/core'
import { Fragment, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import type {
  PreviewVariable,
  PromptDocument,
  PromptEntry,
  PromptPreview,
  PromptUsage,
} from '#shared/prompts/catalogTypes.ts'
import { type EditorFormat, type EditorHandle, mountEditor } from './wysiwyg/mod.ts'
import './settingsPrompts.css'

const API = '/settings/_api/prompts'
interface Draft {
  saved: PromptDocument
  content: string
}
const drafts = new Map<string, Draft>()
const changed = (draft: Draft) => draft.content !== draft.saved.content
const href = (id?: string) => `/settings/prompts${id ? `/${id.split('/').map(encodeURIComponent).join('/')}` : ''}`
function idOf(path: string): string | null {
  try {
    return path.startsWith('/settings/prompts/') ? decodeURIComponent(path.slice('/settings/prompts/'.length)) : null
  } catch {
    return null
  }
}
async function request<T>(suffix: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${suffix}`, init)
  const data = (await response.json()) as T & { message?: string }
  if (!response.ok) throw new Error(data.message || `The service answered ${response.status}.`)
  return data
}
const json = (data: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
})
const message = (error: unknown) => (error instanceof Error ? error.message : 'The request failed.')

/** Drafts survive navigation around the app; leaving the tab still protects unsaved work. */
export function usePromptDraftGuard() {
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if ([...drafts.values()].some(changed)) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
}

function Usage({ uses, navigate }: { uses: PromptUsage[]; navigate: (to: string) => void }) {
  return (
    <>
      {uses.length ? (
        uses.map((use) =>
          use.promptId ? (
            <button className="sky-prompt-chip" key={use.file} onClick={() => navigate(href(use.promptId))}>
              {use.label} ↗
            </button>
          ) : (
            <span className="sky-prompt-chip" key={use.file} title={`${use.file}${use.line ? `:${use.line}` : ''}`}>
              {use.label}
            </span>
          ),
        )
      ) : (
        <span className="sky-prompt-muted">No source reference found</span>
      )}
    </>
  )
}

function VisualEditor({
  initial,
  handle,
  onChange,
}: {
  initial: string
  handle: RefObject<EditorHandle | null>
  onChange: (content: string) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const notify = useRef(onChange)
  notify.current = onChange
  useEffect(() => {
    if (!root.current) return
    const editor = mountEditor(
      root.current,
      { apiPath: '', content: initial, version: 0, local: true, hideFrontmatter: true, resolveImage: () => '' },
      {
        onStatus: () => {},
        onConflict: () => {},
        onChange: (content) => notify.current(content),
      },
    )
    root.current.setAttribute('aria-label', 'Visual prompt editor')
    handle.current = editor
    return () => {
      handle.current = null
      editor.destroy()
    }
    // Remounts are explicit (view changes, discard, template insertion), never on a keystroke.
  }, [initial, handle])
  return <div ref={root} className="sky-doc-body sky-wysiwyg sky-prompt-visual" />
}

function Variable({
  field,
  value,
  type,
  onType,
  onChange,
}: {
  field: PreviewVariable
  value: unknown
  type: PreviewVariable['kind']
  onType: (type: PreviewVariable['kind']) => void
  onChange: (value: unknown) => void
}) {
  const id = `sample-${field.name}`
  return (
    <div className="sky-prompt-variable">
      <div className="sky-prompt-variable-label">
        <label htmlFor={id}>
          <code>{field.name}</code>
        </label>
        <select
          aria-label={`Type of ${field.name}`}
          value={type}
          onChange={(event) => onType(event.target.value as PreviewVariable['kind'])}
        >
          <option value="text">Text</option>
          <option value="boolean">Boolean</option>
          <option value="number">Number</option>
          <option value="json">JSON</option>
        </select>
      </div>
      {type === 'boolean' ? (
        <select
          id={id}
          value={String(value === true || value === 'true')}
          onChange={(event) => onChange(event.target.value === 'true')}
        >
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      ) : type === 'number' ? (
        <input
          id={id}
          type="number"
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        />
      ) : (
        <textarea
          id={id}
          rows={String(value ?? '').length > 70 || type === 'json' ? 3 : 1}
          value={typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
          placeholder={type === 'json' ? '[] or {}' : 'Sample value'}
          spellCheck={false}
        />
      )}
      <p>
        {field.description}
        {field.conditional ? ' · conditional' : ''}
      </p>
    </div>
  )
}

export function PromptsMain({
  path,
  navigate,
  back,
}: {
  path: string
  navigate: (to: string) => void
  back: { label: string; onClick: () => void }
}) {
  const id = idOf(path)
  const [entries, setEntries] = useState<PromptEntry[]>([])
  const [listNote, setListNote] = useState('')
  const [listLoading, setListLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showBuiltIns, setShowBuiltIns] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [createNote, setCreateNote] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const reload = useCallback(() => {
    setListLoading(true)
    request<{ prompts: PromptEntry[] }>('/list')
      .then((data) => {
        setEntries(data.prompts)
        setListNote('')
      })
      .catch((error) => setListNote(message(error)))
      .finally(() => setListLoading(false))
  }, [])
  useEffect(reload, [reload])
  const matches = entries.filter(
    (entry) =>
      (showBuiltIns || entry.custom || entry.customized) &&
      `${entry.name} ${entry.description} ${entry.id} ${entry.uses.map((use) => use.label).join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  )
  async function create() {
    setCreateBusy(true)
    setCreateNote('')
    try {
      const doc = await request<PromptDocument>('/new', json({ name }))
      setCreating(false)
      setName('')
      reload()
      navigate(href(doc.id))
    } catch (error) {
      setCreateNote(message(error))
    } finally {
      setCreateBusy(false)
    }
  }
  return (
    <div className="sky-main sky-prompts">
      <header className="sky-head">
        <Button
          size="sm"
          onClick={
            id
              ? () => {
                  reload()
                  navigate(href())
                }
              : back.onClick
          }
          style={{ marginLeft: -10 }}
        >
          ‹ {id ? 'Prompts' : back.label}
        </Button>
        <span className="sky-title">Prompts</span>
      </header>
      <div className="sky-scroll">
        <div className="sky-prompt-page">
          {id ? (
            <Fragment key={id}>
              <PromptDetail id={id} entries={entries} navigate={navigate} onSaved={reload} />
            </Fragment>
          ) : (
            <>
              <div className="sky-prompt-heading">
                <div>
                  <h1>Prompts</h1>
                  <p>Find a prompt, see where it’s used, and make it yours.</p>
                </div>
                <Button
                  variant="light"
                  onClick={() => {
                    setCreateNote('')
                    setCreating(true)
                  }}
                >
                  ＋ New prompt
                </Button>
              </div>
              <div className="sky-prompt-search">
                <TextInput
                  className="sky-prompt-search-field"
                  aria-label="Search prompts"
                  placeholder="Search prompts or where they’re used…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <label className="sky-prompt-built-ins">
                  <input
                    type="checkbox"
                    checked={showBuiltIns}
                    onChange={(event) => setShowBuiltIns(event.target.checked)}
                  />
                  Show built-in prompts
                </label>
                <span>
                  {listLoading ? 'Loading…' : `${matches.length} ${matches.length === 1 ? 'prompt' : 'prompts'}`}
                </span>
              </div>
              {listNote && (
                <div role="alert" className="sky-prompt-error">
                  {listNote}{' '}
                  <Button size="compact-sm" onClick={reload}>
                    Retry
                  </Button>
                </div>
              )}
              <table className="sky-prompt-table">
                <thead>
                  <tr>
                    <th>Prompt</th>
                    <th>Used in</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <button className="sky-prompt-name" onClick={() => navigate(href(entry.id))}>
                          {entry.name}
                          {drafts.get(entry.id) && changed(drafts.get(entry.id)!) ? ' •' : ''}
                        </button>
                        {entry.customized && <span className="sky-prompt-customized">Customized</span>}
                        <p>{entry.description || entry.id}</p>
                        {entry.error && <small className="sky-prompt-error">{entry.error}</small>}
                      </td>
                      <td>
                        <div className="sky-prompt-usage">
                          <Usage uses={entry.uses} navigate={navigate} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!listLoading && !matches.length && (
                <p className="sky-prompt-muted">
                  {search ? 'No matching prompts.' : showBuiltIns ? 'No prompts found.' : 'No custom prompts yet.'}
                  {!showBuiltIns &&
                    (search
                      ? ' Turn on “Show built-in prompts” to search those too.'
                      : ' Create a prompt or turn on “Show built-in prompts” to customize one.')}
                </p>
              )}
              <p className="sky-prompt-footnote">
                Your changes are saved in the notebook and used the next time a prompt runs.
              </p>
            </>
          )}
        </div>
      </div>
      <Modal opened={creating} onClose={() => !createBusy && setCreating(false)} title="New prompt" centered>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <TextInput
            autoFocus
            label="Name"
            description="Letters, numbers, and dashes. You can use this prompt as a template in another prompt."
            placeholder="email-template"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {createNote && (
            <p role="alert" className="sky-prompt-error">
              {createNote}
            </p>
          )}
          <Button type="submit" loading={createBusy} disabled={!name.trim()} mt="md">
            Create prompt
          </Button>
        </form>
      </Modal>
    </div>
  )
}

function PromptDetail({
  id,
  entries,
  navigate,
  onSaved,
}: {
  id: string
  entries: PromptEntry[]
  navigate: (to: string) => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<Draft | null>(drafts.get(id) ?? null)
  const current = useRef(draft)
  current.current = draft
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [mode, setMode] = useState<'visual' | 'markdown'>('visual')
  const [visualSource, setVisualSource] = useState(draft?.content || '')
  const [revision, setRevision] = useState(0)
  const editor = useRef<EditorHandle | null>(null)
  const source = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState<PromptPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewBusy, setPreviewBusy] = useState(true)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [types, setTypes] = useState<Record<string, PreviewVariable['kind']>>({})
  const [copied, setCopied] = useState(false)
  function accept(next: Draft, remount = false) {
    drafts.set(id, next)
    current.current = next
    setDraft(next)
    if (remount) {
      setVisualSource(next.content)
      setRevision((value) => value + 1)
    }
  }
  useEffect(() => {
    const cached = drafts.get(id)
    if (cached && changed(cached)) {
      setVisualSource(cached.content)
      return
    }
    const controller = new AbortController()
    request<PromptDocument>(`/document?id=${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((doc) => {
        if (!controller.signal.aborted) {
          accept({ saved: doc, content: doc.content }, true)
          setNote('')
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setNote(message(error))
      })
    return () => controller.abort()
  }, [id])
  useEffect(() => {
    if (!draft) return
    const controller = new AbortController()
    setPreviewBusy(true)
    const timer = window.setTimeout(() => {
      let sample: Record<string, unknown>
      try {
        sample = Object.fromEntries(
          Object.entries(values).map(([key, value]) => [
            key,
            types[key] === 'json' && typeof value === 'string' ? JSON.parse(value || 'null') : value,
          ]),
        )
      } catch (error) {
        setPreviewError(`Invalid sample JSON: ${message(error)}`)
        setPreviewBusy(false)
        return
      }
      request<PromptPreview>('/preview', {
        ...json({ id, content: draft.content, values: sample }),
        signal: controller.signal,
      })
        .then((result) => {
          if (!controller.signal.aborted) {
            setPreview(result)
            setPreviewError('')
            setPreviewBusy(false)
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setPreviewError(message(error))
            setPreviewBusy(false)
          }
        })
    }, 200)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [id, draft?.content, values, types])
  const edit = (content: string) => {
    if (current.current) accept({ ...current.current, content })
    setNote('')
  }
  function switchMode(next: 'visual' | 'markdown') {
    if (!current.current || mode === next) return
    const content = editor.current?.content() ?? current.current.content
    edit(content)
    if (next === 'visual') {
      setVisualSource(content)
      setRevision((value) => value + 1)
    }
    setMode(next)
  }
  async function save() {
    const latest = current.current
    if (!latest || busy) return
    const content = editor.current?.content() ?? latest.content
    setBusy(true)
    setNote('')
    try {
      const doc = await request<PromptDocument>(
        '/document',
        json({ id, content, version: latest.saved.version }, 'PUT'),
      )
      accept({ saved: doc, content: current.current?.content ?? content })
      setNote('Saved. Future runs will use this prompt.')
      onSaved()
    } catch (error) {
      setNote(message(error))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      }
    }
    document.addEventListener('keydown', shortcut)
    return () => document.removeEventListener('keydown', shortcut)
  })
  async function reload() {
    setBusy(true)
    try {
      const doc = await request<PromptDocument>(`/document?id=${encodeURIComponent(id)}`)
      accept({ saved: doc, content: doc.content }, true)
      setNote('')
    } catch (error) {
      setNote(message(error))
    } finally {
      setBusy(false)
    }
  }
  async function restore() {
    if (!draft) return
    setBusy(true)
    try {
      const doc = await request<PromptDocument>('/restore', json({ id, version: draft.saved.version }))
      accept({ saved: doc, content: doc.content }, true)
      setRestoring(false)
      setNote('Built-in prompt restored.')
      onSaved()
    } catch (error) {
      setNote(message(error))
      setRestoring(false)
    } finally {
      setBusy(false)
    }
  }
  if (!draft) return <p role="status">{note || 'Opening prompt…'}</p>
  const dirty = changed(draft)
  const included = preview?.includes ?? draft.saved.includes
  const formats: Array<[EditorFormat, string, string]> = [
    ['bold', 'B', 'Bold'],
    ['italic', 'I', 'Italic'],
    ['heading', 'H₂', 'Heading'],
    ['paragraph', '¶', 'Paragraph'],
    ['bullets', '☷', 'Bullet list'],
    ['undo', '↶', 'Undo'],
    ['redo', '↷', 'Redo'],
  ]
  return (
    <>
      <div className="sky-prompt-heading">
        <div>
          <h1>{draft.saved.name}</h1>
          <p>{draft.saved.description || 'Edit the instructions and try them with sample context.'}</p>
        </div>
        <div className="sky-prompt-save">
          <div>
            <Button
              disabled={!dirty || busy}
              onClick={() => accept({ saved: draft.saved, content: draft.saved.content }, true)}
            >
              Discard
            </Button>
            <Button variant="light" loading={busy} disabled={!dirty} onClick={() => void save()}>
              Save changes
            </Button>
          </div>
          <span>
            {dirty ? 'Unsaved changes' : draft.saved.customized ? 'Saved in your notebook' : 'Built-in prompt'}
          </span>
        </div>
      </div>
      <div className="sky-prompt-usage">
        <span className="sky-prompt-muted">Used in</span>
        <Usage uses={draft.saved.uses} navigate={navigate} />
        {included.length > 0 && (
          <>
            <span className="sky-prompt-muted">· Uses</span>
            {included.map((ref) => (
              <button className="sky-prompt-chip" key={ref.id} onClick={() => navigate(href(ref.id))}>
                {ref.name} ↗
              </button>
            ))}
          </>
        )}
      </div>
      {note && (
        <p role="status" className="sky-prompt-note">
          {note}
          {note.includes('changed since') && (
            <Button size="compact-sm" onClick={() => void reload()}>
              Reload saved version
            </Button>
          )}
        </p>
      )}
      <div className="sky-prompt-grid">
        <section className="sky-prompt-panel sky-prompt-source">
          <div className="sky-prompt-panel-head">
            <h2>Content</h2>
            <div className="sky-prompt-modes" role="group" aria-label="Editor view">
              <button aria-pressed={mode === 'visual'} onClick={() => switchMode('visual')}>
                Visual
              </button>
              <button aria-pressed={mode === 'markdown'} onClick={() => switchMode('markdown')}>
                Markdown
              </button>
            </div>
          </div>
          {mode === 'visual' && (
            <div className="sky-prompt-toolbar" role="toolbar" aria-label="Text formatting">
              {formats.map(([command, label, accessible]) => (
                <button
                  key={command}
                  aria-label={accessible}
                  title={accessible}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => editor.current?.format(command)}
                >
                  {label}
                </button>
              ))}
              <select
                aria-label="Insert template"
                value=""
                onChange={(event) => {
                  const ref = `\n\n{{> "/${event.target.value}"}}\n`
                  const content = (editor.current?.content() ?? draft.content) + ref
                  edit(content)
                  setVisualSource(content)
                  setRevision((value) => value + 1)
                }}
              >
                <option value="" disabled>
                  Insert template…
                </option>
                {entries
                  .filter((entry) => entry.id !== id)
                  .map((entry) => (
                    <option value={entry.id} key={entry.id}>
                      {entry.name} · {entry.id}
                    </option>
                  ))}
              </select>
            </div>
          )}
          {mode === 'visual' ? (
            <Fragment key={revision}>
              <VisualEditor initial={visualSource} handle={editor} onChange={edit} />
            </Fragment>
          ) : (
            <textarea
              ref={source}
              className="sky-prompt-markdown"
              aria-label="Prompt Markdown"
              spellCheck={false}
              value={draft.content}
              onChange={(event) => edit(event.target.value)}
            />
          )}
          <footer>
            <code title={id}>{id}</code>
            <span>{draft.content.split('\n').length} lines</span>
          </footer>
        </section>
        <section className="sky-prompt-panel sky-prompt-test">
          <div className="sky-prompt-panel-head">
            <h2>Try it out</h2>
            <span className="sky-prompt-live">{previewBusy ? 'Updating…' : 'Live preview'}</span>
          </div>
          <div className="sky-prompt-variables">
            <div className="sky-prompt-variables-head">
              <h3>Variables {preview ? `· ${preview.variables.length}` : ''}</h3>
              <select
                aria-label="Sample context"
                value="custom"
                onChange={(event) => {
                  setTypes({})
                  setValues(
                    event.target.value === 'sample'
                      ? {}
                      : Object.fromEntries(
                          (preview?.variables || []).map((field) => [
                            field.name,
                            field.kind === 'boolean' ? false : field.kind === 'json' ? '[]' : '',
                          ]),
                        ),
                  )
                }}
              >
                <option value="custom" disabled>
                  Sample context
                </option>
                <option value="sample">Load sample values</option>
                <option value="empty">Empty context</option>
              </select>
            </div>
            <p>Edit sample values to simulate the context.</p>
            <div className="sky-prompt-fields">
              {preview?.variables.map((field) => (
                <Fragment key={field.name}>
                  <Variable
                    field={field}
                    type={types[field.name] || field.kind}
                    value={Object.hasOwn(values, field.name) ? values[field.name] : field.sample}
                    onType={(type) => {
                      setTypes((previous) => ({ ...previous, [field.name]: type }))
                      setValues((previous) => ({
                        ...previous,
                        [field.name]:
                          type === 'boolean'
                            ? true
                            : type === 'number'
                              ? 1
                              : type === 'json'
                                ? '[]'
                                : String(previous[field.name] ?? field.sample),
                      }))
                    }}
                    onChange={(value) => setValues((previous) => ({ ...previous, [field.name]: value }))}
                  />
                </Fragment>
              ))}
              {preview && !preview.variables.length && <p>No variables in this prompt.</p>}
            </div>
          </div>
          <div className="sky-prompt-preview-head">
            <div>
              <h3>Rendered preview</h3>
              <p>The text after templates and variables are filled in.</p>
            </div>
            <button
              disabled={previewBusy || !!previewError || !preview}
              onClick={() => {
                void navigator.clipboard
                  .writeText(preview?.output || '')
                  .then(() => {
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 2000)
                  })
                  .catch(() => setNote('Select the preview text and copy it with Command/Ctrl+C.'))
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {previewError ? (
            <pre role="alert" className="sky-prompt-error">
              {previewError}
            </pre>
          ) : (
            <>
              {!!preview?.empty.length && (
                <p role="status" className="sky-prompt-empty">
                  Empty values: {preview.empty.join(', ')}
                </p>
              )}
              <pre className="sky-prompt-output" aria-label="Rendered prompt" aria-busy={previewBusy} tabIndex={0}>
                {preview?.output || (previewBusy ? 'Preparing preview…' : 'This prompt renders to empty text.')}
              </pre>
            </>
          )}
          <footer>Sample values only · no AI run</footer>
        </section>
      </div>
      <div className="sky-prompt-bottom">
        <span>Changes apply the next time this prompt is loaded.</span>
        {draft.saved.customized && !draft.saved.custom && (
          <button onClick={() => setRestoring(true)}>Restore built-in prompt</button>
        )}
      </div>
      <Modal
        opened={restoring}
        onClose={() => !busy && setRestoring(false)}
        title="Restore the built-in prompt?"
        centered
      >
        <p>This removes your saved customization and replaces the current edit with the built-in text.</p>
        <Button variant="light" loading={busy} onClick={() => void restore()}>
          Restore built-in
        </Button>
      </Modal>
    </>
  )
}
