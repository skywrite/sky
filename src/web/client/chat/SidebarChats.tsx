import type { ThreadSummary } from '../day/day.tsx'
import { SidebarIcon } from '../shell/sidebarIcon.tsx'
import { sidebarChatRows } from './sidebarRows.ts'
import './SidebarChats.css'

const MAX_BRANCH_DEPTH = 3

/**
 * The Chat primary navigation row and, while in Chat, the open live chats
 * nested beneath it (mirroring Today's date group). Outside Chat it stays a
 * single quiet row with no badge.
 */
export function SidebarChats({
  threads,
  activeThreadId,
  todayYmd,
  hrefOf,
  onNewChat,
}: {
  threads: ThreadSummary[]
  activeThreadId: string | null
  todayYmd: string | null
  hrefOf: (id: string) => string
  onNewChat: () => void
}) {
  if (activeThreadId === null) {
    return (
      <button type="button" className="sky-thread sky-side-primary" data-active={false} onClick={onNewChat}>
        <SidebarIcon name="chat" />
        <span>Chat</span>
      </button>
    )
  }

  const rows = sidebarChatRows(threads, todayYmd)
  const activeIsLive = rows.some((row) => row.id === activeThreadId)
  const onNewChatPage = !activeIsLive

  return (
    <>
      <div className="sky-side-chat-head">
        <button
          type="button"
          className="sky-thread sky-side-primary"
          data-active={onNewChatPage}
          data-section-active={!onNewChatPage || undefined}
          aria-current={onNewChatPage ? 'page' : undefined}
          onClick={onNewChat}
        >
          <SidebarIcon name="chat" />
          <span>Chat</span>
        </button>
        {!onNewChatPage && (
          <button
            type="button"
            className="sky-side-chat-add"
            aria-label="New chat"
            title="New chat"
            onClick={onNewChat}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
        )}
      </div>
      <div className="sky-side-chats" aria-label="Live chats">
        <div className="sky-side-label">
          <span>Live chats</span>
          {rows.length > 0 && <span className="sky-side-chats-count">{rows.length}</span>}
        </div>
        {rows.length === 0 ? (
          <p className="sky-side-chat-empty">No live chats yet.</p>
        ) : (
          rows.map((row) => {
            const active = row.id === activeThreadId
            return (
              <a
                key={row.id}
                href={hrefOf(row.id)}
                className="sky-thread sky-side-chat"
                data-active={active}
                data-branch={row.depth > 0 || undefined}
                aria-current={active ? 'page' : undefined}
                title={row.tooltip}
                style={
                  row.depth > 0 ? { paddingInlineStart: 8 + Math.min(row.depth, MAX_BRANCH_DEPTH) * 14 } : undefined
                }
              >
                <span className="sky-side-chat-row">
                  <span
                    className="sky-side-chat-dot"
                    data-state={row.dotTone}
                    data-temp={row.temporary || undefined}
                    aria-hidden="true"
                  />
                  <span className="sky-side-chat-title">{row.title}</span>
                </span>
                {row.statusLabel && (
                  <span className="sky-side-chat-sub" data-state={row.statusTone ?? undefined}>
                    {row.statusLabel}
                  </span>
                )}
              </a>
            )
          })
        )}
      </div>
    </>
  )
}
