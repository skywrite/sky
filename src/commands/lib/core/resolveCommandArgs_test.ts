import { Arg, Flag } from '#commands/lib/params.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { resolveCommandArgs } from './resolveCommandArgs.ts'

const description = {
  name: 'test:dates',
  description: 'Test date argument resolution',
  params: {
    day: Arg.plainDate('Day'),
    local: Flag.plainDateTime('Local time'),
    zoned: Flag.zonedDateTime('Zoned time'),
    category: Flag.string('Category', { parse: (raw) => `${raw} Todos` }),
  },
}

test('resolveCommandArgs keeps parsed dates from string overrides', async () => {
  const result = await resolveCommandArgs({
    description,
    callerArgs: { day: new PlainDate('2031-03-15') },
    overrides: {
      day: '2031-03-16',
      local: '2031-03-16 09:30',
      zoned: '2031-03-16 09:30,America/New_York',
    },
    callerDepth: 0,
  })

  assert({
    given: 'JSON strings overriding date and time parameters',
    should: 'deliver typed dates with the requested values and timezone',
    actual: result,
    expected: {
      day: new PlainDate('2031-03-16'),
      local: new PlainDateTime('2031-03-16 09:30'),
      zoned: new ZonedDateTime('2031-03-16 09:30', 'America/New_York'),
    },
  })
})

test('resolveCommandArgs preserves typed dates and normalized string overrides', async () => {
  const overrides = {
    day: new PlainDate('2031-03-16'),
    local: new PlainDateTime('2031-03-16 09:30'),
    zoned: new ZonedDateTime('2031-03-16 09:30', 'America/New_York'),
    category: 'Professional Todos',
  }
  const result = await resolveCommandArgs({ description, callerArgs: {}, overrides, callerDepth: 1 })

  assert({
    given: 'already-parsed overrides from a composing command',
    should: 'preserve date instances and avoid changing normalized strings',
    actual: {
      sameDay: result.day === overrides.day,
      sameLocal: result.local === overrides.local,
      sameZoned: result.zoned === overrides.zoned,
      category: result.category,
    },
    expected: { sameDay: true, sameLocal: true, sameZoned: true, category: 'Professional Todos' },
  })
})

test('resolveCommandArgs honors a date parameter custom parser', async () => {
  const day = new PlainDate('2031-03-16')
  const result = await resolveCommandArgs({
    description: {
      ...description,
      params: { day: Arg.plainDate('Day', { parse: (raw) => (raw === 'next-checkpoint' ? day : new PlainDate(raw)) }) },
    },
    callerArgs: {},
    overrides: { day: 'next-checkpoint' },
    callerDepth: 0,
  })

  assert({
    given: 'a date override using a command-specific spelling',
    should: 'keep the date returned by the parameter parser',
    actual: result.day === day,
    expected: true,
  })
})
