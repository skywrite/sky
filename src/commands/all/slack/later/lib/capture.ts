import * as path from 'node:path'
import { runAgentSlack } from '#commands/all/slack/lib/agentSlack.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import type { CommandService } from '#commands/mod.ts'
import { DIR_BASE } from '#config'
import { oneLine } from './pick.ts'

export type LaterCaptureOutcome = {
  /** Notebook-relative paths written by the captures */
  captured: string[]
  /** Absolute paths of captured files, for opening in the editor */
  openTargets: string[]
  /** Items marked complete in Slack */
  completed: number
  failures: string[]
}

/**
 * Capture later items through slack:follow:new and mark each complete in
 * Slack — the Later list stays the ledger of what remains.
 */
export async function captureLaterItems(
  links: string[],
  deps: { tasks: CommandService; output: OutputHandler },
): Promise<LaterCaptureOutcome> {
  const { tasks, output } = deps
  const captured: string[] = []
  const openTargets: string[] = []
  const failures: string[] = []
  let completed = 0

  for (const link of links) {
    output.log('')
    output.log(`Capturing ${link}`)
    const result = await tasks.run('slack:follow:new', { link, noEditor: true })

    if (!result.ok) {
      // A thread that is already followed or already captured (a saved reply
      // whose parent's capture holds the whole thread) is in the notebook —
      // completing the Later item is still the right move
      if (result.message?.includes('Duplicate follow') || result.message?.includes('Already captured')) {
        output.log('  Thread already in the notebook — skipping capture')
        const done = await runAgentSlack(['later', 'complete', link])
        if (done.success) completed++
        else failures.push(`${link}: already captured; complete failed — ${oneLine(done.stderr || done.stdout, 120)}`)
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

    const done = await runAgentSlack(['later', 'complete', link])
    if (done.success) {
      completed++
    } else {
      failures.push(`${link}: captured but not completed in Slack — ${oneLine(done.stderr || done.stdout, 120)}`)
    }
  }

  return { captured, openTargets, completed, failures }
}
