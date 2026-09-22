import { Button } from '@mantine/core'
import { useMemo } from 'react'
import type { RequestCitation } from '#lib/outbox/requestTypes.ts'
import type { OutboxRecord } from '#lib/outbox/types.ts'
import { conversationMessages } from './outboxMessages.ts'
import { outboxSender } from './outboxPresentation.ts'
import { askedLabel } from './outboxTime.ts'
import { RailToggle } from './railToggle.tsx'

/**
 * The rail beside an item: why it needs the person, the ask in the
 * asker's words, every request the conversation holds, the work it is
 * linked to, and Sky's questions about the person's voice.
 */

const OPEN = new Set(['open', 'uncertain'])

/** Brings a saved capture into view in the main column. */
function showSource(ref: string) {
  document.getElementById(`outbox-source-${ref}`)?.scrollIntoView({ block: 'start' })
}

export function OutboxRail({
  item,
  onToggle,
  navigate,
}: {
  item: OutboxRecord
  onToggle: () => void
  navigate: (path: string) => void
}) {
  const entries = useMemo(() => conversationMessages(item), [item])
  const selected = item.requestIds ?? []
  const requests = item.requests ?? []
  const asks = requests.filter(
    (request) =>
      request.present && OPEN.has(request.status) && (selected.length === 0 || selected.includes(request.id)),
  )
  const hasSource = (ref: string) => item.conversation.sources.some((source) => source.ref === ref)
  /** Who wrote the cited message: its author when the capture names one, else the capture's sender. */
  const authorOf = (citation: RequestCitation): string =>
    entries.flatMap((entry) => entry.messages).find((message) => message.id && message.id === citation.message)
      ?.author ?? outboxSender(item.conversation.sources.find((source) => source.ref === citation.ref))
  return (
    <aside className="sky-rail sky-outbox-rail" aria-label="Details">
      <div className="sky-rail-head">
        <RailToggle open onClick={onToggle} />
      </div>
      <section className="sky-rail-sec">
        <h3 className="sky-rail-sec-h">Why this needs you</h3>
        <p>{item.reasoning}</p>
      </section>
      {asks.length > 0 && (
        <section className="sky-rail-sec">
          <h3 className="sky-rail-sec-h">The ask</h3>
          {asks.map((request) => {
            const who = authorOf(request.origin)
            const at = request.origin.at ? askedLabel(request.origin.at) : ''
            return (
              <div className="sky-outbox-ask" key={request.id}>
                <blockquote className="sky-outbox-text">{request.origin.quote}</blockquote>
                <div className="sky-outbox-meta">{[who, at].filter(Boolean).join(' · ')}</div>
                {hasSource(request.origin.ref) && (
                  <Button variant="subtle" size="compact-sm" onClick={() => showSource(request.origin.ref)}>
                    View source message
                  </Button>
                )}
              </div>
            )
          })}
        </section>
      )}
      {requests.length > 0 && (
        <details className="sky-outbox-requests">
          <summary>Requests in this conversation · {requests.length}</summary>
          {requests.map((request) => (
            <section key={request.id}>
              <strong>{request.summary}</strong>
              <div className="sky-outbox-meta">
                {!request.present
                  ? 'No longer in saved messages'
                  : request.status === 'resolved'
                    ? 'Resolved'
                    : request.status === 'dismissed'
                      ? 'Archived'
                      : request.attention?.action === 'waiting'
                        ? 'Waiting on someone else'
                        : request.attention?.action === 'none'
                          ? 'No reply needed from you'
                          : selected.includes(request.id)
                            ? 'Included in this review'
                            : 'Outside this review'}
                {request.origin.at ? ` · ${request.origin.at}` : ''}
              </div>
              <blockquote className="sky-outbox-text">{request.origin.quote}</blockquote>
              <p>{request.attention?.explanation ?? request.explanation}</p>
              {request.resolution && (
                <>
                  <div className="sky-outbox-meta">
                    {request.resolution.kind === 'owner_report' ? 'Reply you reported sending' : 'Saved reply'}
                  </div>
                  <blockquote className="sky-outbox-text">{request.resolution.quote}</blockquote>
                </>
              )}
              {hasSource(request.origin.ref) && (
                <Button variant="subtle" size="compact-sm" onClick={() => showSource(request.origin.ref)}>
                  View source message
                </Button>
              )}
            </section>
          ))}
        </details>
      )}
      {Boolean(item.workstreams?.length) && (
        <section className="sky-rail-sec">
          <h3 className="sky-rail-sec-h">Linked work</h3>
          <div className="sky-outbox-pills">
            {item.workstreams!.map((link) => (
              <Button
                key={`${link.workstreamId}:${link.activityId ?? ''}`}
                size="compact-sm"
                variant="secondary"
                onClick={() =>
                  navigate(
                    `/workstreams/${encodeURIComponent(link.workstreamId)}${
                      link.activityId ? `?activity=${encodeURIComponent(link.activityId)}` : ''
                    }`,
                  )
                }
              >
                {link.title} ↗
              </Button>
            ))}
          </div>
          {item.workstreams!.map((link) => (
            <p className="sky-outbox-text" key={`${link.workstreamId}:${link.activityId ?? ''}:context`}>
              {link.context}
            </p>
          ))}
        </section>
      )}
    </aside>
  )
}
