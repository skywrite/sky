import { spyOn } from 'bun:test'
import * as agentSlack from '#commands/all/slack/lib/agentSlack.ts'
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

test('captureLaterItems saves reminders before completing fresh and already-captured items in Slack', async () => {
  const events: string[] = []
  const complete = spyOn(agentSlack, 'runAgentSlack').mockImplementation(async () => {
    events.push('complete')
    return { success: true, code: 0, stdout: '', stderr: '' }
  })
  try {
    const results = [
      CommandResult.success({ slackFiles: ['time/2031/W11/03-16/Atlas.md'], followed: false }),
      CommandResult.fail('Already captured: Atlas.yaml'),
      CommandResult.fail('Duplicate follow: Atlas.yaml'),
    ]
    for (const result of results) {
      const outcome = await captureLaterItems([row()], {
        tasks: stubTasks(result),
        output: stubOutput([]),
        addReminder: async () => {
          events.push('reminder')
        },
      })
      assert({
        given: 'a successfully captured or previously captured thread',
        should: 'complete it only after saving its reminder',
        actual: [outcome.completed, outcome.failures],
        expected: [1, []],
      })
    }
    assert({
      given: 'fresh, archived and active captures',
      should: 'save the reminder first in every case',
      actual: events,
      expected: ['reminder', 'complete', 'reminder', 'complete', 'reminder', 'complete'],
    })
  } finally {
    complete.mockRestore()
  }
})

test('captureLaterItems leaves a to-do pending if its reminder fails and continues with other items', async () => {
  const links: string[] = []
  const complete = spyOn(agentSlack, 'runAgentSlack').mockImplementation(async (args) => {
    links.push(args[2])
    return { success: true, code: 0, stdout: '', stderr: '' }
  })
  const failed = row()
  const next = { ...row(), link: 'https://atlas.slack.com/archives/C0123ABCDEF/p1750000000000200' }
  try {
    for (const result of [
      CommandResult.success({ slackFiles: ['time/2031/W11/03-16/Atlas.md'], followed: false }),
      CommandResult.fail('Already captured: Atlas.yaml'),
    ]) {
      links.length = 0
      const outcome = await captureLaterItems([failed, next], {
        tasks: stubTasks(result),
        output: stubOutput([]),
        addReminder: async (row) => {
          if (row.link === failed.link) throw new Error('Day file is not writable')
        },
      })
      assert({
        given: 'a reminder write fails before another item succeeds',
        should: 'leave the affected item pending in Slack, explain why, and complete the unaffected item',
        actual: [links, outcome.completed, outcome.failures],
        expected: [
          [next.link],
          1,
          [
            `${failed.link}: captured but today's reminder could not be saved — Day file is not writable; left pending in Slack`,
          ],
        ],
      })
    }
  } finally {
    complete.mockRestore()
  }
})

test('captureLaterItems does not add reminders for failed or deleted captures', async () => {
  let reminders = 0
  for (const result of [
    CommandResult.fail('Message not found'),
    CommandResult.fail('Slack is unavailable'),
    CommandResult.success({ slackFiles: [], followed: false }),
  ]) {
    await captureLaterItems([row()], {
      tasks: stubTasks(result),
      output: stubOutput([]),
      addReminder: async () => {
        reminders++
      },
    })
  }
  assert({
    given: 'a deleted message, a failed fetch, or a capture with no files',
    should: 'add no reminder',
    actual: reminders,
    expected: 0,
  })
})

const dmRow = (): LaterCaptureRow => ({
  item: { channel_id: 'D0JANE', ts: '1750000000.000100' },
  timeLabel: '09:30',
  link: 'https://atlas.slack.com/archives/D0JANE/p1750000000000100',
})
const DAY_FILE = '2031-03-16/actions/messages/09-30_slack_Jane-to-JP_Atlas-launch-plan.md'

/** Records each command run, and a capture that will not follow its thread; the capture writes one file */
const recordingTasks = (calls: string[], onRun?: (name: string) => void) =>
  ({
    run: async (name: string, params?: { noFollow?: boolean }) => {
      calls.push(params?.noFollow ? `${name} without a follow` : name)
      onRun?.(name)
      return CommandResult.success({ slackFiles: ['time/2031/W11/03-16/Atlas.md'], followed: false })
    },
  }) as unknown as CommandService

test('captureLaterItems does not capture a saved message its direct conversation already holds', async () => {
  const events: string[] = []
  const complete = spyOn(agentSlack, 'runAgentSlack').mockImplementation(async (args) => {
    events.push(`complete ${args[2]}`)
    return { success: true, code: 0, stdout: '', stderr: '' }
  })
  try {
    const calls: string[] = []
    const lines: string[] = []
    const outcome = await captureLaterItems([dmRow()], {
      tasks: recordingTasks(calls),
      output: stubOutput(lines),
      addReminder: async () => {
        events.push('reminder')
      },
      findInConversation: async () => ({ kept: true, doc: DAY_FILE }),
    })
    assert({
      given: "a saved message already in its conversation's day file",
      should: 'capture nothing, then save its reminder and complete it in Slack',
      actual: [calls, events, outcome.captured, outcome.completed, outcome.failures],
      expected: [[], ['reminder', `complete ${dmRow().link}`], [], 1, []],
    })
    assert({
      given: 'the same skip',
      should: 'name the file that holds it',
      actual: lines.some((line) => line.includes(DAY_FILE) && line.includes('skipping capture')),
      expected: true,
    })
  } finally {
    complete.mockRestore()
  }
})

test('captureLaterItems lands a kept conversation first, and captures only what is still not there', async () => {
  const complete = spyOn(agentSlack, 'runAgentSlack').mockImplementation(async () => ({
    success: true,
    code: 0,
    stdout: '',
    stderr: '',
  }))
  try {
    const fresh: string[] = []
    let landed = false
    const saved = await captureLaterItems([dmRow()], {
      tasks: recordingTasks(fresh, (name) => {
        if (name === 'slack:land') landed = true
      }),
      output: stubOutput([]),
      findInConversation: async () => (landed ? { kept: true, doc: DAY_FILE } : { kept: true }),
    })
    assert({
      given: 'a message saved before the landing reached it',
      should: 'run the landing once, then find it there and capture nothing',
      actual: [fresh, saved.captured, saved.completed],
      expected: [['slack:land'], [], 1],
    })

    const old: string[] = []
    const older = await captureLaterItems([dmRow()], {
      tasks: recordingTasks(old),
      output: stubOutput([]),
      findInConversation: async () => ({ kept: true }),
    })
    assert({
      given: 'a saved message the landing never wrote, from before it kept the conversation',
      should: 'capture it after the landing, without following its thread: its replies land with the conversation',
      actual: [old, older.captured],
      expected: [['slack:land', 'slack:follow:message without a follow'], ['time/2031/W11/03-16/Atlas.md']],
    })

    const channel: string[] = []
    await captureLaterItems([row()], {
      tasks: recordingTasks(channel),
      output: stubOutput([]),
      findInConversation: async () => ({ kept: false }),
    })
    assert({
      given: 'a saved channel message',
      should: 'capture and follow it, without running the landing',
      actual: channel,
      expected: ['slack:follow:message'],
    })
  } finally {
    complete.mockRestore()
  }
})
