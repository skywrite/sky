import { Button } from '@mantine/core'
import { type ReactNode, useId, useState } from 'react'

export interface Choice {
  id: string
  title: string
  why?: string
  tag?: string
  /** `sky` marks Sky's own suggestion; `force` something tied to a decision in force */
  tagKind?: 'sky' | 'force'
}

export interface OtherChoice {
  label: string
  hint: string
  placeholder?: string
  /** A day is picked from a calendar; anything else is typed */
  kind?: 'text' | 'date'
  /** The latest or earliest day that can be picked, YYYY-MM-DD */
  min?: string
  max?: string
  /** What happens with what is typed, said under the box */
  note?: string
  /** A second box under the first, for something that goes with what is typed. It may be left empty. */
  second?: { label: string; placeholder?: string }
  onUse: (text: string, second?: string) => void | Promise<void>
}

/**
 * The wizard's one way of asking: choices Sky proposes, picked with a click.
 * Typing exists only behind the last card ("Something else…"), which opens a
 * box when the choices offered are not enough.
 */
export function Choices({
  items,
  picked,
  onPick,
  multi = false,
  other,
  tail,
  label,
  sideBySide = false,
}: {
  items: Choice[]
  /** The ids picked: one for a single choice, any number when `multi` */
  picked: string[]
  onPick: (id: string) => void
  multi?: boolean
  other?: OtherChoice
  /** Something that goes with what was picked, shown under the choices and above the last card */
  tail?: ReactNode
  /** Names the group for a screen reader when the screen's question does not */
  label?: string
  /** A plain either-or: the two choices sit side by side where there is room */
  sideBySide?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [second, setSecond] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useId()
  const use = async () => {
    const value = text.trim()
    if (!value || !other || busy) return
    setBusy(true)
    try {
      await other.onUse(value, other.second ? second.trim() : undefined)
      setText('')
      setSecond('')
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      className="sky-wizard-opts"
      role={multi ? 'group' : 'radiogroup'}
      aria-label={label}
      data-side-by-side={sideBySide || undefined}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="sky-wizard-opt"
          role={multi ? 'checkbox' : 'radio'}
          aria-checked={picked.includes(item.id)}
          data-wizard-option
          onClick={() => onPick(item.id)}
        >
          <span className="sky-wizard-key" aria-hidden="true" />
          <span>
            <span className="sky-wizard-opt-title">{item.title}</span>
            {item.why && <span className="sky-wizard-opt-why">{item.why}</span>}
          </span>
          {item.tag ? (
            <span className="sky-wizard-tag" data-kind={item.tagKind}>
              {item.tag}
            </span>
          ) : (
            <span />
          )}
        </button>
      ))}
      {tail}
      {other &&
        (open ? (
          <form
            className="sky-wizard-own"
            onSubmit={(event) => {
              event.preventDefault()
              void use()
            }}
          >
            <label htmlFor={box}>{other.label.replace('…', '')}</label>
            {other.kind === 'date' ? (
              <input
                id={box}
                type="date"
                min={other.min}
                max={other.max}
                value={text}
                onChange={(event) => setText(event.currentTarget.value)}
                autoFocus
              />
            ) : (
              <textarea
                id={box}
                rows={2}
                placeholder={other.placeholder}
                value={text}
                onChange={(event) => setText(event.currentTarget.value)}
                autoFocus
              />
            )}
            {other.second && (
              <>
                <label htmlFor={`${box}-second`}>{other.second.label}</label>
                <textarea
                  id={`${box}-second`}
                  rows={2}
                  placeholder={other.second.placeholder}
                  value={second}
                  onChange={(event) => setSecond(event.currentTarget.value)}
                />
              </>
            )}
            <div className="sky-wizard-own-actions">
              <Button variant="primary" size="sm" type="submit" loading={busy} disabled={!text.trim()}>
                Use this
              </Button>
              <Button size="sm" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
            {other.note && <p className="sky-wizard-note">{other.note}</p>}
          </form>
        ) : (
          <button
            type="button"
            className="sky-wizard-opt"
            data-other="true"
            data-wizard-option
            onClick={() => setOpen(true)}
          >
            <span className="sky-wizard-key" aria-hidden="true" />
            <span>
              <span className="sky-wizard-opt-title">{other.label}</span>
              <span className="sky-wizard-opt-why">{other.hint}</span>
            </span>
            <span />
          </button>
        ))}
    </div>
  )
}
