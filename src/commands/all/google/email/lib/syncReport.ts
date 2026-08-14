import truncate from '#shared/strings/truncate.ts'

// What a sync run did, as two lists rather than counts: which threads were
// captured, and which were retired. A drain of twenty threads is otherwise
// only readable by reconstructing it from the file paths scrolling past.
//
// The lists overlap by design. A thread first seen already quiet past the
// expiry window is captured and closed in the same run, so it belongs in both
// — its messages are in the notebook, and its label is gone from Gmail.

const MAX_LABEL = 60
const MAX_FROM = 28
/** A cut label says it was cut — a silently trimmed subject reads as the whole subject. */
const ELLIPSIS = '…'

export type SyncedThread = {
  /** Sender, as the capture spells it. */
  from: string
  /** Topic label: the thread's summary, or its subject when it has none. */
  label: string
  /** Messages downloaded for the thread in this run. */
  messages: number
  /** Whether this run started following the thread or appended to one already followed. */
  state: 'new' | 'updated'
  /** Captured and closed in the same run — quiet past the window before it was ever seen. */
  closed?: boolean
}

export type ClosedThread = {
  /** Topic label of the retired follow. */
  label: string
  /** Why it closed, in words — "inactive 43d >= 14d". */
  reason: string
  /** Messages captured in this same run, when it was captured and closed at once. */
  captured?: number
}

/** `3 msgs`, `1 msg`. */
function plural(count: number): string {
  return `${count} msg${count === 1 ? '' : 's'}`
}

/**
 * The closing report of a sync run: what was captured, then what was retired.
 * Returns the lines to log, already indented — empty when the run did neither,
 * so a quiet sync stays a single line.
 */
export function formatSyncReport(synced: SyncedThread[], closed: ClosedThread[]): string[] {
  const lines: string[] = []

  if (synced.length > 0) {
    lines.push('', `  Synced (${synced.length}):`)
    for (const thread of synced) {
      const marker = thread.state === 'new' ? '+' : '~'
      const note = thread.closed ? ' — captured, then closed' : ''
      const from = truncate(thread.from, MAX_FROM, ELLIPSIS)
      lines.push(
        `    ${marker} ${from} — ${truncate(thread.label, MAX_LABEL, ELLIPSIS)} (${plural(thread.messages)})${note}`,
      )
    }
  }

  if (closed.length > 0) {
    lines.push('', `  Closed (${closed.length}):`)
    for (const thread of closed) {
      const captured = thread.captured ? ` (${plural(thread.captured)} captured)` : ''
      lines.push(`    × ${truncate(thread.label, MAX_LABEL, ELLIPSIS)}${captured} — ${thread.reason}`)
    }
  }

  return lines
}
