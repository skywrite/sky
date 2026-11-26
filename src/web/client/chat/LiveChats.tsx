import type { MouseEvent } from 'react'
import type { SidebarChatRow } from './sidebarRows.ts'
import './LiveChats.css'

const MAX_BRANCH_DEPTH = 3

/**
 * A phone's Chat page lists the live chats the sidebar nests under Chat, above the
 * message box that starts a new one. Branches sit under their live parent. A row turns
 * the page itself: links inside a chat otherwise open in a new tab.
 */
export function LiveChats({
  rows,
  hrefOf,
  navigate,
}: {
  rows: SidebarChatRow[]
  hrefOf: (id: string) => string
  navigate: (to: string) => void
}) {
  return (
    <div className="sky-col sky-live-chats">
      <section aria-label="Live chats">
        <h2 className="sky-list-heading">Live chats</h2>
        <div className="sky-list">
          {rows.map((row) => (
            <a
              key={row.id}
              href={hrefOf(row.id)}
              className="sky-list-row sky-live-chat"
              title={row.tooltip}
              onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                event.preventDefault()
                navigate(hrefOf(row.id))
              }}
              style={
                row.depth > 0 ? { paddingInlineStart: 16 + Math.min(row.depth, MAX_BRANCH_DEPTH) * 14 } : undefined
              }
            >
              <span
                className="sky-side-chat-dot"
                data-state={row.dotTone}
                data-temp={row.temporary || undefined}
                aria-hidden="true"
              />
              <span className="sky-list-label">
                <span className="sky-live-chat-title">{row.title}</span>
                {row.statusLabel && (
                  <span className="sky-live-chat-state" data-state={row.statusTone ?? undefined}>
                    {row.statusLabel}
                  </span>
                )}
              </span>
            </a>
          ))}
        </div>
      </section>
    </div>
  )
}
