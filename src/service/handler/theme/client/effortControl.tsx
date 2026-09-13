import { useRef, useState, type CSSProperties, type Key } from 'react'
import { effortLabel, type Effort } from '#universal/ai/effort.ts'
import './aiControls.css'

/** The same click, drag, and keyboard control in chat and preset settings. */
export function EffortControl({
  value,
  levels,
  onChange,
  label = 'Effort',
  disabled = false,
  inherited = value === null,
  resetLabel = 'Use model default',
}: {
  value: Effort | null
  key?: Key | null
  levels: readonly Effort[]
  onChange: (value: Effort | null) => void | Promise<void>
  label?: string
  disabled?: boolean
  inherited?: boolean
  resetLabel?: string
}) {
  const [draft, setDraft] = useState<Effort | null>(null)
  const [pending, setPending] = useState(false)
  const pointer = useRef<number | null>(null)
  const latest = useRef<Effort | null>(null)
  const selected = draft ?? value
  const at = levels.indexOf(selected as Effort)
  const locked = disabled || pending
  const commit = async (next: Effort | null) => {
    setPending(true)
    setDraft(next)
    try {
      await onChange(next)
    } finally {
      setPending(false)
      setDraft(null)
    }
  }
  if (levels.length < 2)
    return (
      <div className="sky-effort-control">
        <span className="sky-effort-fixed" title="This model does not offer adjustable effort">
          {selected ? effortLabel(selected) : 'Model default'}
        </span>
        {!inherited && (
          <button type="button" className="sky-effort-reset" disabled={locked} onClick={() => void commit(null)}>
            {resetLabel}
          </button>
        )}
      </div>
    )
  return (
    <div className="sky-effort-control">
      <div
        className="sky-effort-strip"
        role="radiogroup"
        aria-label={label}
        aria-disabled={locked}
        data-selected={at >= 0}
        data-dragging={(draft !== null && !pending) || undefined}
        style={{ '--effort-count': levels.length, '--effort-position': Math.max(0, at) } as CSSProperties}
        onPointerDown={(event) => {
          if (locked || event.button !== 0) return
          pointer.current = event.pointerId
          event.currentTarget.setPointerCapture(event.pointerId)
          const box = event.currentTarget.getBoundingClientRect()
          latest.current =
            levels[
              Math.max(
                0,
                Math.min(
                  levels.length - 1,
                  Math.floor((event.clientX - box.left - 4) / ((box.width - 8) / levels.length)),
                ),
              )
            ]
          setDraft(latest.current)
        }}
        onPointerMove={(event) => {
          if (pointer.current !== event.pointerId) return
          const box = event.currentTarget.getBoundingClientRect()
          latest.current =
            levels[
              Math.max(
                0,
                Math.min(
                  levels.length - 1,
                  Math.floor((event.clientX - box.left - 4) / ((box.width - 8) / levels.length)),
                ),
              )
            ]
          setDraft(latest.current)
        }}
        onPointerUp={(event) => {
          if (pointer.current !== event.pointerId) return
          pointer.current = null
          if (latest.current !== null) void commit(latest.current)
        }}
        onPointerCancel={() => {
          pointer.current = null
          setDraft(null)
        }}
        onLostPointerCapture={() => {
          if (pointer.current !== null) {
            pointer.current = null
            setDraft(null)
          }
        }}
        onKeyDown={(event) => {
          if (locked) return
          let next = at
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next++
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next--
          else if (event.key === 'Home') next = 0
          else if (event.key === 'End') next = levels.length - 1
          else return
          event.preventDefault()
          next = Math.max(0, Math.min(levels.length - 1, next))
          ;(event.currentTarget.querySelectorAll('[role="radio"]')[next] as HTMLButtonElement | undefined)?.focus()
          void commit(levels[next])
        }}
      >
        <span className="sky-effort-glider" aria-hidden="true" />
        {levels.map((level, index) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={level === selected}
            tabIndex={index === Math.max(at, 0) ? 0 : -1}
            disabled={locked}
            onClick={(event) => {
              if (event.detail === 0) void commit(level)
            }}
          >
            {effortLabel(level)}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="sky-effort-reset"
        disabled={locked || inherited}
        onClick={() => void commit(null)}
      >
        {inherited ? resetLabel.replace('Use ', 'Using ') : resetLabel}
      </button>
    </div>
  )
}
