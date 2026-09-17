import { useCallback, useEffect, useRef, useState } from 'react'
import { awaitingAttention } from '#lib/outbox/attentionQueue.ts'
import { replyDestination } from '#lib/outbox/replyDestination.ts'
import type { OutboxRecord } from '#lib/outbox/types.ts'
import type { OutboxReport } from '../../outbox/mod.ts'
import { type DraftEdits, type Edit, outboxRequest, savedEdit, useOutboxAction, useOutboxItem } from './outboxHooks.ts'
import { outboxApp, outboxBeeper } from './outboxPresentation.ts'
import type { OpenReplyThread } from './replyThreads.tsx'

/**
 * One item's editing state and every action on it: the working text and
 * direction, revisions with Sky, approval, dismissal, the sent report,
 * follow-ups, and the draft discussion. The page renders what this returns.
 */

export const DEFAULT_DIRECTION =
  'Prepare a concise, useful reply from the saved context. Ask only for a missing decision or fact that prevents completing it.'
export const SHORTER_DIRECTION =
  'Make this reply shorter and more direct. Preserve its meaning and all necessary facts.'
export const WARMER_DIRECTION =
  'Make this reply warmer while staying brief and direct. Preserve its meaning and do not add commitments.'

type ReportUpdate = (update: (current: OutboxReport | null) => OutboxReport | null) => void

export type OutboxEditorOptions = {
  id: string
  report: OutboxReport | null
  setReport: ReportUpdate
  edits: DraftEdits
  refresh: () => Promise<void>
  setConnectionError: (value: boolean) => void
  openDiscussion: (thread: OpenReplyThread) => void
  /** After a dismissal or a sent report the page turns back to the list. */
  onLeave: (reason: 'dismissed' | 'sent') => void
}

export function useOutboxItemEditor(options: OutboxEditorOptions) {
  const { id, report, setReport, edits, refresh, setConnectionError, openDiscussion, onLeave } = options
  const [edit, setEdit] = useState<Edit | null>(null)
  const [startingComposition, setComposing] = useState(false)
  const [composeError, setComposeError] = useState('')
  const [approving, setApproving] = useState<string | null>(null)
  const [manualReply, setManualReply] = useState(false)
  const [sharedEditing, setSharedEditing] = useState(false)
  const [draftNotice, setDraftNotice] = useState('')
  const [reviewedChanges, setReviewedChanges] = useState(false)
  const [sentReport, setSentReport] = useState<string | null>(null)
  const compositionInFlight = useRef(false)
  const submittedComposition = useRef<{
    id: string
    revision: string
    draft: string
    direction: string
    typedDirection?: string
  } | null>(null)
  const idRef = useRef(id)
  idRef.current = id
  // A fresh read of the open item. An unfinished edit stays; otherwise the record's own state is adopted.
  const adopt = useCallback(
    (record: OutboxRecord) => {
      const kept = edits.get(record.id)
      setEdit((current) => (kept ? (current ?? kept) : savedEdit(record)))
    },
    [edits],
  )
  const { item, error: itemError, loading, receiveItem } = useOutboxItem(id, report, setReport, adopt)
  const composition = item?.composition
  const composing =
    startingComposition || (composition?.status === 'running' && composition.revision === item?.revision)
  const action = useOutboxAction(refresh, composing)
  const { act, setError } = action
  const busy = action.busy || composing

  // Turning to another item starts its page clean.
  useEffect(() => {
    setEdit(null)
    setSharedEditing(false)
    setReviewedChanges(false)
    setSentReport(null)
    setManualReply(false)
    setDraftNotice('')
    setComposeError('')
    setError('')
  }, [id, setError])
  useEffect(() => {
    if (item && !edit) setEdit(edits.get(item.id) ?? savedEdit(item))
  }, [item, edit, edits])
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
      if (completed) edits.remove(item.id)
      else edits.set(item.id, next)
      return next
    })
  }, [item, edits])
  useEffect(() => {
    if (!item?.writingDraft) return
    setEdit((current) =>
      current?.direction?.trim()
        ? { ...current, text: item.draft, saved: item.draft, revision: item.revision }
        : savedEdit(item),
    )
  }, [item?.revision, item?.id])

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
  /** The conflict's way out: keep these words, read the latest context. */
  const reviewLatest = () => {
    if (!item || !edit) return
    const next = { ...edit, revision: item.revision }
    setEdit(next)
    edits.set(item.id, next)
    setReviewedChanges(false)
  }
  const save = () =>
    act(async () => {
      if (!item || !edit) return
      const result = await outboxRequest<OutboxRecord & { writingVoiceError?: string }>(
        `/item/${encodeURIComponent(item.id)}`,
        'PUT',
        { revision: edit.revision, draft: edit.text },
      )
      edits.remove(item.id)
      if (result.writingVoiceError) setError(result.writingVoiceError)
      if (idRef.current === item.id) setEdit({ text: result.draft, revision: result.revision, saved: result.draft })
    })
  const approve = () =>
    act(async () => {
      if (!item || !edit) return
      setApproving(item.id)
      try {
        const result = await outboxRequest<OutboxRecord & { writingVoiceError?: string }>(
          `/item/${encodeURIComponent(item.id)}/approve`,
          'POST',
          {
            revision: item.writingDraft ? item.revision : edit.revision,
            draft: item.writingDraft ? item.draft : edit.text,
            reviewedChanges,
          },
        )
        edits.remove(item.id)
        if (result.writingVoiceError) setError(result.writingVoiceError)
        if (idRef.current === item.id) setEdit({ text: result.draft, revision: result.revision, saved: result.draft })
      } finally {
        setApproving(null)
      }
    })
  const dismiss = () => {
    if (!item) return
    const revision = item.status === 'ready' && !item.stale ? item.revision : (edit?.revision ?? item.revision)
    return act(async () => {
      await outboxRequest(`/item/${encodeURIComponent(item.id)}/dismiss`, 'POST', { revision })
      edits.remove(item.id)
      setReport((current) =>
        current ? { ...current, items: current.items.filter((entry) => entry.id !== item.id) } : current,
      )
      if (idRef.current === item.id) onLeave('dismissed')
    })
  }
  const compose = async (instruction?: string) => {
    if (busy || compositionInFlight.current || !item || !edit) return
    compositionInFlight.current = true
    const itemId = item.id
    const direction = instruction ?? (edit.direction?.trim() || DEFAULT_DIRECTION)
    submittedComposition.current = {
      id: itemId,
      revision: edit.revision,
      draft: edit.text,
      direction,
      typedDirection: edit.direction,
    }
    setComposing(true)
    setComposeError('')
    setDraftNotice('')
    setError('')
    try {
      const result = await outboxRequest<OutboxRecord>(`/item/${encodeURIComponent(itemId)}/compose`, 'POST', {
        revision: edit.revision,
        draft: edit.text,
        instruction: direction,
        reviewedChanges,
      })
      submittedComposition.current = null
      const running = result.composition?.status === 'running'
      const unfinished = running || result.composition?.status === 'failed'
      const next = { ...savedEdit(result), direction: unfinished ? direction : undefined }
      if (unfinished) edits.set(itemId, next)
      else edits.remove(itemId)
      if (idRef.current === itemId) {
        setEdit(next)
        receiveItem(result)
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
        if (idRef.current === itemId)
          setComposeError(problem instanceof Error ? problem.message : 'Sky could not revise this draft.')
      }
      try {
        const latest = await outboxRequest<OutboxRecord>(`/item/${encodeURIComponent(itemId)}`)
        // The server may have saved the input before generation failed, or the
        // acknowledgement may have been lost after registering the worker.
        if (latest.draft === edit.text && latest.replyDirections?.at(-1)?.text === direction) {
          const next = { ...savedEdit(latest), direction }
          edits.set(itemId, next)
          if (idRef.current === itemId) {
            setEdit(next)
            receiveItem(latest)
            if (latest.composition?.status === 'running') setComposeError('')
          }
        }
      } catch {
        setConnectionError(true)
      }
    } finally {
      await refresh().catch(() => setConnectionError(true))
      setComposing(false)
      compositionInFlight.current = false
    }
  }
  const retryFollowups = () =>
    act(async () => {
      if (!item) return
      const result = await outboxRequest<OutboxRecord>(`/item/${encodeURIComponent(item.id)}/followups`, 'POST', {
        revision: item.revision,
      })
      if (idRef.current === item.id) setEdit({ text: result.draft, saved: result.draft, revision: result.revision })
    })
  const submitSentReport = () =>
    act(async () => {
      if (!item || sentReport === null) return
      await outboxRequest(`/item/${encodeURIComponent(item.id)}/sent`, 'POST', {
        revision: item.revision,
        evidence: sentReport,
      })
      edits.remove(item.id)
      setSentReport(null)
      if (idRef.current === item.id) onLeave('sent')
    })
  const askAboutDraft = () =>
    act(async () => {
      if (!item?.writingDraft) return
      const response = await fetch(`/chat/drafts/${encodeURIComponent(item.writingDraft.id)}/discuss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const result = (await response.json()) as { id?: string; message?: string }
      if (!response.ok || !result.id) throw new Error(result.message ?? 'Sky could not open the draft discussion.')
      openDiscussion({ id: result.id, point: { turn: 0, key: item.writingDraft.id }, draftId: item.writingDraft.id })
    })
  const mutateDraft = async (mutation: unknown) => {
    if (!item) throw new Error('This item is no longer open.')
    const result = await outboxRequest<{ item: OutboxRecord; draft: NonNullable<OutboxRecord['writingDraft']> }>(
      `/item/${encodeURIComponent(item.id)}/draft`,
      'POST',
      { itemRevision: item.revision, mutation },
    )
    receiveItem(result.item)
    return result.draft
  }
  /** Beeper has no link Sky can hand the browser; the service asks the desktop app to come forward. */
  const openApp = () =>
    act(async () => {
      if (!item) return
      await outboxRequest(`/item/${encodeURIComponent(item.id)}/open`, 'POST', {})
    })
  const copyReply = () => {
    if (!edit) return
    void navigator.clipboard
      .writeText(edit.text)
      .catch(() => setError('Could not copy the reply. Select the text to copy it.'))
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
  const editable = Boolean(item && (item.status === 'needs_review' || (item.stale && item.status === 'ready')))
  const awaiting = Boolean(item && awaitingAttention(item))
  const nativeApp = item ? outboxApp(item) : 'Slack'
  const followupsPending = Boolean(item && ['pending', 'preparing'].includes(item.followupStatus ?? ''))
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
  /** Compose, approve, and the reply options all wait on the same conditions. */
  const blocked = busy || conflicted || (Boolean(item?.stale) && !reviewedChanges) || Boolean(item?.contextError)
  const canApprove = Boolean(item && edit && !blocked && !sharedEditing && edit.text.trim() && replyDestination(item))

  return {
    item,
    itemError,
    loading,
    edit,
    busy,
    composing,
    approving: Boolean(item && approving === item.id),
    error: action.error,
    setError,
    conflicted,
    placing,
    editable,
    awaiting,
    nativeApp,
    followupsPending,
    revisionError,
    revisionNotice,
    approvalFeedback,
    blocked,
    canApprove,
    hasDestination: Boolean(item && replyDestination(item)),
    beeper: Boolean(item && outboxBeeper(item)),
    reviewedChanges,
    setReviewedChanges,
    manualReply,
    setManualReply,
    sharedEditing,
    setSharedEditing,
    sentReport,
    setSentReport,
    change,
    changeDirection,
    reviewLatest,
    save,
    approve,
    dismiss,
    openApp,
    compose,
    retryFollowups,
    submitSentReport,
    askAboutDraft,
    mutateDraft,
    copyReply,
  }
}

export type OutboxEditor = ReturnType<typeof useOutboxItemEditor>
