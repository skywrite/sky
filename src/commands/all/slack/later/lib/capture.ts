import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { AgentSlackLaterItem } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { runAgentSlack } from '#commands/all/slack/lib/agentSlack.ts'
import { oneLine } from '#commands/all/slack/lib/mod.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import type { CommandService } from '#commands/mod.ts'
import { DIR_BASE } from '#config'
import { runCommand } from '#lib/sys/mod.ts'
import { type LaterRowContext, renderLaterRow } from './list.ts'

/** One queue row as the capture and open flows consume it */
export type LaterCaptureRow = { item: AgentSlackLaterItem; timeLabel: string; link: string }

export type LaterCaptureOutcome = {
  /** Notebook-relative paths written by the captures */
  captured: string[]
  /** Absolute paths of captured files, for opening in the editor */
  openTargets: string[]
  /** Items marked complete in Slack */
  completed: number
  /** Rows this run landed in the notebook (fresh captures and dedup skips) — what --open opens */
  openRows: LaterCaptureRow[]
  /** Links whose saved message is gone from Slack (deleted) — skipped, left in the queue */
  skipped: string[]
  failures: string[]
}

/**
 * Capture later items through slack:follow:message and mark each complete in
 * Slack — the Later list stays the ledger of what remains.
 */
export async function captureLaterItems(
  rows: LaterCaptureRow[],
  deps: { tasks: CommandService; output: OutputHandler },
): Promise<LaterCaptureOutcome> {
  const { tasks, output } = deps
  const captured: string[] = []
  const openTargets: string[] = []
  const openRows: LaterCaptureRow[] = []
  const skipped: string[] = []
  const failures: string[] = []
  let completed = 0

  for (const row of rows) {
    const { link } = row
    output.log('')
    output.log(`Capturing ${link}`)
    const result = await tasks.run('slack:follow:message', { link, noEditor: true })

    if (!result.ok) {
      // A thread that is already followed or already captured (a saved reply
      // whose parent's capture holds the whole thread) is in the notebook —
      // completing the Later item is still the right move
      if (result.message?.includes('Duplicate follow') || result.message?.includes('Already captured')) {
        output.log('  Thread already in the notebook — skipping capture')
        const done = await runAgentSlack(['later', 'complete', link])
        if (done.success) {
          completed++
          openRows.push(row)
        } else {
          failures.push(`${link}: already captured; complete failed — ${oneLine(done.stderr || done.stdout, 120)}`)
        }
        continue
      }
      // A message Slack no longer serves (deleted since it was saved) is an
      // expected outcome, not a crash — say so plainly and leave the item
      // saved: completing it would silently drop the last trace of it
      if (result.message?.includes('Message not found')) {
        output.log('  Message not found in Slack (deleted) — skipped')
        skipped.push(link)
        continue
      }
      failures.push(`${link}: ${result.message}`)
      continue
    }

    const files = result.data?.slackFiles ?? []
    if (files.length === 0) {
      failures.push(`${link}: no files written`)
      continue
    }
    if (result.data?.followed) output.log('  Live thread — following for new replies')
    captured.push(...files)
    openTargets.push(...files.map((p) => path.join(DIR_BASE, p)))
    openRows.push(row)

    const done = await runAgentSlack(['later', 'complete', link])
    if (done.success) {
      completed++
    } else {
      failures.push(`${link}: captured but not completed in Slack — ${oneLine(done.stderr || done.stdout, 120)}`)
    }
  }

  return { captured, openTargets, completed, openRows, skipped, failures }
}

/**
 * Open queue rows in Slack via macOS `open` (the permalink redirects into
 * the app), paced so each lands as its own entry in Slack's back stack — the
 * last-opened row is the one left on screen. Each row prints as it opens,
 * so the terminal keeps a clickable recap of exactly what was opened (once
 * completed, the items no longer wear Slack's saved-for-later badge).
 */
export async function openInSlack(
  rows: LaterCaptureRow[],
  output: OutputHandler,
  context: LaterRowContext = {},
): Promise<void> {
  if (rows.length === 0) return
  output.log('')
  output.log(`Opening ${rows.length} in Slack (the last stays on screen):`)
  for (const [index, row] of rows.entries()) {
    await runCommand('open', [row.link])
    for (const line of renderLaterRow(row, index, context)) output.log(line)
    await delay(500)
  }
}
