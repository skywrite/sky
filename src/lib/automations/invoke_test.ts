import { resolveCommandArgs } from '#commands/lib/core/resolveCommandArgs.ts'
import { Arg, Flag } from '#commands/lib/params.ts'
import { resolveNow, parseTrigger } from '#shared/models/Automation/trigger.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { resolveAutomationArgs } from './invoke.ts'

const params = {
  day: Arg.plainDate('Day'),
  noEditor: Flag.bool('Leave the editor closed'),
  limit: Flag.number('Maximum items', { default: 5 }),
}

test('automation invocation resolves yesterday anew on the firing clock', async () => {
  const trigger = parseTrigger({ at: '00:30', tz: 'America/Los_Angeles' })
  const dates: string[] = []
  for (const date of ['2025-03-15', '2025-03-16']) {
    // UTC has crossed midnight, but the charter's own calendar has not.
    const now = resolveNow(trigger, new ZonedDateTime(new PlainDateTime('01:00', date), 'UTC'))
    const parsed = await resolveAutomationArgs(params, { day: 'yesterday', 'no-editor': true }, now)
    const handed = await resolveCommandArgs({
      description: { name: 'recap:journal', description: 'Mock recap', params },
      callerArgs: {},
      overrides: parsed,
      callerDepth: 0,
    })
    if (!(handed.day instanceof PlainDate)) throw new Error('The command received a raw date instead of PlainDate')
    dates.push(handed.day.ymd)
    assert({
      given: 'YAML arguments handed into CommandService',
      should: 'preserve parsed arguments and command defaults',
      actual: [handed.noEditor, handed.limit],
      expected: [true, 5],
    })
  }
  assert({
    given: 'the same recurring charter on two different mornings',
    should: 'cover the previous day in the charter timezone each time',
    actual: dates,
    expected: ['2025-03-13', '2025-03-14'],
  })
})

test('automation invocation parses fixed dates, relative today, and numeric values', async () => {
  const now = new PlainDateTime('07:00', '2025-03-15')
  const fixed = await resolveAutomationArgs(params, { day: '2025-03-01', limit: '12' }, now)
  const relative = await resolveAutomationArgs(params, { day: 'today' }, now)
  assert({
    given: 'a fixed date and today in charter args',
    should: 'pass typed dates and numbers to the command',
    actual: [(fixed.day as PlainDate).ymd, fixed.limit, (relative.day as PlainDate).ymd],
    expected: ['2025-03-01', 12, '2025-03-15'],
  })
})
