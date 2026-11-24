import { UnstyledButton } from '@mantine/core'
import { useEffect, useState } from 'react'
import type { NeedsResponseItem } from '#lib/needsResponse/types.ts'
import { fileHref } from '../explorer/explorer.tsx'
import { Block, Cross } from './day.tsx'
import { ServiceLogo } from './ServiceLogo.tsx'
import { revealOpacity, useSwipeToDelete } from './swipe.ts'
import { type NeedsResponseDismissKind, useNeedsResponse } from './useNeedsResponse.ts'
import './NeedsResponseCard.css'

function formatWaitingAge(ageHours: number): string {
  if (ageHours < 1) return `${Math.max(1, Math.round(ageHours * 60))}m`
  if (ageHours < 24) return `${Math.round(ageHours)}h`
  return `${Math.round(ageHours / 24)}d`
}

function compactContextLabel(label: string | undefined): string | undefined {
  if (!label) return undefined
  const trimmed = label.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('#')) return trimmed
  const parts = trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length > 2) return `Group (${parts.length})`
  return trimmed
}

function TickIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M2 6.5l2.5 2.5L10 3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function NeedsResponseRow({
  item,
  removing,
  onClear,
  onOpenInApp,
}: {
  item: NeedsResponseItem
  removing: boolean
  onClear: (item: NeedsResponseItem, how: NeedsResponseDismissKind) => void
  onOpenInApp: (item: NeedsResponseItem) => void
}) {
  const swipe = useSwipeToDelete(() => onClear(item, 'dismissed'))
  useEffect(() => {
    if (removing) swipe.close()
  }, [removing])

  const contextLabel = compactContextLabel(item.contextLabel)
  const content = (
    <>
      <span className="sky-nr-sender">{item.sender}</span>
      {contextLabel && <span className="sky-nr-context">{contextLabel}</span>}
      {item.summary && <span className="sky-nr-summary">{item.summary}</span>}
    </>
  )

  return (
    <div className="sky-prow sky-irow sky-nr-row" data-phase={removing ? 'removed' : undefined} ref={swipe.ref}>
      {swipe.offset < 0 && (
        <div className="sky-irow-back" style={{ width: -swipe.offset }}>
          <button
            type="button"
            className="sky-irow-delete"
            style={{ opacity: revealOpacity(swipe.offset) }}
            tabIndex={swipe.open ? 0 : -1}
            onClick={swipe.commit}
          >
            Dismiss
          </button>
        </div>
      )}
      <div
        className="sky-irow-front"
        data-dragging={swipe.dragging || undefined}
        style={swipe.offset ? { transform: `translateX(${swipe.offset}px)` } : undefined}
        onClickCapture={(event) => {
          if (!swipe.open) return
          event.preventDefault()
          event.stopPropagation()
          swipe.close()
        }}
        {...(removing ? {} : swipe.handlers)}
      >
        <button
          type="button"
          className="sky-check"
          aria-label={`Mark ${item.sender} responded`}
          aria-pressed={removing}
          disabled={removing}
          onClick={() => onClear(item, 'responded')}
        >
          <span className="sky-check-box" data-on={removing}>
            {removing && <TickIcon />}
          </span>
        </button>
        <ServiceLogo service={item.source} />
        {item.href ? (
          <a className="sky-ptext sky-nr-link" href={item.href} target="_blank" rel="noopener noreferrer">
            {content}
          </a>
        ) : item.openInApp === 'beeper' ? (
          <button type="button" className="sky-ptext sky-nr-link" onClick={() => onOpenInApp(item)}>
            {content}
          </button>
        ) : item.savedPath ? (
          <a className="sky-ptext sky-nr-link" href={fileHref(item.savedPath)}>
            {content}
          </a>
        ) : (
          <span className="sky-ptext sky-nr-link">{content}</span>
        )}
        <button
          type="button"
          className="sky-x"
          aria-label={`Dismiss ${item.sender}`}
          title="Dismiss"
          disabled={removing}
          onClick={() => onClear(item, 'dismissed')}
        >
          <Cross />
        </button>
        <span className="sky-nr-age">{formatWaitingAge(item.ageHours)}</span>
      </div>
    </div>
  )
}

/** Today's cross-app queue of messages awaiting a reply, ordered by age waiting + person score. */
export function NeedsResponseCard({ enabled }: { enabled: boolean }) {
  const { items, removing, undo, openError, clearItem, revertUndo, openInApp } = useNeedsResponse(enabled)
  const [showAll, setShowAll] = useState(false)

  if (!enabled || (items.length === 0 && !undo)) return null

  const visible = showAll ? items : items.slice(0, 5)
  const mini = items.length > 0 ? `${items.length > 5 && !showAll ? 'Top 5 · ' : ''}${items.length} waiting` : undefined

  return (
    <>
      {items.length > 0 && (
        <Block head="Needs response" mini={mini} className="sky-needs-response">
          {openError && (
            <p className="sky-nr-error" role="alert">
              {openError}
            </p>
          )}
          <div className="sky-nr-list">
            {visible.map((item) => (
              <NeedsResponseRow
                key={item.id}
                item={item}
                removing={Boolean(removing[item.id])}
                onClear={clearItem}
                onOpenInApp={openInApp}
              />
            ))}
          </div>
          {items.length > 5 && (
            <UnstyledButton
              className="sky-todos-disclosure"
              aria-expanded={showAll}
              onClick={() => setShowAll(!showAll)}
            >
              <span aria-hidden="true">{showAll ? '⌄' : '›'}</span>
              {showAll ? 'Show top 5' : `Show ${items.length - 5} more`}
            </UnstyledButton>
          )}
        </Block>
      )}
      {undo && (
        <div className="sky-undo" key={undo.key}>
          <span className="sky-undo-tick" data-how={undo.how === 'dismissed' ? 'deleted' : 'cleared'}>
            {undo.how === 'dismissed' ? <Cross /> : <TickIcon />}
          </span>
          <span className="sky-undo-text">
            {undo.how === 'dismissed' ? 'Dismissed' : 'Responded'} — {undo.sender}
          </span>
          <button type="button" className="sky-undo-btn" onClick={revertUndo}>
            Undo
          </button>
          <span className="sky-undo-track">
            <span className="sky-undo-fill" />
          </span>
        </div>
      )}
    </>
  )
}
