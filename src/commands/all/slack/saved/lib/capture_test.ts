import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import type { CommandService } from '#commands/mod.ts'
import { CommandResult } from '#commands/mod.ts'
import { assert, test } from '#test'
import { captureLaterItems, type LaterCaptureRow } from './capture.ts'

const row = (): LaterCaptureRow => ({
  item: { channel_id: 'C0123ABCDEF', ts: '1750000000.000100', channel_name: 'general' },
  timeLabel: '09:30',
  link: 'https://atlas.slack.com/archives/C0123ABCDEF/p1750000000000100',
})

const stubTasks = (result: CommandResult<unknown>) =>
  ({ run: () => Promise.resolve(result) }) as unknown as CommandService

const stubOutput = (lines: string[]) => ({ log: (line: string) => lines.push(line) }) as unknown as OutputHandler

test('captureLaterItems skips a message deleted from Slack instead of failing', async () => {
  const lines: string[] = []
  const tasks = stubTasks(
    CommandResult.fail(
      'Failed to export Slack message: agent-slack message get failed: Message not found (no access or wrong URL)',
    ),
  )

  const outcome = await captureLaterItems([row()], { tasks, output: stubOutput(lines) })

  assert({
    given: 'a capture whose message Slack no longer serves',
    should: 'record it as skipped, not as a failure',
    actual: { skipped: outcome.skipped, failures: outcome.failures, completed: outcome.completed },
    expected: { skipped: [row().link], failures: [], completed: 0 },
  })
  assert({
    given: 'the same skipped capture',
    should: 'say so plainly in the run log',
    actual: lines.some((line) => line.includes('not found in Slack') && line.includes('skipped')),
    expected: true,
  })
})

test('captureLaterItems still reports other capture errors as failures', async () => {
  const tasks = stubTasks(CommandResult.fail('Failed to export Slack message: something else broke'))

  const outcome = await captureLaterItems([row()], { tasks, output: stubOutput([]) })

  assert({
    given: 'a capture that fails for any other reason',
    should: 'keep it in failures with nothing skipped',
    actual: { skipped: outcome.skipped, failures: outcome.failures },
    expected: {
      skipped: [],
      failures: [`${row().link}: Failed to export Slack message: something else broke`],
    },
  })
})
