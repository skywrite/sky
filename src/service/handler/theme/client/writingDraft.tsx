import { Button, Select, Textarea } from '@mantine/core'
import { useEffect, useMemo, useState } from 'react'
import { currentDraftVersion, type WritingDraft } from '#lib/writingVoice/draftTypes.ts'
import { MAX_WRITING_CHARS } from '#lib/writingVoice/types.ts'
import { RenderedHtml } from './renderedHtml.tsx'
import { writingDraftDiffHtml } from './writingDraftDiff.ts'
import { WritingVoiceQuestions } from './writingVoice.tsx'
import { renderStatic } from './wysiwyg/render.ts'
import './writingDraft.css'

type Edit = { revision: number; text: string; explanation: string }
const editKey = (draftId: string) => `sky-writing-edit:${draftId}`

function savedEdit(key: string): Edit | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Edit | null
    return value &&
      Number.isSafeInteger(value.revision) &&
      typeof value.text === 'string' &&
      typeof value.explanation === 'string'
      ? value
      : null
  } catch {
    return null
  }
}

export function WritingDraftEditor<T extends WritingDraft>({
  anchor,
  unsaved = false,
  mutate,
  onEditingChange,
  draft,
  disabled = false,
  onChange,
  onAsk,
}: {
  key?: string
  anchor?: string
  /** No record exists yet. The first action saves one, and its id may differ from the one shown. */
  unsaved?: boolean
  mutate: (body: unknown) => Promise<T>
  onEditingChange?: (editing: boolean) => void
  draft: T
  disabled?: boolean
  onChange: (draft: T) => void
  onAsk?: (draft: T) => void
}) {
  const current = currentDraftVersion(draft)
  const key = editKey(draft.id)
  const [edit, setEdit] = useState<Edit | null>(() => savedEdit(key))
  useEffect(() => {
    onEditingChange?.(edit !== null)
    return () => onEditingChange?.(false)
  }, [edit !== null, onEditingChange])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [history, setHistory] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const html = useMemo(() => renderStatic(current.text), [current.text])
  const version = draft.versions.find((v) => v.version === selected) ?? current
  const versionHtml = useMemo(() => renderStatic(version.text), [version.text])
  const comparisonHtml = useMemo(
    () => (history && version.text !== current.text ? writingDraftDiffHtml(current.text, version.text) : ''),
    [history, current.text, version.text],
  )
  const historyId = `${anchor ?? `writing-draft-${draft.id}`}-history`
  // Sky is still working on an edit: no lesson yet, no failure, and no question waiting for the owner.
  const learning = draft.versions.some(
    (v) =>
      v.accepted &&
      v.learnFrom &&
      !v.learningDone &&
      !v.folded &&
      !v.lesson &&
      !v.learningError &&
      !(v.question && !v.answer),
  )
  const learningError = draft.versions.find((v) => v.learningError)?.learningError
  const remember = (value: Edit | null) => {
    setEdit(value)
    try {
      if (value) localStorage.setItem(key, JSON.stringify(value))
      else localStorage.removeItem(key)
      window.dispatchEvent(new CustomEvent('sky-writing-edit', { detail: key }))
    } catch {
      setError('This browser could not keep your unsaved edit. Keep this page open until it is saved.')
    }
  }
  useEffect(() => {
    const sync = (event: Event) => {
      const changed = event instanceof StorageEvent ? event.key : (event as CustomEvent<string>).detail
      if (changed === key) setEdit(savedEdit(key))
    }
    window.addEventListener('storage', sync)
    window.addEventListener('sky-writing-edit', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('sky-writing-edit', sync)
    }
  }, [key])
  useEffect(() => {
    if (!edit) return
    const leaving = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', leaving)
    return () => window.removeEventListener('beforeunload', leaving)
  }, [edit !== null])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(timer)
  }, [copied])
  const act = async (body: unknown, saved = false) => {
    if (busy || disabled) return
    setBusy(true)
    setError('')
    try {
      const next = await mutate(body)
      onChange(next)
      if (saved) remember(null)
      return next
    } catch (problem) {
      setError((problem as Error).message)
      return undefined
    } finally {
      setBusy(false)
    }
  }
  const ask = async () => {
    const next = unsaved ? await act({ action: 'adopt' }) : draft
    if (next) onAsk?.(next)
  }
  const save = (revision: number) =>
    void act({ action: 'edit', revision, text: edit!.text, explanation: edit!.explanation }, true)

  return (
    <section
      className="sky-writing-draft"
      id={anchor ?? `writing-draft-${draft.id}`}
      aria-label={`Draft${draft.input.recipient ? ` to ${draft.input.recipient}` : ''}`}
    >
      <header className="sky-writing-draft-head">
        <div>
          <strong>Draft</strong>
          <span>
            {draft.input.medium}
            {draft.input.recipient ? ` · ${draft.input.recipient}` : ''}
          </span>
        </div>
        <span className="sky-writing-draft-version">
          Version {draft.revision}
          {current.author === 'you' ? ' · Your edit' : current.accepted ? ' · Accepted' : ''}
        </span>
      </header>
      {edit ? (
        <div className="sky-writing-draft-edit">
          <Textarea
            aria-label="Edit draft text"
            className="sky-writing-draft-textarea"
            autosize
            minRows={7}
            maxRows={28}
            value={edit.text}
            maxLength={MAX_WRITING_CHARS}
            disabled={busy}
            onChange={(event) => remember({ ...edit, text: event.currentTarget.value })}
          />
          <Textarea
            label="Why I changed this (optional)"
            placeholder="What should Sky learn from this edit?"
            autosize
            minRows={2}
            maxLength={4000}
            value={edit.explanation}
            disabled={busy}
            onChange={(event) => remember({ ...edit, explanation: event.currentTarget.value })}
          />
          {edit.revision !== draft.revision && (
            <div className="sky-writing-draft-conflict" role="status">
              <p>A newer version was saved while you were editing. Your text is still here.</p>
              <Button
                size="sm"
                onClick={() => {
                  setSelected(draft.revision)
                  setHistory(true)
                }}
              >
                Compare with latest
              </Button>
              <Button size="sm" disabled={busy || disabled || !edit.text.trim()} onClick={() => save(draft.revision)}>
                Use my edit over version {draft.revision}
              </Button>
            </div>
          )}
          <div className="sky-writing-draft-actions">
            <Button
              variant="primary"
              size="sm"
              disabled={busy || disabled || !edit.text.trim() || edit.revision !== draft.revision}
              loading={busy}
              onClick={() => save(edit.revision)}
            >
              Save edit
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                remember(null)
                setError('')
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <RenderedHtml className="sky-writing-draft-body sky-rendered" html={html} />
          <div className="sky-writing-draft-actions">
            <Button
              size="sm"
              disabled={busy || disabled}
              onClick={() => remember({ revision: draft.revision, text: current.text, explanation: '' })}
            >
              Edit
            </Button>
            {onAsk && (
              <Button size="sm" disabled={busy || disabled} onClick={() => void ask()}>
                Work on this…
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard
                  .writeText(current.text)
                  .then(() => setCopied(true))
                  .catch(() => setError('Copy failed. You can select and copy the draft text.'))
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
            {draft.revision > 1 && (
              <Button
                size="sm"
                disabled={busy || disabled}
                onClick={() => void act({ action: 'restore', revision: draft.revision, version: draft.revision - 1 })}
              >
                Undo
              </Button>
            )}
            <Button
              size="sm"
              aria-expanded={history}
              aria-controls={historyId}
              rightSection={
                <svg
                  className="sky-writing-draft-caret"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="m3 6 5 5 5-5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              }
              onClick={() => {
                if (!history) setSelected(Math.max(1, draft.revision - 1))
                setHistory(!history)
              }}
            >
              Versions · {draft.revision}
            </Button>
            {draft.revision > 1 && !current.accepted && (
              <Button
                variant="primary"
                size="sm"
                disabled={busy || disabled}
                onClick={() => void act({ action: 'accept', revision: draft.revision })}
              >
                Use this version
              </Button>
            )}
          </div>
        </>
      )}
      {error && (
        <p className="sky-writing-draft-error" role="alert">
          {error}
        </p>
      )}
      {history && (
        <div className="sky-writing-draft-history" id={historyId}>
          <Select
            label="Version history"
            value={String(version.version)}
            onChange={(value) => setSelected(Number(value))}
            allowDeselect={false}
            data={draft.versions.toReversed().map((v) => ({
              value: String(v.version),
              label: `Version ${v.version} · ${v.author === 'you' ? 'You' : 'Sky'}${v.restoredFrom ? ` · Restored from ${v.restoredFrom}` : ''}${v.version === draft.revision ? ' · Current' : ''}`,
            }))}
          />
          {comparisonHtml ? (
            <div className="sky-writing-draft-comparison" role="region" aria-label="Changes if restored">
              <p className="sky-writing-draft-comparison-title">
                Current version {draft.revision} → Version {version.version}
              </p>
              <p className="sky-writing-draft-diff-legend">
                If restored: <span className="sky-writing-draft-removed">Removed</span>
                <span className="sky-writing-draft-added">Added</span>
              </p>
              <RenderedHtml className="sky-writing-draft-diff" html={comparisonHtml} />
            </div>
          ) : (
            <>
              <p className="sky-writing-draft-reason">
                {version.version === draft.revision
                  ? draft.revision === 1
                    ? 'This is the first version. Edits will appear here for comparison.'
                    : 'This is the current version. Choose an earlier version to compare.'
                  : 'This version has the same text as the current draft.'}
              </p>
              <RenderedHtml className="sky-rendered" html={versionHtml} />
            </>
          )}
          {(version.explanation || version.direction) && (
            <p className="sky-writing-draft-reason">
              <strong>Why / direction:</strong> {version.explanation || version.direction}
            </p>
          )}
          {version.version !== draft.revision && (
            <Button
              size="sm"
              disabled={busy || disabled || !!edit || version.text === current.text}
              onClick={() => void act({ action: 'restore', revision: draft.revision, version: version.version })}
            >
              Restore this version
            </Button>
          )}
        </div>
      )}
      {learningError && (
        <div className="sky-writing-draft-error" role="status">
          <p>Your draft is saved. Learning could not finish: {learningError}</p>
          <Button size="sm" disabled={busy} onClick={() => void act({ action: 'retry-learning' })}>
            Retry learning
          </Button>
        </div>
      )}
      {!unsaved && (
        <WritingVoiceQuestions
          source={`draft:${draft.id}`}
          refreshKey={JSON.stringify(
            draft.versions.map((v) => [v.version, v.accepted, Boolean(v.question), v.answer, Boolean(v.lesson)]),
          )}
          polling={learning}
        />
      )}
    </section>
  )
}
