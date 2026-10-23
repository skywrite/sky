/**
 * The settings pages' building blocks: a card, a preference row, a
 * monospace value, and how a refusal from the service is read.
 */

import { SegmentedControl } from '@mantine/core'
import type { Key, ReactNode } from 'react'

export const UNREACHABLE = "Couldn't reach sky — is the service running?"

/** What went wrong, in the service's words — or null when the answer was fine. */
export async function refusalOf(r: Response | null): Promise<string | null> {
  if (!r) return UNREACHABLE
  if (r.ok) return null
  const body = (await r.json().catch(() => ({}))) as { message?: string }
  return body.message ?? `The service answered ${r.status}.`
}

export function Block({
  head,
  note,
  children,
}: {
  key?: Key | null
  head?: ReactNode
  note?: string
  children: ReactNode
}) {
  return (
    <div className="sky-block">
      {head && <div className="sky-block-head">{head}</div>}
      <div className="sky-block-pad">
        {note && <p className="sky-set-note">{note}</p>}
        {children}
      </div>
    </div>
  )
}

export function Row({
  label,
  sub,
  children,
  last,
}: {
  key?: Key | null
  label: ReactNode
  sub?: ReactNode
  children?: ReactNode
  last?: boolean
}) {
  return (
    <div className="sky-set-row" data-last={last}>
      <div className="sky-set-txt">
        <div>{label}</div>
        {sub && <div className="sky-set-sub">{sub}</div>}
      </div>
      <div className="sky-set-ctl">{children}</div>
    </div>
  )
}

export const mono = (text: string) => <span className="sky-set-mono">{text}</span>

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** How long ago, in the words a person would use; the moment as ISO text or epoch milliseconds. */
export function sinceLabel(at: string | number, now = Date.now()): string {
  const ms = now - (typeof at === 'number' ? at : Date.parse(at))
  if (!Number.isFinite(ms) || ms < 60_000) return 'Just now'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${plural(hours, 'hour')} ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'Yesterday' : `${days} days ago`
}

/** The two-way switch a connection page gives a rule. */
export function OnOff({
  value,
  label,
  disabled,
  onChange,
}: {
  value: boolean
  label: string
  disabled?: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <SegmentedControl
      aria-label={label}
      disabled={disabled}
      value={value ? 'on' : 'off'}
      onChange={(next) => onChange(next === 'on')}
      data={[
        { value: 'off', label: 'Off' },
        { value: 'on', label: 'On' },
      ]}
    />
  )
}
