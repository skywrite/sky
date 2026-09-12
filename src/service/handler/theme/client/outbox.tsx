import { ActionIcon, Button, Checkbox, Textarea, TextInput } from '@mantine/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { describeOutboxScan, outboxScanSeverity } from '#lib/outbox/describeScan.ts'
import { dayRange, rangeLabel, ScanRangeSchema, type SavedScanRange } from '#lib/outbox/range.ts'
import type { OutboxRecord } from '#lib/outbox/types.ts'
import type { OutboxReport, OutboxScanResult } from '../../outbox/mod.ts'
import { ReplyThreadPanel, type OpenReplyThread } from './replyThreads.tsx'
import { WritingDraftEditor } from './writingDraft.tsx'
import { WritingVoiceQuestions } from './writingVoice.tsx'
import './outbox.css'

type Edit = { text: string; revision: string; saved: string; direction?: string; compositionId?: string }
// Going to another Sky page must not discard an unfinished edit.
const edits = new Map<string, Edit>()

function savedEdit(record: OutboxRecord): Edit {
  return {
    text: record.draft,
    revision: record.revision,
    saved: record.draft,
    direction: record.composition?.status === 'complete' ? undefined : record.replyDirections?.at(-1)?.text,
    compositionId: record.composition?.status === 'running' ? record.composition.id : undefined,
  }
}

async function request<T>(url: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(`/outbox/_api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.message ?? 'Outbox could not complete this step.')
  return body as T
}

function Pen() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15l-1 5Z" />
    </svg>
  )
}

function needsReview(item: OutboxRecord): boolean {
  return item.status !== 'ready' || item.stale
}

function sourceLink(item: OutboxRecord): string | null {
  const target = item.conversation.target
  if (!target) return null
  return target.medium === 'Slack'
    ? target.link
    : `https://mail.google.com/mail/u/${encodeURIComponent(target.account)}/#all/${target.thread}`
}

export function OutboxMain({ navigate }: { navigate: (path: string) => void }) {
  const [report, setReport] = useState<OutboxReport | null>(null)
  const [error, setError] = useState('')
  const [connectionError, setConnectionError] = useState(false)
  const [actionBusy, setBusy] = useState(false)
  const [startingCheck, setStartingCheck] = useState(false)
  const [scanFeedback, setScanFeedback] = useState<OutboxScanResult | null>(null)
  const [searchEdit, setSearchEdit] = useState<SavedScanRange | null>(null)
  const search = searchEdit ?? report?.search
  const rangeValid = !search || ScanRangeSchema.safeParse(search.value).success
  const checkInFlight = useRef(false)
  const [tab, setTab] = useState<'review' | 'ready'>('review')
  const [selected, setSelected] = useState<string | null>(null)
  const [linkedItem, setLinkedItem] = useState<OutboxRecord | null>(null)
  const [edit, setEdit] = useState<Edit | null>(null)
  const [startingComposition, setComposing] = useState(false)
  const [composeError, setComposeError] = useState('')
  const compositionInFlight = useRef(false)
  const submittedComposition = useRef<{
    id: string
    revision: string
    draft: string
    direction: string
    typedDirection?: string
  } | null>(null)
  const [approving, setApproving] = useState<string | null>(null)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [manualReply, setManualReply] = useState(false)
  const [sharedEditing, setSharedEditing] = useState(false)
  const [discussion, setDiscussion] = useState<OpenReplyThread | null>(null)
  const [discussionOpen, setDiscussionOpen] = useState(false)
  const [draftNotice, setDraftNotice] = useState('')
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const [reviewedChanges, setReviewedChanges] = useState(false)
  const [details, setDetails] = useState(true)
  const [sentReport, setSentReport] = useState<string | null>(null)
  const initialItem = useRef(new URLSearchParams(window.location.search).get('item'))
  const scroll = useRef<HTMLDivElement>(null)
  const actionFeedback = useRef<HTMLDivElement>(null)
  const listPosition = useRef(0)
  const composingItem = report?.items.find((record) => record.id === selected)
  const composition = composingItem?.composition
  const composing =
    startingComposition || (composition?.status === 'running' && composition.revision === composingItem?.revision)
  const busy = actionBusy || composing
  const checking = startingCheck || report?.check?.running === true
  const progress = report?.check?.progress
  const scanResult = scanFeedback ?? report?.check?.result
  const scanFailed =
    !checking &&
    (scanResult
      ? (scanResult.severity ?? (scanResult.outcome === 'failed' ? 'error' : 'info')) === 'error'
      : report?.lastScan && outboxScanSeverity(report.lastScan) === 'error')
  const scanMessage = checking
    ? progress?.status === 'running'
      ? `Checking saved conversations… ${progress.completed} of ${progress.total} checked. ${progress.prepared} need your review.`
      : 'Finding saved Slack and email conversations in your range…'
    : (scanFeedback?.message ??
      report?.check?.result?.message ??
      (report?.lastScan ? describeOutboxScan(report.lastScan) : 'Ready to check your saved conversations.'))
  const checkFeedback = () => (
    <p
      className="sky-outbox-scan-feedback"
      role={scanFailed ? 'alert' : 'status'}
      aria-live="polite"
      aria-atomic="true"
      data-checking={checking}
    >
      {scanMessage}
    </p>
  )
  const polling =
    checking ||
    Boolean(selected) ||
    composing ||
    Boolean(approving) ||
    report?.followupsRunning === true ||
    Boolean(
      report?.items.some(
        (item) =>
          item.composition?.status === 'running' ||
          item.status === 'placing' ||
          (['pending', 'preparing'].includes(item.followupStatus ?? '') && item.status === 'ready'),
      ),
    )
  const receiveReport = useCallback((value: OutboxReport) => {
    setReport(value)
    setConnectionError(false)
    // A restart can lose the POST acknowledgement after saving its range. Reuse
    // the recovered revision without discarding a different unsaved selection.
    setSearchEdit((current) =>
      current &&
      value.search &&
      current.value.start === value.search.value.start &&
      current.value.end === value.search.value.end
        ? null
        : current,
    )
  }, [])
  const refresh = useCallback(async () => receiveReport(await request<OutboxReport>('/status')), [receiveReport])
  useEffect(() => {
    let alive = true
    const read = () =>
      request<OutboxReport>('/status')
        .then((value) => {
          if (alive) receiveReport(value)
        })
        .catch(() => {
          if (alive) setConnectionError(true)
        })
    void read()
    window.addEventListener('focus', read)
    const timer = setInterval(read, polling || connectionError ? 2_000 : 60_000)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', read)
    }
  }, [polling, connectionError, receiveReport])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if ([...edits.values()].some((value) => value.text !== value.saved || value.direction?.trim()))
        event.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = selected ? 0 : listPosition.current
  }, [selected])

  const item =
    report?.items.find((candidate) => candidate.id === selected) ??
    (linkedItem?.id === selected ? linkedItem : undefined)
  useEffect(() => {
    if (!item?.composition) return
    const pending = submittedComposition.current
    const completed = item.composition.status === 'complete'
    setEdit((current) => {
      const recoveredSubmission =
        current &&
        pending?.id === item.id &&
        item.composition!.submittedRevision === pending.revision &&
        current.revision === pending.revision &&
        current.text === pending.draft &&
        current.direction === pending.typedDirection &&
        item.replyDirections?.at(-1)?.text === pending.direction
      if (
        !current ||
        (!recoveredSubmission &&
          current.compositionId !== item.composition!.id &&
          current.revision !== item.composition!.revision) ||
        (!recoveredSubmission && current.text !== current.saved)
      )
        return current
      if (item.composition!.status === 'running' && !recoveredSubmission) return current
      // A failed worker can update source metadata, but a newer editor's words
      // must still show as a conflict with this editor's saved submission.
      if (!completed && item.draft !== current.text.trim()) return current
      const next = savedEdit(item)
      if (completed) edits.delete(item.id)
      else edits.set(item.id, next)
      return next
    })
  }, [item])
  useEffect(() => {
    if (!item?.writingDraft) return
    setEdit((current) =>
      current?.direction?.trim()
        ? { ...current, text: item.draft, saved: item.draft, revision: item.revision }
        : savedEdit(item),
    )
  }, [item?.revision, item?.id])
  const receiveItem = (record: OutboxRecord) => {
    setReport((current) =>
      current
        ? { ...current, items: current.items.map((entry) => (entry.id === record.id ? record : entry)) }
        : current,
    )
    if (selectedRef.current === record.id) {
      setLinkedItem(record)
      setEdit(savedEdit(record))
    }
  }
  const askAboutDraft = () =>
    void act(async () => {
      if (!item?.writingDraft) return
      const response = await fetch(`/chat/drafts/${encodeURIComponent(item.writingDraft.id)}/discuss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const result = (await response.json()) as { id?: string; message?: string }
      if (!response.ok || !result.id) throw new Error(result.message ?? 'Sky could not open the draft discussion.')
      setDiscussion({ id: result.id, point: { turn: 0, key: item.writingDraft.id }, draftId: item.writingDraft.id })
      setDiscussionOpen(true)
    })
  const reviewCount = report?.items.filter(needsReview).length ?? 0
  const readyCount = (report?.items.length ?? 0) - reviewCount
  const items = report?.items.filter((candidate) => (tab === 'review') === needsReview(candidate)) ?? []
  const open = (record: OutboxRecord) => {
    listPosition.current = scroll.current?.scrollTop ?? 0
    setSelected(record.id)
    selectedRef.current = record.id
    setDiscussion(null)
    setDiscussionOpen(false)
    setSharedEditing(false)
    setLinkedItem(record)
    if (window.matchMedia('(max-width: 1000px)').matches) setDetails(false)
    setEdit(edits.get(record.id) ?? savedEdit(record))
    setReviewedChanges(false)
    setSentReport(null)
    setManualReply(false)
    setDraftNotice('')
    setComposeError('')
    setError('')
    void request<OutboxRecord>(`/item/${record.id}`)
      .then(receiveItem)
      .catch((problem) => {
        if (selectedRef.current === record.id) setError((problem as Error).message)
      })
  }
  const openRelated = async (id: string) => {
    try {
      const record =
        report?.items.find((candidate) => candidate.id === id) ?? (await request<OutboxRecord>(`/item/${id}`))
      open(record)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not open the related reply.')
    }
  }
  useEffect(() => {
    if (!report || !initialItem.current) return
    const id = initialItem.current
    initialItem.current = null
    void openRelated(id)
  }, [report])
  const change = (text: string) => {
    if (!item || !edit) return
    const next = { ...edit, text }
    edits.set(item.id, next)
    setEdit(next)
  }
  const changeDirection = (direction: string) => {
    if (!item || !edit) return
    const next = { ...edit, direction }
    edits.set(item.id, next)
    setEdit(next)
  }
  const act = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
      await refresh()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Outbox could not complete this step.')
      await refresh().catch(() => {})
    } finally {
      setBusy(false)
    }
  }
  const checkNow = async () => {
    if (busy || checking || checkInFlight.current || !rangeValid) return
    checkInFlight.current = true
    setStartingCheck(true)
    setBusy(true)
    setScanFeedback(null)
    let accepted = false
    try {
      const result = await request<OutboxScanResult>(
        '/scan',
        'POST',
        search ? { range: search.value, revision: search.revision } : {},
      )
      accepted = true
      if (!result.running)
        setScanFeedback({
          ...result,
          message:
            result.message ?? (result.outcome === 'failed' ? 'Sky could not complete this check.' : 'Check complete.'),
        })
    } catch (problem) {
      if (problem instanceof TypeError) setConnectionError(true)
      else
        setScanFeedback({
          outcome: 'failed',
          message: problem instanceof Error ? problem.message : 'Sky could not complete this check.',
        })
    } finally {
      await refresh().catch(() => setConnectionError(true))
      if (accepted) setSearchEdit(null)
      setStartingCheck(false)
      setBusy(false)
      checkInFlight.current = false
    }
  }
  const save = () =>
    act(async () => {
      if (!item || !edit) return
      const result = await request<OutboxRecord & { writingVoiceError?: string }>(`/item/${item.id}`, 'PUT', {
        revision: edit.revision,
        draft: edit.text,
      })
      edits.delete(item.id)
      if (result.writingVoiceError) setError(result.writingVoiceError)
      if (selectedRef.current === item.id)
        setEdit({ text: result.draft, revision: result.revision, saved: result.draft })
    })
  const approve = () =>
    act(async () => {
      if (!item || !edit) return
      setApproving(item.id)
      try {
        const result = await request<OutboxRecord & { writingVoiceError?: string }>(
          `/item/${item.id}/approve`,
          'POST',
          {
            revision: item.writingDraft ? item.revision : edit.revision,
            draft: item.writingDraft ? item.draft : edit.text,
            reviewedChanges,
          },
        )
        edits.delete(item.id)
        if (result.writingVoiceError) setError(result.writingVoiceError)
        if (selectedRef.current === item.id)
          setEdit({ text: result.draft, revision: result.revision, saved: result.draft })
      } finally {
        setApproving(null)
      }
    })
  const dismissRecord = (record: OutboxRecord, revision = record.revision) =>
    act(async () => {
      setDismissing(record.id)
      try {
        await request(`/item/${record.id}/dismiss`, 'POST', { revision })
        edits.delete(record.id)
        setReport((current) =>
          current ? { ...current, items: current.items.filter((entry) => entry.id !== record.id) } : current,
        )
        if (selectedRef.current === record.id) {
          setSelected(null)
          setEdit(null)
        }
      } finally {
        setDismissing(null)
      }
    })
  const dismiss = () =>
    item &&
    dismissRecord(item, item.status === 'ready' && !item.stale ? item.revision : (edit?.revision ?? item.revision))
  const compose = async (instruction?: string) => {
    if (busy || compositionInFlight.current || !item || !edit) return
    compositionInFlight.current = true
    const id = item.id
    const direction =
      instruction ??
      (edit.direction?.trim() ||
        'Prepare a concise, useful reply from the saved context. Ask only for a missing decision or fact that prevents completing it.')
    submittedComposition.current = {
      id,
      revision: edit.revision,
      draft: edit.text,
      direction,
      typedDirection: edit.direction,
    }
    setBusy(true)
    setComposing(true)
    setComposeError('')
    setDraftNotice('')
    setError('')
    try {
      const result = await request<OutboxRecord>(`/item/${id}/compose`, 'POST', {
        revision: edit.revision,
        draft: edit.text,
        instruction: direction,
        reviewedChanges,
      })
      submittedComposition.current = null
      const running = result.composition?.status === 'running'
      const unfinished = running || result.composition?.status === 'failed'
      const next = { ...savedEdit(result), direction: unfinished ? direction : undefined }
      if (unfinished) edits.set(id, next)
      else edits.delete(id)
      if (selectedRef.current === id) {
        setEdit(next)
        setLinkedItem(result)
        setDraftNotice(
          unfinished
            ? ''
            : result.questions.length
              ? 'Your draft and instructions are saved. Sky needs another detail to finish the reply.'
              : 'Revised draft saved.',
        )
      }
    } catch (problem) {
      if (problem instanceof TypeError) setConnectionError(true)
      else {
        submittedComposition.current = null
        if (selectedRef.current === id)
          setComposeError(problem instanceof Error ? problem.message : 'Sky could not revise this draft.')
      }
      try {
        const latest = await request<OutboxRecord>(`/item/${id}`)
        // The server may have saved the input before generation failed, or the
        // acknowledgement may have been lost after registering the worker.
        if (latest.draft === edit.text && latest.replyDirections?.at(-1)?.text === direction) {
          const next = { ...savedEdit(latest), direction }
          edits.set(id, next)
          if (selectedRef.current === id) {
            setEdit(next)
            setLinkedItem(latest)
            if (latest.composition?.status === 'running') setComposeError('')
          }
        }
      } catch {
        setConnectionError(true)
      }
    } finally {
      await refresh().catch(() => setConnectionError(true))
      setComposing(false)
      setBusy(false)
      compositionInFlight.current = false
    }
  }
  const conflicted = Boolean(
    item &&
    edit &&
    !composing &&
    item.revision !== edit.revision &&
    approving !== item.id &&
    !(item.status === 'ready' && !item.stale && item.draft === edit.text),
  )
  const placing = item?.status === 'placing' || item?.status === 'placement_unknown'
  const editable = item && (item.status === 'needs_review' || (item.stale && item.status === 'ready'))
  const nativeApp = item?.conversation.medium === 'Email' ? 'Gmail' : 'Slack'
  const followupsPending = item && ['pending', 'preparing'].includes(item.followupStatus ?? '')
  const revisionError = composing ? '' : composeError || (composition?.status === 'failed' ? composition.error : '')
  const revisionNotice = composing
    ? startingComposition
      ? 'Saving your draft and instructions…'
      : 'Draft and instructions saved. Sky is revising…'
    : draftNotice ||
      (composition?.status === 'complete' && !edit?.direction?.trim() && edit?.text === edit?.saved
        ? item?.questions.length
          ? 'Your draft and instructions are saved. Sky needs another detail to finish the reply.'
          : 'Revised draft saved.'
        : '')
  const approvalFeedback =
    item?.status === 'ready' && !item.stale
      ? `Draft saved in ${nativeApp}. ${followupsPending ? 'Preparing follow-up drafts…' : item.followupError ? 'Follow-up drafts need another try.' : item.followups?.length ? `Added ${item.followups.map((followup) => `a draft for ${followup.recipient}`).join(' and ')} to Outbox.` : 'Review and send it there.'}`
      : item && approving === item.id
        ? `Saving your draft in ${nativeApp}…`
        : ''
  useEffect(() => {
    if (error || approvalFeedback) actionFeedback.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [error, approvalFeedback])

  return (
    <div className="sky-main sky-outbox">
      <header className="sky-head">
        {selected && (
          <Button
            onClick={() => {
              setSelected(null)
              setEdit(null)
              navigate('/outbox')
            }}
          >
            ‹ All decisions
          </Button>
        )}
        <span className="sky-title" data-focused={Boolean(selected)}>
          Outbox
        </span>
        <span className="sky-spacer" />
        <Button leftSection={<Pen />} onClick={() => navigate('/settings/writing-voice')}>
          Your voice
        </Button>
        {selected && (
          <ActionIcon aria-label={details ? 'Hide details' : 'Show details'} onClick={() => setDetails(!details)}>
            {details ? '›' : '‹'}
          </ActionIcon>
        )}
      </header>
      <div className="sky-outbox-layout" data-reply-open={discussionOpen || undefined}>
        <div className="sky-scroll" ref={scroll}>
          <div className="sky-outbox-column">
            {connectionError && (
              <div className="sky-outbox-notice" role="status">
                Reconnecting to Sky…{checking || composing ? ' Your work continues in the background.' : ''}
              </div>
            )}
            {error && !item && (
              <div ref={actionFeedback} className="sky-outbox-notice" role="alert">
                {error}
              </div>
            )}
            {item && edit ? (
              <>
                <div className="sky-outbox-meta">
                  {item.conversation.medium} ·{' '}
                  {item.recipient ? `To ${item.recipient}` : item.conversation.sources.at(-1)?.from}
                </div>
                <h1>{item.title}</h1>
                <p className="sky-outbox-situation">{item.situation}</p>
                {item.followupOf && (
                  <div className="sky-outbox-followup-origin">
                    <span className="sky-outbox-meta">Follows your reply</span>
                    <Button onClick={() => void openRelated(item.followupOf!.id)}>{item.followupOf.title} ↗</Button>
                  </div>
                )}
                <WritingVoiceQuestions key={item.id} source={`outbox:${item.id}`} refreshKey={item.revision} />
                {item.stale && (
                  <div className="sky-outbox-notice">
                    New messages arrived. Your draft is preserved; read the updated conversation before approving.
                  </div>
                )}
                {conflicted && (
                  <div className="sky-outbox-notice">
                    This decision changed while you were editing. Your text is preserved.
                    <Button
                      onClick={() => {
                        const next = { ...edit, revision: item.revision }
                        setEdit(next)
                        edits.set(item.id, next)
                        setReviewedChanges(false)
                      }}
                    >
                      Review latest context with my text
                    </Button>
                  </div>
                )}
                {item.questions.length > 0 && (
                  <div className="sky-outbox-questions">
                    <h3>Your decision</h3>
                    <ul>
                      {item.questions.map((question) => (
                        <li key={question}>{question}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {item.recommendation && (
                  <div className="sky-outbox-recommendation">
                    <span className="sky-outbox-draft-label">Sky’s suggestion</span>
                    <p>{item.recommendation}</p>
                  </div>
                )}
                {item.conversation.limitations.map((limitation) => (
                  <p className="sky-outbox-meta" key={limitation}>
                    {limitation}
                  </p>
                ))}
                {item.writingDraft ? (
                  <>
                    <WritingDraftEditor
                      key={item.writingDraft.id}
                      draft={item.writingDraft}
                      disabled={busy || placing}
                      onEditingChange={setSharedEditing}
                      onAsk={editable ? askAboutDraft : undefined}
                      onChange={() => {}}
                      mutate={async (mutation) => {
                        const result = await request<{
                          item: OutboxRecord
                          draft: NonNullable<OutboxRecord['writingDraft']>
                        }>(`/item/${item.id}/draft`, 'POST', { itemRevision: item.revision, mutation })
                        receiveItem(result.item)
                        return result.draft
                      }}
                    />
                    {composing && (
                      <p className="sky-outbox-compose-feedback" role="status">
                        {revisionNotice}
                      </p>
                    )}
                    {revisionError && (
                      <div className="sky-outbox-notice" role="alert">
                        {revisionError}
                      </div>
                    )}
                  </>
                ) : (
                  <section className="sky-outbox-draft" aria-label="Reply editor" aria-busy={composing}>
                    <div className="sky-outbox-draft-label">
                      {editable
                        ? edit.text.trim()
                          ? 'Sky’s draft · yours to refine'
                          : 'Give Sky the direction'
                        : item.status === 'ready'
                          ? 'Ready in app'
                          : 'Approved reply'}
                    </div>
                    {editable && (edit.text.trim() || manualReply) ? (
                      <Textarea
                        label="Reply draft"
                        aria-label="Reply draft"
                        autosize
                        minRows={3}
                        value={edit.text}
                        onChange={(event) => change(event.currentTarget.value)}
                        disabled={busy}
                      />
                    ) : !editable ? (
                      <p className="sky-outbox-text">{item.draft}</p>
                    ) : (
                      <p className="sky-outbox-compose-hint">A few words are enough. Sky will write the reply.</p>
                    )}
                    {editable && (
                      <div className="sky-outbox-compose">
                        {Boolean(item.replyOptions?.length) && (
                          <div className="sky-outbox-reply-options" aria-label="Ways to reply">
                            {item.replyOptions!.map((option) => (
                              <Button
                                key={option.label}
                                disabled={busy || conflicted || (item.stale && !reviewedChanges)}
                                onClick={() => void compose(option.instruction)}
                              >
                                {option.label}
                              </Button>
                            ))}
                          </div>
                        )}
                        <Textarea
                          label="Instructions for Sky"
                          description={
                            edit.text.trim()
                              ? 'Tell Sky what to change. Revise with Sky saves your draft and instructions, then saves the revised reply above.'
                              : 'Describe what you want to say. Sky saves your instructions and writes the reply above.'
                          }
                          aria-label="Direction for Sky"
                          placeholder={
                            edit.text.trim()
                              ? 'What would you like to change?'
                              : 'Your decision, or the gist of what you want to say…'
                          }
                          value={edit.direction ?? ''}
                          onChange={(event) => changeDirection(event.currentTarget.value)}
                          autosize
                          minRows={2}
                          maxLength={4000}
                          disabled={busy}
                        />
                        <div className="sky-outbox-actions">
                          <Button
                            variant="primary"
                            loading={composing}
                            disabled={busy || conflicted || (item.stale && !reviewedChanges)}
                            onClick={() => void compose()}
                          >
                            {composing ? 'Sky is writing…' : edit.text.trim() ? 'Revise with Sky' : 'Draft reply'}
                          </Button>
                          {edit.text.trim() ? (
                            <>
                              <Button
                                disabled={busy || conflicted || (item.stale && !reviewedChanges)}
                                onClick={() =>
                                  void compose(
                                    'Make this reply shorter and more direct. Preserve its meaning and all necessary facts.',
                                  )
                                }
                              >
                                Shorter
                              </Button>
                              <Button
                                disabled={busy || conflicted || (item.stale && !reviewedChanges)}
                                onClick={() =>
                                  void compose(
                                    'Make this reply warmer while staying brief and direct. Preserve its meaning and do not add commitments.',
                                  )
                                }
                              >
                                Warmer
                              </Button>
                            </>
                          ) : (
                            !manualReply && (
                              <Button disabled={busy} onClick={() => setManualReply(true)}>
                                Write it myself
                              </Button>
                            )
                          )}
                        </div>
                        {revisionError && (
                          <div className="sky-outbox-notice" role="alert">
                            {composition?.status === 'failed' && (
                              <p>Your draft and instructions are saved. Sky could not finish the revision.</p>
                            )}
                            {revisionError}
                          </div>
                        )}
                        {!revisionError && revisionNotice && (
                          <p className="sky-outbox-compose-feedback" role="status">
                            {revisionNotice}
                          </p>
                        )}
                      </div>
                    )}
                  </section>
                )}
                {item.stale && (
                  <Checkbox
                    checked={reviewedChanges}
                    onChange={(event) => setReviewedChanges(event.currentTarget.checked)}
                    label="I’ve reviewed the changed context"
                  />
                )}
                {placing && (
                  <div className="sky-outbox-notice">
                    {item.status === 'placing'
                      ? 'Saving your approved draft. If this was interrupted, check the native app before creating another.'
                      : 'Draft placement could not be confirmed. Check the native app; Sky will not retry automatically.'}
                    {item.placementError && <p>{item.placementError}</p>}
                  </div>
                )}
                <div className="sky-outbox-actions">
                  {editable && (
                    <Button
                      variant="delivery"
                      loading={approving === item.id}
                      disabled={
                        busy ||
                        sharedEditing ||
                        !edit.text.trim() ||
                        conflicted ||
                        (item.stale && !reviewedChanges) ||
                        !item.conversation.target
                      }
                      onClick={() => void approve()}
                    >
                      {approving === item.id
                        ? `Saving in ${nativeApp}…`
                        : item.native
                          ? 'Approve update in app'
                          : `Approve draft in ${item.conversation.medium === 'Email' ? 'Gmail' : 'Slack'}`}
                    </Button>
                  )}
                  {item.status === 'needs_review' && !item.writingDraft && (
                    <Button disabled={busy || conflicted || edit.text === edit.saved} onClick={() => void save()}>
                      Save edit
                    </Button>
                  )}
                  {(item.native?.url || sourceLink(item)) && (
                    <Button component="a" href={item.native?.url ?? sourceLink(item)!} target="_blank" rel="noreferrer">
                      Open {item.conversation.medium === 'Email' ? 'Gmail' : 'Slack'} ↗
                    </Button>
                  )}
                  {!item.writingDraft && (
                    <Button
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(edit.text)
                          .catch(() => setError('Could not copy the reply. Select the text to copy it.'))
                      }
                    >
                      Copy reply
                    </Button>
                  )}
                  <Button disabled={busy || item.status === 'placing'} onClick={() => void dismiss()}>
                    {item.status === 'needs_review' ? 'Dismiss' : 'Archive'}
                  </Button>
                  {!item.delivery && !placing && Boolean(edit.text.trim()) && (
                    <Button
                      disabled={busy || sharedEditing || conflicted || edit.text !== edit.saved}
                      onClick={() => setSentReport(sentReport === null ? '' : null)}
                    >
                      Record that I sent it
                    </Button>
                  )}
                </div>
                {(error || approvalFeedback) && (
                  <div ref={actionFeedback} className="sky-outbox-notice" role={error ? 'alert' : 'status'}>
                    {error || approvalFeedback}
                  </div>
                )}
                {sentReport !== null && (
                  <section className="sky-outbox-draft">
                    <Textarea
                      label="Where and when did you send it?"
                      description="This records your report and removes the draft from review. It does not send a message."
                      value={sentReport}
                      onChange={(event) => setSentReport(event.currentTarget.value)}
                      autosize
                      minRows={2}
                    />
                    <Button
                      disabled={busy || !sentReport.trim()}
                      onClick={() =>
                        void act(async () => {
                          await request(`/item/${item.id}/sent`, 'POST', {
                            revision: item.revision,
                            evidence: sentReport,
                          })
                          edits.delete(item.id)
                          setSelected(null)
                          setEdit(null)
                          setSentReport(null)
                          setTab('review')
                        })
                      }
                    >
                      Save sent report
                    </Button>
                  </section>
                )}
                <p className="sky-outbox-meta">
                  {item.delivery
                    ? 'You recorded this message as sent.'
                    : !item.conversation.target
                      ? 'Copy this draft into the intended app. After sending it yourself, record the result here.'
                      : item.status === 'ready'
                        ? 'Your draft is waiting in the app. You review and press Send there.'
                        : 'Approve here to place this wording in the app. You press Send there.'}
                </p>
                {item.followupError && (
                  <div className="sky-outbox-notice" role="alert">
                    Your reply is saved. Sky could not finish its follow-up drafts.
                    <p>{item.followupError}</p>
                    <Button
                      disabled={busy || followupsPending}
                      onClick={() =>
                        void act(async () => {
                          const result = await request<OutboxRecord>(`/item/${item.id}/followups`, 'POST', {
                            revision: item.revision,
                          })
                          if (selectedRef.current === item.id)
                            setEdit({ text: result.draft, saved: result.draft, revision: result.revision })
                        })
                      }
                    >
                      Retry follow-up drafts
                    </Button>
                  </div>
                )}
                {Boolean(item.followups?.length) && !placing && (
                  <section className="sky-outbox-followups" aria-label="Follow-up messages">
                    <h3>Following through</h3>
                    <p className="sky-outbox-meta">Messages prepared from your approved reply.</p>
                    {item.followups!.map((followup) => (
                      <Button key={followup.id} onClick={() => void openRelated(followup.id)}>
                        Message to {followup.recipient} ↗
                      </Button>
                    ))}
                  </section>
                )}
                {!item.writingDraft && item.originalDraft && item.originalDraft !== edit.text && (
                  <details className="sky-outbox-original">
                    <summary>Sky’s original draft</summary>
                    <p className="sky-outbox-text">{item.originalDraft}</p>
                  </details>
                )}
              </>
            ) : (
              <>
                <div className="sky-outbox-intro">
                  <h1>A few decisions. The rest, handled.</h1>
                  <p>Replies prepared. Decisions made easier.</p>
                </div>
                {report?.automation && search && (
                  <section className="sky-outbox-search" aria-label="Search range">
                    <div className="sky-outbox-search-heading">
                      <strong>Search saved messages</strong>
                      <span>{report.modelLabel}</span>
                    </div>
                    <div className="sky-outbox-search-fields">
                      <TextInput
                        size="md"
                        type="datetime-local"
                        label="From"
                        value={search.value.start}
                        disabled={checking || busy}
                        onChange={(event) =>
                          setSearchEdit({ ...search, value: { ...search.value, start: event.currentTarget.value } })
                        }
                      />
                      <TextInput
                        size="md"
                        type="datetime-local"
                        label="Through"
                        value={search.value.end}
                        disabled={checking || busy}
                        onChange={(event) =>
                          setSearchEdit({ ...search, value: { ...search.value, end: event.currentTarget.value } })
                        }
                      />
                      <Button
                        variant="primary"
                        loading={checking}
                        disabled={!rangeValid || (busy && !checking)}
                        onClick={() => void checkNow()}
                      >
                        {checking ? 'Checking…' : 'Check now'}
                      </Button>
                      {report.today && (
                        <Button
                          disabled={checking || busy}
                          onClick={() => setSearchEdit({ ...search, value: dayRange(report.today!) })}
                        >
                          Today
                        </Button>
                      )}
                    </div>
                    {!rangeValid && (
                      <p role="alert">Choose valid dates and times, with the end on or after the start.</p>
                    )}
                    <p className="sky-outbox-meta">
                      Slack and email · Times as shown in your saved messages. Your range stays fixed after Check now;
                      later replies provide context.
                    </p>
                    {checkFeedback()}
                  </section>
                )}
                <div className="sky-outbox-tabs" role="tablist" aria-label="Outbox stages">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'review'}
                    onClick={() => {
                      setTab('review')
                      listPosition.current = 0
                    }}
                  >
                    Needs review <span>{reviewCount}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'ready'}
                    onClick={() => {
                      setTab('ready')
                      listPosition.current = 0
                    }}
                  >
                    Ready in apps <span>{readyCount}</span>
                  </button>
                </div>
                {report === null ? (
                  <p>Loading Outbox…</p>
                ) : !report.automation ? (
                  <div className="sky-outbox-empty">
                    <h2>Let Sky find what needs you.</h2>
                    <p>
                      Start with today’s saved Slack and email conversations. Sky will check new captures every five
                      minutes.
                    </p>
                    <Button
                      variant="delivery"
                      loading={busy}
                      onClick={() =>
                        void act(async () => {
                          await request('/setup', 'POST', {})
                        })
                      }
                    >
                      Enable Outbox
                    </Button>
                  </div>
                ) : items.length === 0 ? (
                  <div className="sky-outbox-empty">
                    <h2>
                      {tab === 'review'
                        ? checking
                          ? 'Checking your conversations…'
                          : 'No items awaiting review.'
                        : 'Approved drafts will appear here.'}
                    </h2>
                    <p>
                      {tab === 'review'
                        ? 'Choose a date and time range to find unanswered requests and decisions.'
                        : 'Review a reply in Outbox to place it in its native app.'}
                    </p>
                  </div>
                ) : (
                  <div className="sky-outbox-list">
                    {items.map((record) => (
                      <article className="sky-outbox-list-item" key={record.id}>
                        <button type="button" className="sky-outbox-row" onClick={() => open(record)}>
                          <span className="sky-outbox-avatar" aria-hidden="true">
                            {record.conversation.medium === 'Slack' ? '#' : '@'}
                          </span>
                          <span className="sky-outbox-row-content">
                            <span className="sky-outbox-meta">
                              {record.recipient ? `To ${record.recipient}` : record.conversation.sources.at(-1)?.from} ·{' '}
                              {record.conversation.medium}
                              <span
                                className="sky-outbox-stage"
                                data-drafted={Boolean(edits.get(record.id)?.text || record.draft)}
                              >
                                {record.stale
                                  ? 'Review new context'
                                  : record.status === 'ready'
                                    ? 'Ready in app'
                                    : edits.get(record.id)?.text || record.draft
                                      ? 'Draft ready'
                                      : 'Your decision'}
                              </span>
                            </span>
                            <strong>{record.title}</strong>
                            <span className="sky-outbox-situation">{record.situation}</span>
                            {record.recommendation && !record.draft && (
                              <span className="sky-outbox-row-suggestion">{record.recommendation}</span>
                            )}
                            <span className="sky-outbox-preview" data-ready={!needsReview(record)}>
                              {edits.get(record.id)?.text ||
                                record.draft ||
                                record.questions[0] ||
                                'Your decision is needed.'}
                            </span>
                          </span>
                          <span className="sky-outbox-arrow" aria-hidden="true">
                            ›
                          </span>
                        </button>
                        <div className="sky-outbox-row-footer">
                          <span className="sky-outbox-meta">
                            {record.stale
                              ? 'New messages · review again'
                              : record.status === 'ready'
                                ? 'Ready for you to send in the app'
                                : record.status === 'placement_unknown'
                                  ? 'Check draft placement in the app'
                                  : record.followupOf
                                    ? `Follows your reply: ${record.followupOf.title}`
                                    : `${record.conversation.sources.length} saved ${record.conversation.sources.length === 1 ? 'message' : 'messages'}`}
                          </span>
                          <Button
                            aria-label={`Dismiss ${record.title}`}
                            loading={dismissing === record.id}
                            disabled={busy || record.status === 'placing' || record.composition?.status === 'running'}
                            onClick={() => void dismissRecord(record)}
                          >
                            Dismiss
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                {report?.automation && (
                  <div className="sky-outbox-footer">
                    <p>
                      Saved Slack and email conversations ·{' '}
                      {report.automation.status === 'paused' ? 'Automatic checks paused' : 'Checks every 5 minutes'}
                      {report.lastScan ? ` · Last checked ${report.lastScan.at} UTC` : ''}
                    </p>
                    {!search && checkFeedback()}
                    <div className="sky-outbox-actions">
                      {!search && (
                        <Button loading={checking} disabled={busy && !checking} onClick={() => void checkNow()}>
                          {checking ? 'Checking…' : 'Check now'}
                        </Button>
                      )}
                      <Button onClick={() => navigate(`/automations/${report.automation!.name}`)}>
                        System automation
                      </Button>
                    </div>
                    {Boolean(progress?.checks.length) && (
                      <details className="sky-outbox-checks">
                        <summary>
                          What Sky checked · {progress!.range ? rangeLabel(progress!.range) : progress!.date}
                        </summary>
                        <ul>
                          {progress!.checks.map((check) => (
                            <li key={check.key}>
                              <strong>{check.title}</strong>
                              <div className="sky-outbox-meta">
                                {check.medium ?? 'Saved message'} ·{' '}
                                {check.disposition === 'answered'
                                  ? 'Already answered'
                                  : check.disposition === 'ignored'
                                    ? 'No reply needed'
                                    : check.disposition === 'failed'
                                      ? 'Could not check'
                                      : check.disposition === 'preserved'
                                        ? 'Existing review preserved'
                                        : 'Needs review'}
                                {check.model ? ` · ${check.model}` : ''}
                              </div>
                              <p>{check.reason}</p>
                              {check.limitations?.map((limitation) => (
                                <p key={limitation} className="sky-outbox-notice">
                                  {limitation}
                                </p>
                              ))}
                              {check.itemId && report.items.some((entry) => entry.id === check.itemId) && (
                                <Button onClick={() => open(report.items.find((entry) => entry.id === check.itemId)!)}>
                                  Open review
                                </Button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        {item && details && !discussionOpen && (
          <aside className="sky-outbox-details">
            <div className="sky-outbox-details-head">
              <ActionIcon aria-label="Hide details" onClick={() => setDetails(false)}>
                ›
              </ActionIcon>
              <strong>Details</strong>
            </div>
            <h3>Why this needs you</h3>
            <p>{item.reasoning}</p>
            <h3>Conversation</h3>
            {item.followupOf && (
              <section>
                <div className="sky-outbox-meta">Your approved reply · {item.followupOf.at.slice(0, 10)}</div>
                <p className="sky-outbox-text">{item.followupOf.reply}</p>
              </section>
            )}
            {item.conversation.sources.map((source) => (
              <section key={source.ref}>
                <div className="sky-outbox-meta">
                  {source.ref.slice(0, 10)} · {source.from}
                </div>
                <p className="sky-outbox-text">{source.body}</p>
              </section>
            ))}
          </aside>
        )}
        {discussion && item && (
          <ReplyThreadPanel
            key={discussion.id}
            thread={discussion}
            visible={discussionOpen}
            onClose={() => {
              setDiscussionOpen(false)
              void refresh()
            }}
          />
        )}
      </div>
    </div>
  )
}
