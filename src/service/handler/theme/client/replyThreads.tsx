import { ActionIcon, Button } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { formatTokens, totalInput } from '#universal/ai/tokenUsage.ts'
import type { BranchPoint } from '../../chat/branchPoint.ts'
import type { ReplyThreadSummary } from '../../chat/replyThreads.ts'
import { Composer, ThreadColumn, useChat, useFollow } from './chat.tsx'
import { useChatDraft } from './chatDraft.ts'
import { Paperclip, useChatFiles } from './chatFiles.tsx'

export type { ReplyThreadSummary }

export function ThreadIcon() {
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
      <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-4 3V11.5A7.5 7.5 0 0 1 8.5 4H12" strokeLinejoin="round" />
      <path d="M15 4h7m-3.5-3.5v7" strokeLinecap="round" />
    </svg>
  )
}

export function useReplyThreads(id: string, enabled: boolean, version: number) {
  const [threads, setThreads] = useState<ReplyThreadSummary[]>([])
  useEffect(() => {
    setThreads([])
  }, [id, enabled])
  useEffect(() => {
    if (!enabled || !id) return
    let alive = true
    let pending = false
    const read = async () => {
      if (pending) return
      pending = true
      try {
        const response = await fetch(`/chat/${id}/replies`)
        if (!response.ok || !alive) return
        const body = (await response.json()) as { threads?: ReplyThreadSummary[] }
        if (alive)
          setThreads((prior) =>
            JSON.stringify(prior) === JSON.stringify(body.threads ?? []) ? prior : (body.threads ?? []),
          )
      } catch {
        // A restart leaves the last known thread links available until the next refresh.
      } finally {
        pending = false
      }
    }
    void read()
    const timer = setInterval(() => void read(), 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [id, enabled, version])
  return threads
}

export interface OpenReplyThread {
  id: string
  point: BranchPoint
  draftId?: string
}

export function ReplyThreadPanel({
  thread,
  visible,
  onClose,
}: {
  key?: string
  thread: OpenReplyThread
  visible: boolean
  onClose: () => void
}) {
  const chat = useChat(thread.id)
  const { state } = chat
  const scroll = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const busy = state.phase !== 'idle'
  const draft = useChatDraft(state.id)
  const files = useChatFiles(state.id, busy, draft)
  const replies = state.turns.slice(state.inherited).filter((turn) => turn.role === 'assistant').length
  useFollow(scroll, [state.turns, state.runs, state.gather], visible)
  useEffect(() => {
    if (!visible || !state.loaded) return
    panel.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }, [visible, state.loaded, thread.draftId])
  useEffect(() => {
    if (!visible) return
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[role="dialog"]')) {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [visible, onClose])

  return (
    <aside className="sky-reply-panel" aria-label="Thread" hidden={!visible} ref={panel}>
      <header className="sky-reply-panel-head">
        <div>
          <h2>{thread.draftId ? 'Draft discussion' : 'Thread'}</h2>
          <span>
            {busy
              ? state.approvals.length
                ? 'Needs your input'
                : 'Sky is working'
              : `${replies} ${replies === 1 ? 'reply' : 'replies'}`}
          </span>
        </div>
        <ActionIcon aria-label="Close thread" title="Close thread" onClick={onClose}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </ActionIcon>
      </header>
      <div className="sky-reply-panel-content sky-chat-drop-target" {...files.drop}>
        {files.dragging && (
          <div className="sky-chat-drop" role="status">
            <Paperclip />
            <span>Drop files into this thread</span>
          </div>
        )}
        <div className="sky-reply-panel-scroll" ref={scroll}>
          {!state.loaded ? (
            <p className="sky-reply-empty" role="status">
              Opening thread…
            </p>
          ) : (
            <ThreadColumn chat={chat} replyMode />
          )}
          {state.loaded && state.turns.length === state.inherited && (
            <p className="sky-reply-empty">
              {thread.draftId
                ? 'Describe what to change. Sky will update the same draft in chat.'
                : 'Ask a follow-up or work on the next step. Sky has the conversation leading up to this response.'}
            </p>
          )}
        </div>
        <Composer
          chat={chat}
          draft={draft}
          placeholder={thread.draftId ? 'Ask Sky to revise this draft…' : 'Reply in thread…'}
          hints={
            <span className="sky-hint">
              {thread.draftId ? 'Revisions update the draft in chat' : 'Replies stay in this thread'}
            </span>
          }
          attach={files.attach}
          autoFocus={visible}
          showSaves={false}
          status={
            files.error && (
              <p className="sky-chat-file-error" role="alert">
                {files.error}
              </p>
            )
          }
        />
      </div>
    </aside>
  )
}

export function ReplyThreadLink({
  thread,
  active,
  onOpen,
}: {
  thread?: ReplyThreadSummary
  active: boolean
  onOpen: () => void
}) {
  const status = thread?.busy ? (thread.state === 'waiting' ? 'Needs your input' : 'Working…') : null
  const replies = thread?.replies ?? 0
  const usage = thread?.statistics?.usage
  const stats = usage
    ? `${formatTokens(totalInput(usage))} input tokens · ${formatTokens(usage.output)} output tokens`
    : undefined
  return (
    <Button
      size="compact-sm"
      variant="primary-quiet"
      className="sky-reply-action sky-reply-thread-link"
      leftSection={<ThreadIcon />}
      onClick={onOpen}
      aria-expanded={active}
      data-has-replies={replies > 0 || undefined}
      title={stats}
    >
      {replies > 0 ? `${replies} ${replies === 1 ? 'reply' : 'replies'}` : 'Reply in thread'}
      {status && <span className="sky-reply-thread-status">{status}</span>}
    </Button>
  )
}
