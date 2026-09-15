import { useMemo } from 'react'
import type { OutboxRecord } from '#lib/outbox/types.ts'
import { fileHref } from './explorer.tsx'
import { OutboxLink } from './outboxLink.tsx'
import { conversationMessages, isNewMessage } from './outboxMessages.ts'
import { OutboxText } from './outboxParts.tsx'
import { outboxApp, outboxSourceLink, outboxWho } from './outboxPresentation.ts'
import { askedLabel, dateLabel } from './outboxTime.ts'

/**
 * The conversation itself, under the reply: every saved capture in date
 * order, each message readable, each capture one step from its app and
 * from the saved file. A stale item marks the messages that came after
 * the reply was written.
 */

export function OutboxConversation({ item, open }: { item: OutboxRecord; open: (id: string) => void }) {
  const entries = useMemo(() => conversationMessages(item), [item])
  const total = entries.reduce((count, entry) => count + entry.messages.length, 0)
  const link = outboxSourceLink(item)
  const app = outboxApp(item)
  const fallbackAuthor = outboxWho(item)
  return (
    <section className="sky-outbox-conversation" id="outbox-conversation" aria-label="Conversation">
      <h2>
        Conversation · {total} saved {total === 1 ? 'message' : 'messages'}
      </h2>
      {item.followupOf && (
        <div className="sky-outbox-related">
          <span className="sky-outbox-meta">Follows your reply · {dateLabel(item.followupOf.at)} · </span>
          <OutboxLink id={item.followupOf.id} open={open}>
            {item.followupOf.title} ↗
          </OutboxLink>
          <blockquote className="sky-outbox-text">{item.followupOf.reply}</blockquote>
        </div>
      )}
      {entries.map(({ source, date, messages }) => (
        <section className="sky-outbox-source" key={source.ref} id={`outbox-source-${source.ref}`}>
          <div className="sky-outbox-source-head">
            <h3>{date ? dateLabel(date) : 'Saved capture'}</h3>
            {link && (
              <a href={link} target="_blank" rel="noreferrer">
                Open in {app} ↗
              </a>
            )}
            <a href={fileHref(source.ref)}>Saved file ↗</a>
          </div>
          {messages.map((message) => {
            const fresh = isNewMessage(item, message)
            const sameDay = message.at.slice(0, 10) === date
            return (
              <article
                className="sky-outbox-message"
                key={message.key}
                id={message.id ? `outbox-message-${message.id}` : undefined}
                data-new={fresh || undefined}
              >
                <div className="sky-outbox-message-head">
                  <strong>{message.author || fallbackAuthor}</strong>
                  {message.at && (
                    <span className="sky-outbox-meta">{sameDay ? message.at.slice(11) : askedLabel(message.at)}</span>
                  )}
                  {fresh && (
                    <span className="sky-outbox-token" data-tone="warn">
                      new
                    </span>
                  )}
                </div>
                <OutboxText className="sky-outbox-message-body" text={message.body} demoteHeadings />
              </article>
            )
          })}
          <details className="sky-outbox-capture">
            <summary>Full saved capture</summary>
            <p className="sky-outbox-text">{source.body}</p>
          </details>
        </section>
      ))}
    </section>
  )
}
