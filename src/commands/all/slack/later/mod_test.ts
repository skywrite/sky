import { spyOn } from 'bun:test'
import stripAnsi from 'strip-ansi'
import type { AgentSlackLaterItem } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { mpdmMemberHandles } from '#commands/all/slack/lib/mpdmMembers.ts'
import * as names from '#commands/all/slack/lib/resolveNames.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { BufferedOutput } from '#commands/lib/output/BufferedOutput.ts'
import transformTypedParamsArgs from '#commands/lib/transformTypedParamsArgs/mod.ts'
import * as config from '#config'
import * as nbfs from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import SlackLaterDayTask from './day.ts'
import * as capture from './lib/capture.ts'
import * as list from './lib/list.ts'
import SlackLaterTask from './mod.ts'

type Args = Parameters<SlackLaterTask['run']>[0]['args']
type DayArgs = Parameters<SlackLaterDayTask['run']>[0]['args']

const item = (channel_name: string | undefined, second: number, channel_id = 'C0ATLAS'): AgentSlackLaterItem => ({
  channel_id,
  channel_name,
  ts: `17500000${String(second).padStart(2, '0')}.000100`,
  message: { content: `Message ${second}` },
})

const queue = () => [
  ...Array.from({ length: 25 }, (_, i) => item('general', i, 'C0GENERAL')),
  item('atlas', 40),
  item(undefined, 29, 'C0STALE'),
  item('atlas', 30),
  item('atlas', 50),
]

async function fixture(
  run: (state: {
    invoke: (args?: Partial<Args>) => ReturnType<SlackLaterTask['run']>
    invokeDay: (args?: Partial<DayArgs>) => ReturnType<SlackLaterDayTask['run']>
    output: BufferedOutput
    captured: capture.LaterCaptureRow[]
    opened: capture.LaterCaptureRow[]
    hydrated: capture.LaterCaptureRow[]
    displayed: capture.LaterCaptureRow[]
    fetchCalls: () => number
  }) => Promise<void>,
  items = queue(),
  memberNames = new Map<string, string[]>(),
) {
  const output = new BufferedOutput()
  const now = new ZonedDateTime('2025-06-15 12:00', 'UTC')
  const context = CommandContext.test(
    { ...config, SLACK_WORKSPACE: 'https://atlas.slack.com' },
    { systemNow: now, notebookNow: now },
  ).fork({ output })
  const captured: capture.LaterCaptureRow[] = []
  const opened: capture.LaterCaptureRow[] = []
  const hydrated: capture.LaterCaptureRow[] = []
  const displayed: capture.LaterCaptureRow[] = []
  const render = list.renderLaterRow
  const identities = new Map<string, names.SlackConversationIdentity>()
  const profiles = new Map<string, names.SlackUserProfile>()
  for (const entry of items) {
    const kind = list.laterConversationKind(entry)
    if (kind === 'unknown') continue
    const members =
      kind === 'channel'
        ? []
        : (memberNames.get(entry.channel_id) ??
          (kind === 'dm' ? [entry.channel_name!] : mpdmMemberHandles(entry.channel_name)))
    const memberIds = members.map((name, index) => {
      const id = `${entry.channel_id}-user-${index}`
      profiles.set(id, { id, name, aliases: [name, name.split(' ')[0], name.toLowerCase().replaceAll(' ', '.')] })
      return id
    })
    identities.set(entry.channel_id, {
      kind,
      name: entry.channel_name?.replace(/^#/, ''),
      memberIds: kind === 'group' ? ['U0SELF', ...memberIds] : memberIds,
    })
  }
  const fetch = spyOn(list, 'fetchInProgressLater').mockResolvedValue({
    list: { items, counts: { in_progress: 100 } },
  })
  const spies = [
    fetch,
    spyOn(nbfs, 'convertToNotebookTimezone').mockImplementation(async (when) => {
      if (typeof when !== 'string') throw new Error('Expected a wall-clock string')
      return new PlainDateTime(when)
    }),
    spyOn(list, 'backfillMissingMessages').mockImplementation(async (rows) => {
      hydrated.push(...(rows as capture.LaterCaptureRow[]))
    }),
    spyOn(list, 'resolveRowMentions').mockResolvedValue(undefined),
    spyOn(list, 'renderLaterRow').mockImplementation((row, index, rowContext) => {
      displayed.push(row)
      return render(row, index, rowContext)
    }),
    spyOn(names, 'fetchDmMembership').mockResolvedValue({
      selfId: 'U0SELF',
      membersByChannel: new Map(),
      conversations: identities,
    }),
    spyOn(names, 'resolveUserProfiles').mockResolvedValue(profiles),
    spyOn(names, 'resolveHandleProfiles').mockResolvedValue(new Map()),
    spyOn(capture, 'captureLaterItems').mockImplementation(async (rows) => {
      captured.push(...rows)
      return {
        captured: [],
        completed: rows.length,
        openRows: rows,
        openTargets: [],
        skipped: [],
        failures: [],
      }
    }),
    spyOn(capture, 'openInSlack').mockImplementation(async (rows) => {
      opened.push(...rows)
    }),
  ]
  try {
    await run({
      invoke: (args = {}) =>
        new SlackLaterTask().run({
          args: {
            channel: undefined,
            sort: 'time',
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
      invokeDay: (args = {}) =>
        new SlackLaterDayTask().run({
          args: {
            date: '2025-06-15',
            savedOn: false,
            channel: undefined,
            sortTime: false,
            capture: undefined,
            captureAll: false,
            captureBatch: undefined,
            open: undefined,
            limit: 600,
            ...args,
          },
          context,
          tasks: new CommandService(context),
          rawArgs: { _: [] },
        }),
      output,
      captured,
      opened,
      hydrated,
      displayed,
      fetchCalls: () => fetch.mock.calls.length,
    })
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
}

test('slack:later filters before the preview limit and keeps listing read-only', async () => {
  await fixture(async ({ invoke, output, hydrated, captured, opened }) => {
    const result = await invoke({ channel: ' #Atlas ' })
    assert({
      given: 'a channel whose items fall after the first 20 global items',
      should: 'list its oldest items and report its fetched count separately from the global total',
      actual: [
        result.ok,
        result.data?.fetched,
        result.data?.matched,
        result.data?.remaining,
        hydrated.map((r) => r.item.ts),
      ],
      expected: [true, 29, 3, 3, [item('atlas', 30).ts, item('atlas', 40).ts, item('atlas', 50).ts]],
    })
    assert({
      given: 'a filtered listing',
      should: 'retain the channel in the re-run hint and leave Slack and the notebook untouched',
      actual: [
        output.hasLog('#general'),
        output.hasLog("sky slack:later --channel '#atlas' --capture-batch 5"),
        captured,
        opened,
      ],
      expected: [false, true, [], []],
    })
  })
})

test('slack:later captures and opens only the oldest items from the selected channel', async () => {
  await fixture(async ({ invoke, output, captured, opened }) => {
    const result = await invoke({ channel: 'atlas', captureBatch: 2, open: 'landed' })
    assert({
      given: 'a channel batch with older items in other channels',
      should: 'capture only that channel in time order and open those same items',
      actual: [
        captured.map((r) => r.item.ts),
        opened.map((r) => r.item.ts),
        result.data?.completed,
        result.data?.remaining,
      ],
      expected: [[item('atlas', 30).ts, item('atlas', 40).ts], [item('atlas', 30).ts, item('atlas', 40).ts], 2, 1],
    })
    assert({
      given: 'a partially captured channel',
      should: 'report what remains for that conversation',
      actual: output.hasLog('1 left for atlas'),
      expected: true,
    })
  })
})

test('slack:later read-only opening stays within the channel', async () => {
  await fixture(async ({ invoke, captured, opened }) => {
    const result = await invoke({ channel: 'atlas', open: '10' })
    assert({
      given: 'an open count larger than the channel queue',
      should: 'open only matching items without capturing or completing any',
      actual: [opened.map((r) => r.item.channel_name), captured, result.data?.completed, result.data?.remaining],
      expected: [['atlas', 'atlas', 'atlas'], [], 0, 3],
    })
  })
})

test('slack:later wildcard listing and capture stay within the matching conversations', async () => {
  const items = [
    item('general', 0, 'C0GENERAL'),
    item('old-atlas-api', 20, 'C0OLD'),
    item('atlas-api', 50, 'C0API'),
    item('atlas-design', 40, 'C0DESIGN'),
    item('atlas-api', 30, 'C0API'),
  ]
  await fixture(async ({ invoke, output, hydrated, captured, opened }) => {
    const result = await invoke({ channel: ' #Atlas-* ', sort: 'channel', all: true })
    assert({
      given: 'a wildcard matching two conversations and older nonmatching items',
      should: 'list only matching conversations and quote the pattern in the re-run hint',
      actual: [
        result.data?.matched,
        result.data?.remaining,
        hydrated.map((r) => r.item.ts),
        output.hasLog("--channel '#atlas-*' --sort channel --capture-batch 5"),
      ],
      expected: [3, 3, [items[4].ts, items[2].ts, items[3].ts], true],
    })
    const capturedResult = await invoke({ channel: '#atlas-*', sort: 'channel', captureBatch: 10, open: 'landed' })
    assert({
      given: 'a batch larger than the wildcard matches',
      should: 'capture and open only those matches, in the displayed order',
      actual: [captured.map((r) => r.item.ts), opened.map((r) => r.item.ts), capturedResult.data?.remaining],
      expected: [[items[4].ts, items[2].ts, items[3].ts], [items[4].ts, items[2].ts, items[3].ts], 0],
    })
  }, items)
})

test('slack:later never falls back to the global queue when a channel has no matches', async () => {
  await fixture(async ({ invoke, output, captured, opened, hydrated }) => {
    const result = await invoke({ channel: 'atl', captureBatch: 5, open: 'landed', includeUnavailable: true })
    assert({
      given: 'a partial channel name rather than an exact match',
      should: 'return an empty scoped queue with available names and no actions',
      actual: [
        result.data?.matched,
        result.data?.remaining,
        captured,
        opened,
        hydrated,
        output.hasLog('#atlas — channel, 3 items') && output.hasLog('#general — channel, 25 items'),
      ],
      expected: [0, 0, [], [], [], true],
    })
  })
})

test('slack:later accepts DM names and group-DM slugs like slack:later:day', async () => {
  const items = [item('Jane Doe', 30, 'D0JANE'), item('mpdm-jane--john-1', 40, 'C0GROUP'), item('general', 20)]
  await fixture(async ({ invoke, output, captured }) => {
    await invoke({ channel: 'Jane Doe' })
    assert({
      given: 'a DM name containing spaces',
      should: 'quote the name in the re-run hint',
      actual: output.hasLog("--channel 'jane doe' --capture-batch 5"),
      expected: true,
    })
    await invoke({ channel: 'mpdm-jane--john-1', captureBatch: 5 })
    assert({
      given: 'a raw group-DM slug',
      should: 'capture only that conversation',
      actual: captured.map((r) => r.item.channel_id),
      expected: ['C0GROUP'],
    })
  }, items)
})

test('slack:later rejects empty channel queries before fetching Slack', async () => {
  await fixture(async ({ invoke, fetchCalls }) => {
    for (const channel of ['', '   ', ' # ']) {
      const result = await invoke({ channel, captureBatch: 5 })
      assert({
        given: 'an empty normalized channel',
        should: 'fail with channel guidance without fetching the global queue',
        actual: [result.failed, result.message?.includes('Invalid --channel'), fetchCalls()],
        expected: [true, true, 0],
      })
    }
  })
})

test('slack:later without a channel keeps the global queue count and capture ordering', async () => {
  await fixture(async ({ invoke, captured }) => {
    const result = await invoke({ captureBatch: 2, sort: undefined })
    assert({
      given: 'an unfiltered batch with a Slack total larger than the fetch',
      should: 'capture the oldest global items and use the reported total for remaining',
      actual: [captured.map((r) => r.item.ts), result.data?.matched, result.data?.remaining],
      expected: [[item('general', 0).ts, item('general', 1).ts], 29, 98],
    })
  })
})

test('slack:later groups only with --sort channel, before limiting the preview or capture batch', async () => {
  await fixture(async ({ invoke, output, hydrated, captured, opened }) => {
    await invoke({ sort: 'channel' })
    const headers = output
      .getLogs()
      .map((line) => stripAnsi(line).trim())
      .filter((line) => /^#\w+$/.test(line))
    assert({
      given: 'channel sorting with Atlas messages beyond the first 20 chronological items',
      should: 'show Atlas first, with chronological rows under one header per conversation',
      actual: [hydrated.length, hydrated.slice(0, 4).map((r) => r.item.ts), headers],
      expected: [
        20,
        [item('atlas', 30).ts, item('atlas', 40).ts, item('atlas', 50).ts, item('general', 0).ts],
        ['#atlas', '#general'],
      ],
    })
    assert({
      given: 'a listing sorted by channel',
      should: 'preserve that order in its re-run hint',
      actual: output.hasLog('sky slack:later --sort channel --capture-batch 5'),
      expected: true,
    })
    await invoke({ sort: 'channel', captureBatch: 2, open: 'landed' })
    assert({
      given: 'a capture batch sorted by channel',
      should: 'capture and open the first two items in the displayed order',
      actual: [captured.map((r) => r.item.ts), opened.map((r) => r.item.ts)],
      expected: [
        [item('atlas', 30).ts, item('atlas', 40).ts],
        [item('atlas', 30).ts, item('atlas', 40).ts],
      ],
    })
  })
})

test('slack:later channel sorting opens channels before people and sorts group DMs by their displayed members', async () => {
  const items = [
    item('Jane Doe', 10, 'D0JANE'),
    item('mpdm-zoe--john-1', 50, 'C0GROUP'),
    item('general', 20, 'C0GENERAL'),
    item('atlas', 40),
    item('mpdm-zoe--john-1', 30, 'C0GROUP'),
  ]
  await fixture(
    async ({ invoke, opened, captured }) => {
      await invoke({ sort: 'channel', open: '10' })
      assert({
        given: 'mixed channels, DMs, and a group DM displayed as Amy Doe',
        should: 'open in conversation order, then time within each, without capturing',
        actual: [opened.map((r) => r.item.ts), captured],
        expected: [[items[3].ts, items[2].ts, items[4].ts, items[1].ts, items[0].ts], []],
      })
    },
    items,
    new Map([['C0GROUP', ['Amy Doe']]]),
  )
})

test('slack:later --sort time explicitly keeps a flat oldest-first listing', async () => {
  await fixture(async ({ invoke, output, opened }) => {
    await invoke({ sort: 'time', open: '2' })
    assert({
      given: 'an explicit time sort',
      should: 'open the oldest items without conversation headers',
      actual: [opened.map((r) => r.item.ts), output.getLogs().some((line) => /^#\w+$/.test(stripAnsi(line).trim()))],
      expected: [[item('general', 0).ts, item('general', 1).ts], false],
    })
  })
})

test('slack:later rejects unknown sort modes before fetching Slack', async () => {
  await fixture(async ({ invoke, fetchCalls }) => {
    const result = await invoke({ sort: 'unknown', captureBatch: 5 })
    assert({
      given: 'an unsupported sort mode on a capture run',
      should: 'fail with the supported options before fetching or capturing',
      actual: [result.failed, result.message, fetchCalls()],
      expected: [true, 'Invalid --sort: unknown (use "time" or "channel")', 0],
    })
  })
})

test('both Later commands accept the --capture-all CLI flag', async () => {
  for (const command of [SlackLaterTask, SlackLaterDayTask]) {
    const args = await transformTypedParamsArgs(command.description.params!, {
      _: [command.description.name!],
      'capture-all': true,
      channel: '#atlas-*',
    })
    assert({
      given: `${command.description.name} --channel '#atlas-*' --capture-all`,
      should: 'recognize capture-all as a boolean capture request',
      actual: [args.captureAll, args.channel, args.captureBatch],
      expected: [true, '#atlas-*', undefined],
    })
  }
})

test('slack:later --capture-all captures beyond the preview limit and skips unavailable items', async () => {
  await fixture(async ({ invoke, hydrated, captured, opened, output }) => {
    const result = await invoke({ captureAll: true, open: 'landed' })
    assert({
      given: '28 available items and one stale item in a fetch with a larger global total',
      should: 'show, capture, and open every available fetched item, then report the remaining total',
      actual: [
        hydrated.length,
        captured.length,
        opened.length,
        captured.some((r) => r.item.channel_id === 'C0STALE'),
        result.data?.completed,
        result.data?.remaining,
        output.hasLog('NaN'),
      ],
      expected: [28, 28, 28, false, 28, 72, false],
    })
  })
})

test('slack:later:day --capture-all respects wildcard channels and the selected day', async () => {
  const previousDay = { ...item('atlas-api', 40, 'C0API'), ts: '1749913640.000100', date_saved: 1750000040 }
  const items = [
    ...Array.from({ length: 25 }, (_, i) => item('atlas-api', i, 'C0API')),
    item('atlas-design', 40, 'C0DESIGN'),
    item('general', 50, 'C0GENERAL'),
    item(undefined, 60, 'C0STALE'),
    previousDay,
  ]
  await fixture(async ({ invokeDay, captured, opened }) => {
    const result = await invokeDay({ channel: '#atlas-*', captureAll: true, open: 'landed' })
    assert({
      given: '26 matching items on the day, a match on a prior day, and unrelated items',
      should: 'capture and open all 26 day matches while excluding the prior day and other channels',
      actual: [
        captured.length,
        opened.length,
        captured.every((r) => r.item.channel_name?.startsWith('atlas-') && r.item.ts !== previousDay.ts),
        result.data?.matched,
        result.data?.remaining,
      ],
      expected: [26, 26, true, 26, 0],
    })
    captured.length = 0
    await invokeDay({ channel: '#atlas-*', captureAll: true, savedOn: true })
    assert({
      given: '--saved-on with a prior-day message saved on the selected day',
      should: 'capture by save day rather than origin day',
      actual: captured.map((r) => r.item.ts),
      expected: [previousDay.ts],
    })
  }, items)
})

test('both Later commands reject conflicting capture-all flags before fetching', async () => {
  await fixture(async ({ invoke, invokeDay, fetchCalls, captured, opened }) => {
    for (const run of [invoke, invokeDay]) {
      for (const args of [{ captureBatch: 2 }, { open: '2' }]) {
        const result = await run({ captureAll: true, ...args })
        assert({
          given: '--capture-all combined with a batch size or read-only open count',
          should: 'reject the ambiguous request before any Slack activity',
          actual: [result.failed, fetchCalls(), captured.length, opened.length],
          expected: [true, 0, 0, 0],
        })
      }
    }
    const result = await invokeDay({ captureAll: true, capture: '1,3' })
    assert({
      given: '--capture-all combined with explicit day indexes',
      should: 'reject the conflicting selection before fetching',
      actual: [result.failed, fetchCalls()],
      expected: [true, 0],
    })
  })
})

test('both Later commands leave an empty capture-all match alone', async () => {
  await fixture(async ({ invoke, invokeDay, captured, opened }) => {
    for (const run of [invoke, invokeDay]) {
      const result = await run({ captureAll: true, channel: 'missing-*', open: 'landed' })
      assert({
        given: '--capture-all with a wildcard matching no conversations',
        should: 'succeed with no captures or opens, without using the global queue',
        actual: [result.ok, result.data?.remaining, captured.length, opened.length],
        expected: [true, 0, 0, 0],
      })
    }
  })
})

test('slack:later:day keeps explicit capture indexes and the former all spelling working', async () => {
  await fixture(async ({ invokeDay, captured }) => {
    await invokeDay({ channel: 'atlas', capture: '1,3' })
    assert({
      given: 'specific indexes in the filtered day listing',
      should: 'capture only the selected rows',
      actual: captured.map((r) => r.item.ts),
      expected: [item('atlas', 30).ts, item('atlas', 50).ts],
    })
    captured.length = 0
    await invokeDay({ channel: 'atlas', capture: 'all' })
    assert({
      given: 'the previous day-command spelling',
      should: 'retain compatibility with existing invocations',
      actual: captured.map((r) => r.item.ts),
      expected: [item('atlas', 30).ts, item('atlas', 40).ts, item('atlas', 50).ts],
    })
  })
})

test('both Later commands keep previews, captures, and opens inside the selected conversation types', async () => {
  const items = [
    item('Jane-news', 10, 'C0NEWS'),
    item('Jane Doe', 20, 'D0JANE'),
    item('mpdm-jane--john-1', 30, 'C0GROUP'),
  ]
  await fixture(
    async ({ invoke, invokeDay, hydrated, displayed, captured, opened, output }) => {
      for (const run of [invoke, invokeDay]) {
        for (const [channel, expected] of [
          ['#J*', ['C0NEWS']],
          ['@J*', ['D0JANE']],
          ['J*', ['C0NEWS', 'D0JANE', 'C0GROUP']],
        ] as Array<[string, string[]]>) {
          hydrated.length = 0
          displayed.length = 0
          const preview = await run({ channel })
          const displayedIds = displayed.map((row) => row.item.channel_id)
          assert({
            given: `${channel} listing`,
            should: 'show only the selected types and preserve the prefix in its rerun hint',
            actual: [
              preview.ok,
              hydrated.map((row) => row.item.channel_id),
              output.hasLog(`--channel '${channel.toLowerCase()}'`),
            ],
            expected: [true, expected, true],
          })
          for (const action of [
            { captureAll: true, open: 'landed' },
            { captureBatch: 10, open: 'landed' },
            { open: '10' },
          ]) {
            hydrated.length = 0
            displayed.length = 0
            captured.length = 0
            opened.length = 0
            const result = await run({ channel, ...action })
            assert({
              given: `${channel} with ${JSON.stringify(action)}`,
              should: 'act on exactly the conversations shown in the preview',
              actual: [
                result.ok,
                displayed.map((row) => row.item.channel_id),
                captured.map((row) => row.item.channel_id),
                opened.map((row) => row.item.channel_id),
              ],
              expected: [true, displayedIds, action.open === 'landed' ? displayedIds : [], displayedIds],
            })
          }
        }
      }
    },
    items,
    new Map([['C0GROUP', ['Jane Doe', 'John Roe']]]),
  )
})

test('both Later commands capture group display names in either order and exclude larger groups', async () => {
  const items = [
    item('mpdm-stale--slug-1', 10, 'C0PAIR'),
    item('mpdm-jane--john--alex-1', 20, 'C0LARGER'),
    item('mpdm-stale--slug-1', 30, 'C0PAIR'),
  ]
  await fixture(
    async ({ invoke, invokeDay, hydrated, captured, opened, output }) => {
      for (const run of [invoke, invokeDay]) {
        hydrated.length = 0
        captured.length = 0
        opened.length = 0
        const result = await run({ channel: ' john.roe , Jane ', captureAll: true, open: 'landed' })
        assert({
          given: 'current participant aliases in reversed order with a larger group also saved',
          should: 'capture and open exactly the pair, using readable output',
          actual: [
            result.data?.matched,
            hydrated.map((row) => row.item.ts),
            captured.map((row) => row.item.ts),
            opened.map((row) => row.item.ts),
            output.hasLog('Jane Doe, John Roe — group DM, 2 items'),
          ],
          expected: [2, [items[0].ts, items[2].ts], [items[0].ts, items[2].ts], [items[0].ts, items[2].ts], true],
        })
      }
      captured.length = 0
      await invokeDay({ channel: 'John Roe, Jane Doe', capture: '2' })
      assert({
        given: 'an explicit index inside the selected group on a day',
        should: 'capture only the displayed second item',
        actual: captured.map((row) => row.item.ts),
        expected: [items[2].ts],
      })
    },
    items,
    new Map([
      ['C0PAIR', ['Jane Doe', 'John Roe']],
      ['C0LARGER', ['Jane Doe', 'John Roe', 'Alex Doe']],
    ]),
  )
})

test('both Later commands stop ambiguous exact names before any capture or open', async () => {
  const items = [item('Jane Doe', 10, 'D0JANE'), item('Jane Doe', 20, 'D0OTHER')]
  await fixture(async ({ invoke, invokeDay, hydrated, captured, opened }) => {
    for (const run of [invoke, invokeDay]) {
      for (const action of [{ captureAll: true }, { captureBatch: 2 }, { open: '2' }]) {
        const result = await run({ channel: '@Jane Doe', ...action })
        assert({
          given: 'two people with the same exact name',
          should: 'return choices without hydrating, capturing, or opening anything',
          actual: [
            result.failed,
            result.message?.includes("--channel 'D0JANE'"),
            hydrated.length,
            captured.length,
            opened.length,
          ],
          expected: [true, true, 0, 0, 0],
        })
      }
    }
    await invoke({ channel: 'D0OTHER', captureAll: true })
    assert({
      given: 'the explicit ID from the ambiguity message',
      should: 'capture only that chosen conversation',
      actual: captured.map((row) => row.item.channel_id),
      expected: ['D0OTHER'],
    })
  }, items)
})
