import './dayChatClose.css'
import { ActionIcon, Button } from '@mantine/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useItemEditing } from './dayItemEditing.tsx'
import { fileHref } from './explorer.tsx'
import type { ImportJob } from './import.tsx'

/** Notify once when a capture finishes; opening a day never replays old completions. */
export function useDocumentNotices(imports: ImportJob[]) {
  const states = useRef(new Map<string, ImportJob['state']>())
  const [notices, setNotices] = useState<ImportJob[]>([])
  const observe = useCallback((job: ImportJob, started = false) => {
    if (job.readback.source !== 'document') return
    const previous = states.current.get(job.id)
    states.current.set(job.id, job.state)
    if ((job.state === 'done' || job.state === 'failed') && (started || (previous && previous !== job.state)))
      setNotices((current) => [...current.filter((item) => item.id !== job.id), job])
    else if (started) setNotices((current) => current.filter((item) => item.id !== job.id))
  }, [])
  useEffect(() => {
    for (const job of imports) observe(job)
  }, [imports, observe])
  const dismiss = useCallback((id: string) => setNotices((current) => current.filter((job) => job.id !== id)), [])
  return { notice: notices[0], started: (job: ImportJob) => observe(job, true), dismiss }
}

export function DocumentSummaryDialog({
  job,
  onClose,
  onRetry,
}: {
  job: ImportJob
  onClose: () => void
  onRetry: () => void
}) {
  const busy = job.state === 'running' || job.state === 'needs-you' || job.state === 'new'
  const saved = Boolean(job.result) || job.stage?.id === 'summary' || job.stage?.id === 'tags'
  const title =
    job.state === 'done'
      ? 'Summary ready'
      : busy
        ? saved
          ? 'Summarizing the document…'
          : 'Saving your note…'
        : 'The summary did not finish'
  return (
    <>
      <div className="sky-confirm-title" role="status">
        {title}
      </div>
      <div className="sky-lead">{job.fields?.summary ?? job.title}</div>
      {busy ? (
        <>
          {saved && <p className="sky-lead">Your note and attachment are saved.</p>}
          <p className="sky-confirm-next">
            It’s safe to close this dialog. Sky will keep working and let you know when the summary is ready.
          </p>
        </>
      ) : (
        <p className="sky-lead">
          {job.state === 'done' ? 'The summary has been added to your note.' : (job.error ?? job.line)}
        </p>
      )}
      <div className="sky-dialog-actions">
        <Button onClick={onClose}>Close</Button>
        {job.result && (
          <Button variant="primary" component="a" href={fileHref(job.result.file)} onClick={onClose}>
            Open note
          </Button>
        )}
        {!busy && job.state !== 'done' && (
          <Button variant="primary" onClick={onRetry}>
            Retry summary
          </Button>
        )}
      </div>
    </>
  )
}

/** The same small, temporary notification surface used when a chat finishes saving. */
export function DocumentImportNotice({
  job,
  blocked,
  onDismiss,
  onOpen,
}: {
  job: ImportJob
  blocked: boolean
  onDismiss: (id: string) => void
  onOpen: (id: string) => void
}) {
  const editing = useItemEditing()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hidden, setHidden] = useState(document.hidden)
  const remaining = useRef(20000)
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  const failed = job.state === 'failed'
  const covered = blocked || Boolean(editing?.feedbackActive)
  const paused = covered || hovered || focused || hidden
  useEffect(() => {
    const change = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  useEffect(() => {
    if (paused || failed) return
    const started = performance.now()
    const timer = setTimeout(() => dismiss.current(job.id), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (performance.now() - started))
    }
  }, [paused, failed, job.id])
  return (
    <div
      className="sky-undo sky-chat-close-toast sky-document-toast"
      data-covered={covered}
      data-paused={paused}
      data-failed={failed}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
    >
      <span className="sky-undo-text" role={failed ? 'alert' : 'status'}>
        {failed ? 'Summary needs attention' : 'Summary ready'} — {job.fields?.summary ?? job.title}
      </span>
      {!failed && job.result ? (
        <Button
          variant="primary-quiet"
          size="compact-sm"
          component="a"
          href={fileHref(job.result.file)}
          onClick={() => onDismiss(job.id)}
        >
          Open note
        </Button>
      ) : (
        <Button
          variant="primary-quiet"
          size="compact-sm"
          onClick={() => {
            onDismiss(job.id)
            onOpen(job.id)
          }}
        >
          View
        </Button>
      )}
      <ActionIcon variant="secondary" aria-label="Dismiss summary notification" onClick={() => onDismiss(job.id)}>
        ×
      </ActionIcon>
      {!failed && (
        <span className="sky-undo-track" aria-hidden="true">
          <span className="sky-undo-fill" />
        </span>
      )}
    </div>
  )
}
