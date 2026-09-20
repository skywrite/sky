import { ActionIcon, Button, Menu } from '@mantine/core'
import { useEffect, useState } from 'react'
import { splitChatFiles } from '#universal/ai/chatFiles.ts'
import type { BranchPoint } from '../../chat/branchPoint.ts'
import type { UnwindBlocker } from '../../chat/unwind.ts'
import type { BranchMark, Chat } from './chat.tsx'
import { useChatDraft } from './chatDraft.ts'
import type { ReplyThreadSummary } from './replyThreads.tsx'

/**
 * Delete from here, on the page: a question's own menu, the confirm that
 * opens under it, and the refusal when a delete cannot happen.
 *
 * A delete keeps the thread through a reply the service issued a reference
 * for, and removes all that follows. So the part that goes starts right
 * after the last such reply before the chosen question — drawn faint while
 * the confirm is open, since that is exactly what the service will remove.
 */

/** What stands under a question: the confirm, or why the delete cannot happen. */
export type UnwindNoteState =
  | { kind: 'confirm'; questions: number; replies: number; done: string[]; busy: boolean }
  | { kind: 'refused'; message: string; blockedBy?: UnwindBlocker[] }

export interface Unwinding {
  /** The question at this index offers the delete. */
  offers: (index: number) => boolean
  ask: (index: number) => void
  /** The index of the question the note stands under; null when none is open */
  at: number | null
  /** The first index that goes while the confirm is open; null otherwise */
  from: number | null
  note: UnwindNoteState | null
  confirm: () => void
  cancel: () => void
  /** The delete just happened and nothing was sent since: the transcript says so. */
  deleted: boolean
}

const REFUSED_TAIL = 'Discard it first, or delete from a later question.'

/** The last reply before `index` the service can keep the thread through; null keeps nothing. */
function keptBefore(turns: Chat['state']['turns'], index: number): { point: BranchPoint | null; from: number } {
  for (let i = index - 1; i >= 0; i--) {
    const point = turns[i]?.branchPoint
    if (point) return { point, from: i + 1 }
  }
  return { point: null, from: 0 }
}

export function useUnwind(chat: Chat, branches: BranchMark[], replyThreads: ReplyThreadSummary[]): Unwinding {
  const { state, unwind } = chat
  const draft = useChatDraft(state.id)
  const [at, setAt] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<{ message: string; blockedBy?: UnwindBlocker[] } | null>(null)
  const [deleted, setDeleted] = useState<number | null>(null)
  const idle = state.phase === 'idle'

  // Another thread, a turn under way, or a transcript that moved on closes what was open.
  useEffect(() => {
    setAt(null)
    setRefusal(null)
    setDeleted(null)
  }, [state.id])
  useEffect(() => {
    if (!idle) {
      setAt(null)
      setRefusal(null)
    }
  }, [idle])
  useEffect(() => {
    if (deleted !== null && state.turns.length !== deleted) setDeleted(null)
  }, [deleted, state.turns.length])
  // Escape answers no from anywhere on the page: the closing menu hands the
  // focus back to its button, so the note itself never holds it.
  useEffect(() => {
    if (at === null || busy) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setAt(null)
      setRefusal(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [at, busy])

  const offers = (index: number) =>
    idle && !busy && state.turns[index]?.role === 'user' && keptBefore(state.turns, index).from >= state.fixed

  const ask = (index: number) => {
    if (!offers(index)) return
    const { point } = keptBefore(state.turns, index)
    const keptTurn = point?.turn ?? 0
    const open: UnwindBlocker[] = [
      ...branches
        .filter((mark) => mark.id !== null && mark.turn > keptTurn)
        .map((mark) => ({ id: mark.id!, title: mark.title, kind: 'branch' as const })),
      ...replyThreads
        .filter((thread) => thread.id !== null && thread.turn > keptTurn)
        .map((thread) => ({ id: thread.id!, title: thread.title, kind: 'thread' as const })),
    ]
    setAt(index)
    setRefusal(open.length === 0 ? null : { message: '', blockedBy: open })
  }

  const cancel = () => {
    if (busy) return
    setAt(null)
    setRefusal(null)
  }

  const confirm = () => {
    if (at === null || busy || refusal) return
    const index = at
    const { point } = keptBefore(state.turns, index)
    const question = splitChatFiles(state.turns[index]?.content ?? '').text.trim()
    setBusy(true)
    void unwind(point)
      .then((result) => {
        if ('message' in result) {
          setRefusal(result)
          return
        }
        // Never over what is already typed: the question joins it.
        if (question) draft.setText(draft.text.trim() ? `${draft.text.trimEnd()}\n\n${question}` : question)
        setAt(null)
        setDeleted(result.turns)
        window.dispatchEvent(new CustomEvent('sky-draft-focus', { detail: state.id }))
      })
      .finally(() => setBusy(false))
  }

  const from = at !== null && !refusal ? keptBefore(state.turns, at).from : null
  const going = from === null ? [] : state.turns.slice(from)
  const note: UnwindNoteState | null =
    at === null
      ? null
      : refusal
        ? { kind: 'refused', ...refusal }
        : {
            kind: 'confirm',
            questions: going.filter((turn) => turn.role === 'user').length,
            replies: going.filter((turn) => turn.role === 'assistant').length,
            // A call the person approved has happened in the world; the delete takes only its record.
            done: state.answered
              .filter((card) => card.approved && card.at >= from!)
              .map((card) => card.lines[0] ?? card.toolName),
            busy,
          }
  return { offers, ask, at, from, note, confirm, cancel, deleted: deleted !== null && deleted === state.turns.length }
}

/** A question's own menu: the same "⋯" a reply has, at the foot of the bubble so it opens below the words. */
export function QuestionMenu({ onDelete }: { onDelete: () => void }) {
  return (
    <Menu position="bottom-start" withinPortal shadow="md">
      <Menu.Target>
        <ActionIcon variant="subtle" aria-label="Message options" className="sky-question-more">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="19" cy="12" r="1.7" />
          </svg>
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item className="sky-menu-danger" onClick={onDelete}>
          Delete from here…
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function UnwindNote({
  note,
  onConfirm,
  onCancel,
}: {
  note: UnwindNoteState
  onConfirm: () => void
  onCancel: () => void
}) {
  if (note.kind === 'refused') {
    const first = note.blockedBy?.[0]
    const more = (note.blockedBy?.length ?? 0) - 1
    return (
      <div className="sky-unwind-note" role="alert">
        <div className="sky-unwind-title">Can’t delete from here yet.</div>
        {first ? (
          <>
            <div className="sky-unwind-line">
              {first.kind === 'thread'
                ? 'A reply thread after this point is still open: '
                : 'A branch left after this point and is still open: '}
              <a href={`/thread/${first.id}`}>
                {first.title ?? (first.kind === 'thread' ? 'a reply thread' : 'a branch')}
              </a>
              {more > 0 ? ` (and ${more} more)` : ''}.
            </div>
            <div className="sky-unwind-line">{REFUSED_TAIL}</div>
          </>
        ) : (
          <div className="sky-unwind-line">{note.message}</div>
        )}
        <div className="sky-unwind-acts">
          <Button size="compact-sm" variant="secondary" onClick={onCancel}>
            OK
          </Button>
        </div>
      </div>
    )
  }
  const parts = [
    note.questions > 0 ? count(note.questions, 'question', 'questions') : null,
    note.replies > 0 ? count(note.replies, 'reply', 'replies') : null,
  ].filter(Boolean)
  const shown = note.done.slice(0, 3)
  return (
    <div className="sky-unwind-note" role="group" aria-label="Delete from here" aria-live="polite">
      <div className="sky-unwind-title">Delete this question and everything after it?</div>
      <div className="sky-unwind-line">
        {parts.join(' and ')} {note.questions + note.replies === 1 ? 'goes' : 'go'}. Your question comes back into the
        box.
      </div>
      {shown.map((line, i) => (
        <div key={i} className="sky-unwind-line" data-tone="done">
          Already done, and it stays done: {line}
        </div>
      ))}
      {note.done.length > shown.length && (
        <div className="sky-unwind-line" data-tone="done">
          …and {count(note.done.length - shown.length, 'more thing', 'more things')} Sky already did.
        </div>
      )}
      <div className="sky-unwind-acts">
        <Button size="compact-sm" variant="danger" loading={note.busy} onClick={onConfirm}>
          Delete
        </Button>
        <Button size="compact-sm" variant="secondary" disabled={note.busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
