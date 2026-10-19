import { spyOn } from 'bun:test'
import type { AgentSlackLaterItem, AgentSlackLaterList } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import * as names from '#commands/all/slack/lib/resolveNames.ts'
import * as capture from '#commands/all/slack/saved/lib/capture.ts'
import * as list from '#commands/all/slack/saved/lib/list.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { BufferedOutput } from '#commands/lib/output/BufferedOutput.ts'
import * as config from '#config'
import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import SlackTodosTask from './mod.ts'

type Args = Parameters<SlackTodosTask['run']>[0]['args']

/** 2025-06-15 12:00 UTC as epoch seconds, the clock every to-do's reminder is judged against */
const NOW = 1749988800

const todo = (second: number, dueOffset: number | undefined, channel_id = 'C0ATLAS'): AgentSlackLaterItem => ({
  channel_id,
  channel_name: 'atlas',
  ts: `17400000${String(second).padStart(2, '0')}.000100`,
  item_type: 'message',
  todo_state: 'to_do',
  date_due: dueOffset === undefined ? undefined : NOW + dueOffset,
  message: { content: `To-do ${second}` },
})

async function fixture(
  items: AgentSlackLaterItem[],
  run: (state: {
    invoke: (args?: Partial<Args>) => ReturnType<SlackTodosTask['run']>
    output: BufferedOutput
    captured: capture.LaterCaptureRow[]
    displayed: capture.LaterCaptureRow[]
    fetchArgs: () => unknown[][]
  }) => Promise<void>,
  counts: AgentSlackLaterList['counts'] = { in_progress: 162, saved: 69, todo: 93, overdue: 1 },
) {
  const output = new BufferedOutput()
  const now = new ZonedDateTime('2025-06-15 12:00', 'UTC')
  const context = CommandContext.test(
    { ...config, SLACK_WORKSPACE: 'https://atlas.slack.com' },
    { systemNow: now, notebookNow: now },
  ).fork({ output })
  const captured: capture.LaterCaptureRow[] = []
  const displayed: capture.LaterCaptureRow[] = []
  const render = list.renderLaterRow
  const fetch = spyOn(list, 'fetchSavedItems').mockResolvedValue({
    list: { items, counts },
  })
  const spies = [
    fetch,
    spyOn(list, 'backfillMissingMessages').mockResolvedValue(undefined),
    spyOn(list, 'resolveRowMentions').mockResolvedValue(undefined),
    spyOn(list, 'renderLaterRow').mockImplementation((row, index, rowContext) => {
      displayed.push(row)
      return render(row, index, { ...rowContext, hyperlinks: false })
    }),
    spyOn(names, 'fetchDmMembership').mockResolvedValue({
      selfId: 'U0SELF',
      membersByChannel: new Map(),
      conversations: new Map([['C0ATLAS', { kind: 'channel' as const, name: 'atlas', memberIds: [] }]]),
    }),
    spyOn(names, 'resolveUserProfiles').mockResolvedValue(new Map()),
    spyOn(names, 'resolveHandleProfiles').mockResolvedValue(new Map()),
    spyOn(capture, 'captureLaterItems').mockImplementation(async (rows) => {
      captured.push(...rows)
      return { captured: [], completed: rows.length, openRows: rows, openTargets: [], skipped: [], failures: [] }
    }),
    spyOn(capture, 'openInSlack').mockResolvedValue(undefined),
  ]
  try {
    await run({
      invoke: (args = {}) =>
        new SlackTodosTask().run({
          args: {
            channel: undefined,
            sort: 'due',
            dueWithin: undefined,
            all: false,
            captureAll: false,
            captureBatch: undefined,
            open: undefined,
            limit: 600,
            includeUnavailable: false,
            ...args,
          },
          context,
          tasks: new CommandService(context),
          rawArgs: { _: [] },
        }),
      output,
      captured,
      displayed,
      fetchArgs: () => fetch.mock.calls.map((call) => [...call]),
    })
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
}

test('slack:todos lists the To-dos pile soonest due first, overdue flagged, and passes --due-within through', async () => {
  await fixture(
    [todo(1, 7200), todo(2, -3600), todo(3, undefined), todo(4, 60)],
    async ({ invoke, output, displayed, fetchArgs }) => {
      const result = await invoke({ dueWithin: '12h' })
      assert({
        given: 'a run with --due-within',
        should: 'ask agent-slack for the todo view with the window',
        actual: fetchArgs(),
        expected: [['todo', 600, { dueWithin: '12h' }]],
      })
      assert({
        given: 'to-dos with mixed reminders',
        should: 'list the overdue one first, then by due time, then the one without a reminder',
        actual: displayed.map((row) => row.item.ts.slice(8, 10)),
        expected: ['02', '04', '01', '03'],
      })
      assert({
        given: 'the overdue to-do',
        should: 'carry a red due badge',
        actual: output.hasLog('! due 2025-06-15 11:00'),
        expected: true,
      })
      assert({
        given: 'the header',
        should: "carry Slack's to-do and overdue counts",
        actual: output.hasLog('(93 in To-dos total, 1 overdue)'),
        expected: true,
      })
      assert({ given: 'the result', should: 'report the pile total', actual: result.data?.pileTotal, expected: 93 })
    },
  )
})

test('slack:todos captures the soonest due first and reports the re-run hint for its own name', async () => {
  await fixture([todo(1, 7200), todo(2, -3600), todo(3, 60)], async ({ invoke, output, captured }) => {
    await invoke()
    assert({
      given: 'a read-only run',
      should: 'hint at slack:todos without an order flag, since due is the default',
      actual: output.hasLog(
        'Re-run with: sky slack:todos --capture-batch 5   (captures the 5 soonest due; or --capture-all)',
      ),
      expected: true,
    })
    const result = await invoke({ captureBatch: 2 })
    assert({
      given: '--capture-batch 2',
      should: 'capture the two soonest due',
      actual: captured.map((row) => row.item.ts.slice(8, 10)),
      expected: ['02', '03'],
    })
    assert({ given: 'the capture outcome', should: 'count completions', actual: result.data?.completed, expected: 2 })
  })
})

test('slack:todos explains an empty listing: nothing marked, nothing due in the window, or nothing it can list', async () => {
  await fixture(
    [],
    async ({ invoke, output }) => {
      await invoke()
      assert({
        given: 'an empty To-dos pile',
        should: 'say how to mark a message in Slack and offer no capture hint',
        actual: [
          output.hasLog(
            'Mark a message in Slack with "Add to-do" and it shows up here, ready to capture into your day.',
          ),
          output.hasLog('Re-run with'),
        ],
        expected: [true, false],
      })
    },
    { in_progress: 0, saved: 0, todo: 0, overdue: 0 },
  )
  await fixture([], async ({ invoke, output }) => {
    await invoke({ dueWithin: '2h' })
    assert({
      given: 'a --due-within window nothing falls in',
      should: 'name the pile count and how to widen the window',
      actual: output.hasLog('None of the 93 in To-dos is due within 2h — drop --due-within to list them all.'),
      expected: true,
    })
    await invoke()
    assert({
      given: 'a pile Slack counts but nothing that came back as a message',
      should: 'say what this command cannot list',
      actual: output.hasLog(
        "Slack counts 93 in To-dos that aren't messages (files, or to-dos typed by hand), which this command doesn't list.",
      ),
      expected: true,
    })
  })
})
