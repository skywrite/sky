import { spyOn } from 'bun:test'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { Command, type CommandArgs, CommandResult } from '#commands/mod.ts'
import * as config from '#config'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import DaySrUpdateTask from './update.ts'

const childNames = ['day:recurring:update', 'day:schedule:update', 'day:reminders:update'] as const
type ChildName = (typeof childNames)[number]

// Run the real wrapper and argument resolver, replacing every file-writing child.
async function runUpdate(
  options: {
    parent?: Record<string, unknown>
    overrides?: Record<string, unknown>
    stop?: { name: ChildName; outcome: CommandResult | Error }
  } = {},
) {
  const received: Array<{ name: ChildName; day: unknown }> = []
  const loaded: string[] = []
  const children = new Map<string, typeof Command>(
    childNames.map((name) => {
      class Child extends Command {
        static override description = { name, description: 'Mock day update' }

        async run({ args }: CommandArgs<Record<string, unknown>>) {
          received.push({ name, day: args.day })
          if (options.stop?.name === name) {
            if (options.stop.outcome instanceof Error) throw options.stop.outcome
            return options.stop.outcome
          }
          return CommandResult.success({ step: name })
        }
      }
      return [name, Child]
    }),
  )
  const load = spyOn(CommandService.prototype, 'get').mockImplementation(async (name) => {
    loaded.push(name)
    if (name === 'day:sr:update') return DaySrUpdateTask
    const child = children.get(name)
    if (!child) throw new Error(`Unexpected command: ${name}`)
    return child
  })
  try {
    const tasks = new CommandService(CommandContext.test(config), options.parent)
    // A runtime-selected name also exercises serialized input from CLI/tool adapters.
    const name: string = 'day:sr:update'
    let result: CommandResult | undefined
    let error: unknown
    try {
      result = await tasks.run(name, options.overrides)
    } catch (caught) {
      error = caught
    }
    return { result, error, received, loaded }
  } finally {
    load.mockRestore()
  }
}

// Compiled by dev:typecheck; never executed. Verify the handler and public calls.
async function _verifySrUpdateTypes(tasks: CommandService, input: Parameters<DaySrUpdateTask['run']>[0]) {
  const day: PlainDate | undefined = input.args.day
  // @ts-expect-error the handler's date must not be any
  const text: string = input.args.day
  // @ts-expect-error misspelled handler arguments must be rejected
  const misspelledDay = input.args.dya
  // @ts-expect-error forwarding a date into a boolean parameter must fail
  tasks.run('journal:me:update', { full: input.args.day })

  await tasks.run('day:sr:update')
  await tasks.run('day:sr:update', {})
  await tasks.run('day:sr:update', { day })
  await tasks.runSequential([['day:sr:update', { day }]])
  await tasks.runParallel([['day:sr:update', { day }]])
  // @ts-expect-error registered date overrides cannot be numbers
  tasks.run('day:sr:update', { day: 123 })
  // @ts-expect-error typed callers pass resolved dates, while adapters may parse strings
  tasks.run('day:sr:update', { day: '2031-03-16' })
  // @ts-expect-error misspelled overrides must not silently select today's default
  tasks.run('day:sr:update', { day, dya: day })
  // @ts-expect-error registration must also protect sequential callers
  tasks.runSequential([['day:sr:update', { day: true }]])
  // @ts-expect-error registration must also protect parallel callers
  tasks.runParallel([['day:sr:update', { day: true }]])

  const result = await tasks.run('day:sr:update', { day })
  // @ts-expect-error a forwarded child failure has unknown data, not any
  const files = result.data?.files
}

test('day:sr:update defaults to today and runs the three updates in order', async () => {
  const before = PlainDate.today().ymd
  const { result, error, received, loaded } = await runUpdate()
  const after = PlainDate.today().ymd
  const scheduleDay = received.find(({ name }) => name === 'day:schedule:update')?.day
  assert({
    given: 'no inherited or explicit day',
    should: 'send a PlainDate for today to the scheduler and return success after all updates',
    actual: {
      result,
      error,
      loaded,
      executed: received.map(({ name }) => name),
      today: scheduleDay instanceof PlainDate && [before, after].includes(scheduleDay.ymd),
    },
    expected: {
      result: CommandResult.success(),
      error: undefined,
      loaded: ['day:sr:update', ...childNames],
      executed: [...childNames],
      today: true,
    },
  })
})

test('day:sr:update passes inherited and explicit dates to scheduled updates', async () => {
  const inherited = new PlainDate('2031-03-16')
  const explicit = new PlainDate('2031-03-17')
  const cases = [
    { given: 'an inherited date', parent: { day: inherited }, expected: inherited },
    { given: 'an inherited date string', parent: { day: inherited.ymd }, expected: inherited },
    { given: 'an explicit date', overrides: { day: explicit }, expected: explicit },
    {
      given: 'an override of an inherited date',
      parent: { day: inherited },
      overrides: { day: explicit },
      expected: explicit,
    },
    {
      given: 'a serialized override of an inherited date',
      parent: { day: inherited },
      overrides: { day: explicit.ymd },
      expected: explicit,
    },
  ]
  for (const { given, expected, ...options } of cases) {
    const { result, error, received } = await runUpdate(options)
    const scheduleDay = received.find(({ name }) => name === 'day:schedule:update')?.day
    assert({
      given,
      should: 'resolve the selected date before forwarding it and complete all three updates',
      actual: { result, error, scheduleDay, executed: received.map(({ name }) => name) },
      expected: { result: CommandResult.success(), error: undefined, scheduleDay: expected, executed: [...childNames] },
    })
  }
})

test('day:sr:update stops after any child failure and preserves the original outcome', async () => {
  const failure = CommandResult.fail('Mock update failure', { retry: 'Mock step' })
  const thrown = new Error('Mock update exception')
  for (const outcome of [failure, CommandResult.error(thrown), thrown]) {
    for (const [index, name] of childNames.entries()) {
      const { result, error, received, loaded } = await runUpdate({
        overrides: { day: new PlainDate('2031-03-16') },
        stop: { name, outcome },
      })
      assert({
        given: `${name} ${outcome instanceof Error ? 'throwing' : `returning ${outcome.status}`}`,
        should: 'return or throw the original outcome without loading later updates',
        actual: {
          sameOutcome:
            outcome instanceof Error
              ? error === outcome && result === undefined
              : result === outcome && error === undefined,
          loaded,
          executed: received.map(({ name }) => name),
        },
        expected: {
          sameOutcome: true,
          loaded: ['day:sr:update', ...childNames.slice(0, index + 1)],
          executed: childNames.slice(0, index + 1),
        },
      })
    }
  }
})

test('day:sr:update rejects malformed external dates before running child updates', async () => {
  const { result, error, received, loaded } = await runUpdate({ overrides: { day: '2031-02-30' } })
  assert({
    given: 'a serialized date that does not exist',
    should: 'reject it before loading or running a file-writing child',
    actual: { result, rejected: error instanceof Error, received, loaded },
    expected: { result: undefined, rejected: true, received: [], loaded: ['day:sr:update'] },
  })
})
