/**
 * The settings pages' building blocks: a card, a preference row, a
 * monospace value, and how a refusal from the service is read.
 */

import type { ReactNode } from 'react'

export const UNREACHABLE = "Couldn't reach sky — is the service running?"

/** What went wrong, in the service's words — or null when the answer was fine. */
export async function refusalOf(r: Response | null): Promise<string | null> {
  if (!r) return UNREACHABLE
  if (r.ok) return null
  const body = (await r.json().catch(() => ({}))) as { message?: string }
  return body.message ?? `The service answered ${r.status}.`
}

export function Block({ head, note, children }: { head?: string; note?: string; children: ReactNode }) {
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
