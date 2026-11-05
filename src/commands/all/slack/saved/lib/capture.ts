import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { AgentSlackLaterItem } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { readDmRecord } from '#commands/all/slack/land/lib/dms.ts'
import { runAgentSlack } from '#commands/all/slack/lib/agentSlack.ts'
import { oneLine } from '#commands/all/slack/lib/mod.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import type { CommandService } from '#commands/mod.ts'
import { DIR_BASE, DIR_STATE_SLACK_DMS } from '#config'
import { readOptional } from '#lib/outbox/files.ts'
import { runCommand } from '#lib/sys/mod.ts'
import { slackMessageId } from '#shared/models/Message/slack/write.ts'
import { resolveTimeRef } from '#shared/nbfs/mod.ts'
import { laterBrowserLink, type LaterRowContext, renderLaterRow } from './list.ts'

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

/** A saved message's direct or group conversation, as the Slack landing keeps it */
export type ConversationHit = {
  /** The landing keeps this conversation, so its messages belong in the conversation's day files */
  kept: boolean
  /** The day file (time ref) that already holds the message */
  doc?: string
}

/** Find a saved message in the day files the Slack landing wrote for its direct or group conversation. */
export async function findInConversation(item: AgentSlackLaterItem): Promise<ConversationHit> {
  const record = await readDmRecord(DIR_STATE_SLACK_DMS, item.channel_id)
  if (!record) return { kept: false }
  let anchor: string
  try {
    anchor = `id="${slackMessageId(item.channel_id, item.ts)}"`
  } catch {
    return { kept: true }
  }
  for (const doc of record.docs.toReversed()) {
    const text = await readOptional(path.join(DIR_BASE, resolveTimeRef(doc.path)))
    if (text?.includes(anchor)) return { kept: true, doc: doc.path }
  }
  return { kept: true }
}

/**
 * Capture later items through slack:follow:message and mark each complete in
 * Slack — the Later list stays the ledger of what remains. A message the
 * notebook already holds is not captured again: a thread Sky follows, or a
 * direct or group conversation's day file.
 */
export async function captureLaterItems(
  rows: LaterCaptureRow[],
  deps: {
    tasks: CommandService
    output: OutputHandler
    addReminder?: (row: LaterCaptureRow) => Promise<void>
    /** Test seam: where a saved message's conversation already holds it */
    findInConversation?: (item: AgentSlackLaterItem) => Promise<ConversationHit>
  },
): Promise<LaterCaptureOutcome> {
  const { tasks, output } = deps
  const find = deps.findInConversation ?? findInConversation
  const captured: string[] = []
  const openTargets: string[] = []
  const openRows: LaterCaptureRow[] = []
  const skipped: string[] = []
  const failures: string[] = []
  let completed = 0

  const remind = async (row: LaterCaptureRow): Promise<boolean> => {
    try {
      await deps.addReminder?.(row)
      return true
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      failures.push(`${row.link}: captured but today's reminder could not be saved — ${detail}; left pending in Slack`)
      return false
    }
  }

  /** The saved message is in the notebook already: save its reminder, then complete it in Slack */
  const known = async (row: LaterCaptureRow) => {
    if (!(await remind(row))) return
    const done = await runAgentSlack(['later', 'complete', row.link])
    if (done.success) {
      completed++
      openRows.push(row)
    } else {
      failures.push(`${row.link}: already captured; complete failed — ${oneLine(done.stderr || done.stdout, 120)}`)
    }
  }

  // A direct or group conversation lands whole into its day file, so a message
  // saved from one is already there. One saved minutes after it arrived may not
  // have landed yet: the landing runs first, so it is there before the check.
  const hits = new Map<LaterCaptureRow, ConversationHit>()
  for (const row of rows) hits.set(row, await find(row.item))
  if ([...hits.values()].some((hit) => hit.kept && !hit.doc)) {
    const landed = await tasks.run('slack:land', {})
    if (!landed.ok) output.log(`Slack landing did not run first: ${landed.message ?? 'no reason given'}`)
    for (const [row, hit] of hits) if (hit.kept && !hit.doc) hits.set(row, await find(row.item))
  }

  for (const row of rows) {
    const { link } = row
    output.log('')
    output.log(`Capturing ${link}`)
    const hit = hits.get(row)
    if (hit?.doc) {
      output.log(`  Already in the notebook (${hit.doc}) — skipping capture`)
      await known(row)
      continue
    }
    // In a conversation the landing keeps, later replies land in its day file:
    // following the thread too would write them a second time
    const result = await tasks.run('slack:follow:message', {
      link,
      noEditor: true,
      ...(hit?.kept ? { noFollow: true } : {}),
    })

    if (!result.ok) {
      // slack:follow:message declines a thread captured before only once its
      // capture holds everything Slack has (new replies land first), so the
      // saved message is in the notebook — completing the Later item is
      // still the right move
      if (result.message?.includes('Duplicate follow') || result.message?.includes('Already captured')) {
        output.log('  Thread already in the notebook — skipping capture')
        await known(row)
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

    if (!(await remind(row))) continue
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
    // Browser-client form — the workspace permalink greets a browser with the
    // "open the app" interstitial, useless without the app installed
    await runCommand('open', [laterBrowserLink(row.item)])
    for (const line of renderLaterRow(row, index, context)) output.log(line)
    await delay(500)
  }
}
