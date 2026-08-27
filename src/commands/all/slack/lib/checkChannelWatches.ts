import { runAgentSlack } from '#commands/all/slack/lib/agentSlack.ts'
import type { AgentSlackMessage } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import type { CommandService } from '#commands/mod.ts'
import { DIR_STATE_FOLLOW_SLACK_CHANNELS } from '#config'
import { writeTextFile } from '#shared/fs/mod.ts'
import { ChannelWatchRegistry } from '#shared/models/Follow/ChannelWatch.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'

export type ChannelWatchCheckResult = {
  checked: number
  /** New root messages captured as follows */
  captured: number
  /** Rows declined because their thread is already in the ledger */
  alreadyCaptured: number
  errors: string[]
}

/** Archive URL for a history row — the link form slack:follow:message takes. */
export function historyRowLink(ts: string, channel: string, workspaceUrl: string): string {
  return `${workspaceUrl.replace(/\/$/, '')}/archives/${channel}/p${ts.replace('.', '')}`
}

/**
 * Poll due channel watches: every root message newer than the watch's cursor
 * is fed to slack:follow:message (its ledger dedup makes this idempotent),
 * then the cursor advances. On a hard capture failure the cursor stops at the
 * last processed row, so the failed message is retried next pass.
 */
export async function checkChannelWatches(deps: {
  tasks: CommandService
  output: OutputHandler
}): Promise<ChannelWatchCheckResult> {
  const { tasks, output } = deps
  const result: ChannelWatchCheckResult = { checked: 0, captured: 0, alreadyCaptured: 0, errors: [] }

  const now = fetchNowSync().plainDateTime
  const registry = await ChannelWatchRegistry.build(DIR_STATE_FOLLOW_SLACK_CHANNELS)
  const due = registry.getDue(now)

  for (const entry of due) {
    const { watch } = entry
    result.checked++

    const listArgs = [
      'message',
      'list',
      watch.channel,
      '--workspace',
      watch.workspaceUrl,
      '--oldest',
      watch.lastSeenTs,
      '--limit',
      '200',
    ]
    const listResult = await runAgentSlack(listArgs)
    if (listResult.code !== 0) {
      const detail = (listResult.stderr.trim() || listResult.stdout.trim()).slice(0, 200)
      output.log(`[channel] ${watch.label}: history fetch failed — ${detail}`)
      result.errors.push(`${watch.label}: ${detail}`)
      continue
    }

    let rows: AgentSlackMessage[]
    try {
      rows = ((JSON.parse(listResult.stdout) as { messages?: AgentSlackMessage[] }).messages ?? [])
        .filter((r) => r.ts > watch.lastSeenTs)
        .sort((a, b) => (a.ts < b.ts ? -1 : 1))
    } catch {
      result.errors.push(`${watch.label}: unparseable history output`)
      continue
    }

    let cursor = watch.lastSeenTs
    let captured = 0
    let already = 0
    for (const row of rows) {
      const link = historyRowLink(row.ts, watch.channel, watch.workspaceUrl)
      const capture = await tasks.run('slack:follow:message', { link, noEditor: true })
      if (capture.ok) {
        captured++
      } else if (capture.message?.includes('Duplicate follow') || capture.message?.includes('Already captured')) {
        already++
      } else if (capture.message?.includes('Message not found')) {
        // Deleted since it was posted — nothing to capture, move past it
      } else {
        // Hard failure: keep the cursor here so this row retries next pass
        result.errors.push(`${watch.label}: ${row.ts}: ${capture.message}`)
        break
      }
      cursor = row.ts
    }

    result.captured += captured
    result.alreadyCaptured += already
    output.log(
      rows.length === 0
        ? `[channel] ${watch.label}: no new messages`
        : `[channel] ${watch.label}: ${rows.length} new root message(s) — ${captured} captured, ${already} already in ledger`,
    )

    await writeTextFile(entry.path, watch.updateCursor(cursor, now).toYaml())
  }

  return result
}
