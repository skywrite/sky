import { Button } from '@mantine/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { OutboxRecord } from '#lib/outbox/types.ts'
import type { OutboxReport } from '../../outbox/mod.ts'
import { OutboxCheckFoot, OutboxCheckLine, useOutboxCheck } from './outboxCheck.tsx'
import { type DraftEdits, outboxRequest, readLocal, useOutboxAction, writeLocal } from './outboxHooks.ts'
import { OutboxLink } from './outboxLink.tsx'
import { Glyph } from './outboxParts.tsx'
import {
  outboxCardSummary,
  outboxGlyph,
  outboxHeading,
  outboxNeedsReview,
  outboxToken,
  outboxWhere,
  outboxWho,
} from './outboxPresentation.ts'
import { askedAt, dateLabel, doneAt, normalizeStamp, waitingLabel } from './outboxTime.ts'

/**
 * The list: what needs the person, what is ready in its app, what is
 * done. Longest waiting first, so the oldest ask is never buried.
 */

export type OutboxTab = 'review' | 'ready' | 'done' | 'unchecked'

const SORT_KEY = 'sky-outbox-sort'
const VISIT_KEY = 'sky-outbox-visit'

/** The newest moment an item asked for the person or appeared. */
function latestOf(record: OutboxRecord): string {
  return [askedAt(record), normalizeStamp(record.created)].sort().at(-1)!
}

export function OutboxList({
  report,
  tab,
  onTab,
  edits,
  open,
  refresh,
  setConnectionError,
  navigate,
}: {
  report: OutboxReport | null
  tab: OutboxTab
  onTab: (tab: OutboxTab) => void
  edits: DraftEdits
  /** Opens an item's page, keeping the list's place for the way back. */
  open: (id: string) => void
  refresh: () => Promise<void>
  setConnectionError: (value: boolean) => void
  navigate: (path: string) => void
}) {
  const action = useOutboxAction(refresh)
  const check = useOutboxCheck({ report, refresh, setConnectionError, busy: action.busy })
  const [newest, setNewest] = useState(() => readLocal(SORT_KEY) === 'newest')
  const [lastVisit] = useState(() => readLocal(VISIT_KEY) ?? '')
  const visitWritten = useRef(false)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const today = report?.today ?? ''
  const awaiting = report?.awaitingCheck ?? []
  const done = report?.done ?? []
  // The visit is dated by the newest thing on the list, not by a clock.
  useEffect(() => {
    if (!report || visitWritten.current) return
    visitWritten.current = true
    const latest = [...report.items, ...(report.awaitingCheck ?? [])].map(latestOf).sort().at(-1)
    if (latest) writeLocal(VISIT_KEY, latest)
  }, [report])
  useEffect(() => {
    if (tab === 'unchecked' && report && awaiting.length === 0) onTab('review')
  }, [tab, report, awaiting.length, onTab])
  const rows = useMemo(() => {
    if (tab === 'done') return done
    const source =
      tab === 'unchecked'
        ? awaiting
        : (report?.items.filter((record) => (tab === 'review') === outboxNeedsReview(record)) ?? [])
    return source
      .map((record, index) => ({ record, index, asked: askedAt(record) }))
      .sort((a, b) => (newest ? b.asked.localeCompare(a.asked) : a.asked.localeCompare(b.asked)) || a.index - b.index)
      .map((entry) => entry.record)
  }, [tab, report, awaiting, done, newest])
  const reviewCount = report?.items.filter(outboxNeedsReview).length ?? 0
  const readyCount = (report?.items.length ?? 0) - reviewCount
  const choose = (next: OutboxTab) => onTab(next)
  const toggleSort = () => {
    const next = !newest
    setNewest(next)
    writeLocal(SORT_KEY, next ? 'newest' : 'waiting')
  }
  const dismiss = (record: OutboxRecord) =>
    action.act(async () => {
      setDismissing(record.id)
      try {
        await outboxRequest(`/item/${encodeURIComponent(record.id)}/dismiss`, 'POST', { revision: record.revision })
        edits.remove(record.id)
      } finally {
        setDismissing(null)
      }
    })
  const tabButton = (value: OutboxTab, label: string, count: number) => (
    <button type="button" role="tab" aria-selected={tab === value} onClick={() => choose(value)}>
      {label} <span>{count}</span>
    </button>
  )
  // A background check can run for minutes; only this page's own action blocks a row.
  const busy = action.busy

  return (
    <div className="sky-outbox-list-page">
      <OutboxCheckLine check={check} />
      {action.error && (
        <div className="sky-outbox-notice" role="alert">
          {action.error}
        </div>
      )}
      <div className="sky-outbox-tabs-row">
        <div className="sky-outbox-tabs" role="tablist" aria-label="Outbox stages">
          {tabButton('review', 'Needs review', reviewCount)}
          {tabButton('ready', 'Ready', readyCount)}
          {tabButton('done', 'Done', done.length)}
          {awaiting.length > 0 && tabButton('unchecked', 'Awaiting check', awaiting.length)}
        </div>
        {tab !== 'done' && (
          <button type="button" className="sky-outbox-sort" title="Change the order" onClick={toggleSort}>
            {newest ? 'Newest first' : 'Longest waiting first'}
          </button>
        )}
      </div>
      {tab === 'unchecked' && (
        <p className="sky-outbox-pending-note">
          Earlier results waiting for their relevance check. These are not confirmed requests for you.
        </p>
      )}
      {report === null ? (
        <p className="sky-outbox-meta">Loading Outbox…</p>
      ) : !report.automation ? (
        <div className="sky-outbox-empty">
          <h2>Let Sky find what needs you.</h2>
          <p>Start with today’s saved Slack and email conversations. Sky will check new captures every five minutes.</p>
          <Button
            variant="primary"
            loading={action.busy}
            onClick={() =>
              void action.act(async () => {
                await outboxRequest('/setup', 'POST', {})
              })
            }
          >
            Enable Outbox
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="sky-outbox-empty">
          <h2>
            {tab === 'unchecked'
              ? 'No conversations waiting for a relevance check.'
              : tab === 'review'
                ? check.checking
                  ? 'Checking your conversations…'
                  : 'Nothing needs your review.'
                : tab === 'ready'
                  ? 'Approved drafts will appear here.'
                  : 'Nothing finished yet.'}
          </h2>
          <p>
            {tab === 'unchecked'
              ? 'Confirmed replies and decisions appear in Needs review.'
              : tab === 'review'
                ? 'Change the range to find unanswered requests and decisions.'
                : tab === 'ready'
                  ? 'Approve a reply here to place it in its app.'
                  : 'Sent, answered, and dismissed items collect here.'}
          </p>
        </div>
      ) : (
        <div className="sky-outbox-list">
          {rows.map((record) => {
            const heading = outboxHeading(record)
            const finished = tab === 'done'
            const token = outboxToken(record, { awaiting: tab === 'unchecked', unsavedDraft: edits.textOf(record.id) })
            const who = outboxWho(record)
            const where = outboxWhere(record)
            const place = who === where ? where : `${who} · ${where}`
            const fresh = !finished && Boolean(lastVisit) && latestOf(record) > lastVisit
            const facts = finished
              ? `${dateLabel(doneAt(record))} · ${place}`
              : `${place}${today ? ` · waiting ${waitingLabel(askedAt(record), today)}` : ''}`
            return (
              <article className="sky-outbox-row" key={record.id} data-new={fresh || undefined}>
                <Glyph kind={outboxGlyph(record)} />
                <div className="sky-outbox-row-body">
                  <div className="sky-outbox-facts">
                    {fresh && <span className="sky-outbox-new" title="New since your last visit" />}
                    <span className="sky-outbox-meta">{facts}</span>
                    <span className="sky-outbox-token" data-tone={token.tone}>
                      {token.label}
                    </span>
                    {!finished && (
                      <Button
                        className="sky-outbox-row-dismiss"
                        variant="primary-quiet"
                        size="compact-sm"
                        aria-label={`Dismiss ${heading}`}
                        loading={dismissing === record.id}
                        disabled={busy || record.status === 'placing' || record.composition?.status === 'running'}
                        onClick={() => void dismiss(record)}
                      >
                        Dismiss
                      </Button>
                    )}
                  </div>
                  <h2 className="sky-outbox-row-title">
                    <OutboxLink id={record.id} open={open} className="sky-outbox-row-link">
                      {heading}
                    </OutboxLink>
                  </h2>
                  {!finished && <p className="sky-outbox-card-summary">{outboxCardSummary(record)}</p>}
                </div>
              </article>
            )
          })}
        </div>
      )}
      <OutboxCheckFoot check={check} open={open} navigate={navigate} />
    </div>
  )
}
