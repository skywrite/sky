import { VisuallyHidden } from '@mantine/core'
import type { CSSProperties, KeyboardEvent } from 'react'
import { WORKSTREAM_COLORS, type WorkstreamColor } from '#lib/workstreams/colors.ts'

export function workstreamColorStyle(color: WorkstreamColor = 'blue'): CSSProperties {
  return {
    '--sky-workstream-card-fill': `var(--sky-workstream-${color}-fill)`,
    '--sky-workstream-card-border': `var(--sky-workstream-${color}-border)`,
    '--sky-workstream-card-accent': `var(--sky-workstream-${color}-accent)`,
    '--sky-workstream-card-ink': `var(--sky-workstream-${color}-ink)`,
  } as CSSProperties
}

const labels: Record<WorkstreamColor, string> = {
  blue: 'Blue (default)',
  violet: 'Violet',
  mint: 'Mint',
  green: 'Green',
  orange: 'Orange',
  red: 'Red',
  yellow: 'Yellow',
  quiet: 'Quiet',
}

export function WorkstreamColorPicker({
  color = 'blue',
  onChange,
  disabled,
  inMenu = false,
}: {
  color?: WorkstreamColor
  onChange: (color: WorkstreamColor) => void
  disabled: boolean
  inMenu?: boolean
}) {
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
    const menu = inMenu && !horizontal ? event.currentTarget.closest('[data-menu-dropdown]') : null
    const buttons = [
      ...(menu ?? event.currentTarget).querySelectorAll<HTMLButtonElement>(
        menu ? 'button[data-menu-item]:not(:disabled):not([data-disabled])' : 'button:not(:disabled)',
      ),
    ]
    const current = buttons.indexOf(event.target as HTMLButtonElement)
    if (current < 0) return
    event.preventDefault()
    event.stopPropagation()
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
    const step = direction * (!inMenu && !horizontal ? 4 : 1)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (current + step + buttons.length) % buttons.length
    buttons[next]?.focus()
  }
  return (
    <div className="sky-workstream-colors" role="group" aria-label="Workstream color" onKeyDown={navigate}>
      {WORKSTREAM_COLORS.map((value) => (
        <button
          key={value}
          type="button"
          className="sky-workstream-color"
          role={inMenu ? 'menuitemradio' : undefined}
          tabIndex={inMenu ? -1 : undefined}
          aria-checked={inMenu ? value === color : undefined}
          aria-pressed={inMenu ? undefined : value === color}
          aria-label={labels[value]}
          title={labels[value]}
          data-menu-item={inMenu ? true : undefined}
          data-disabled={disabled || undefined}
          data-color={value}
          data-selected={value === color}
          style={workstreamColorStyle(value)}
          disabled={disabled}
          onClick={() => onChange(value)}
        >
          <span aria-hidden="true">{value === color ? '✓' : ''}</span>
          <VisuallyHidden data-menu-item-label>{labels[value]}</VisuallyHidden>
        </button>
      ))}
    </div>
  )
}
