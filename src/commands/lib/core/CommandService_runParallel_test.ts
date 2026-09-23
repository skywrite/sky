import { spyOn } from 'bun:test'
import {
  Command,
  type CommandArgs,
  CommandResult,
  Flag,
  type InferParams,
  type InferParamsInput,
} from '#commands/mod.ts'
import * as config from '#config'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import CommandContext from './CommandContext.ts'
import CommandService from './CommandService.ts'

const params = {
  step: Flag.string('Step label', { default: 'Default' }),
  count: Flag.number('Count', { default: 5 }),
  enabled: Flag.bool('Enable this step', { default: true }),
  types: Flag.stringArray('Types', { parse: (raw) => raw.split(','), default: () => ['Planning'] }),
  note: Flag.string('Optional note'),
}
type Params = InferParams<typeof params>
type Result = { step: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'test:parallel-step': { params: Params; paramsIn: InferParamsInput<typeof params>; result: Result }
  }
}

async function withParallel(
  parent: Record<string, unknown>,
  execute: (args: Params) => Promise<CommandResult<Result>>,
  check: (tasks: CommandService, loaded: string[]) => Promise<void>,
) {
  class Step extends Command {
    static override description = { name: 'test:parallel-step', description: 'Test parallel execution', params }

    async run({ args }: CommandArgs<Params>) {
      return execute(args)
    }
  }
  const tasks = new CommandService(CommandContext.test(config), parent)
  const loaded: string[] = []
  const load = spyOn(tasks, 'get').mockImplementation(async (name) => {
    loaded.push(name)
    return Step
  })
  try {
    await check(tasks, loaded)
  } finally {
    load.mockRestore()
  }
}

// Compiled by dev:typecheck; never executed. Check the public method's inference.
function _verifyParallelCallTypes(
  tasks: CommandService,
  dynamicName: string,
  rawArgs: Record<string, unknown>,
  dynamicTasks: Array<[string, Record<string, unknown>?]>,
) {
  tasks.runParallel([])
  tasks.runParallel([['journal:new'], ['journal:me:update', {}]])
  tasks.runParallel([
    ['journal:new', { types: 'Mood,Health' }],
    ['journal:new', { types: ['Mood', 'Health'] }],
    ['journal:new', { types: undefined }],
    ['journal:me:update', { full: false }],
    ['day:schedule:update', { day: new PlainDate('2031-03-16') }],
    ['markdown:sel', { server: true }],
  ])
  tasks.runParallel(dynamicTasks)
  tasks.runParallel([
    [dynamicName, rawArgs],
    ['plugin:example', rawArgs],
    ['journal:new', { types: 'Mood' }],
  ])

  const named: Array<['journal:new', { types: string | string[] }]> = [['journal:new', { types: ['Mood'] }]]
  tasks.runParallel(named)
  const correlated: Array<['journal:new', { types: string }] | ['journal:me:update', { full: boolean }]> = [
    ['journal:new', { types: 'Mood' }],
    ['journal:me:update', { full: true }],
  ]
  tasks.runParallel(correlated)
  const pluginSteps: Array<['journal:new', { types: string }] | ['plugin:example', { custom: boolean }]> = [
    ['journal:new', { types: 'Mood' }],
    ['plugin:example', { custom: true }],
  ]
  tasks.runParallel(pluginSteps)
  interface JournalOverrides {
    types: string[]
  }
  const storedArgs: JournalOverrides = { types: ['Mood'] }
  tasks.runParallel([['journal:new', storedArgs]])
  const readonlySteps = [
    ['journal:new', { types: 'Mood' }],
    ['journal:me:update', { full: false }],
  ] as const
  tasks.runParallel(readonlySteps)

  // @ts-expect-error registered list input cannot be a number
  tasks.runParallel([['journal:new', { types: 123 }]])
  // @ts-expect-error registered list elements must be strings
  tasks.runParallel([['journal:new', { types: [123] }]])
  // @ts-expect-error null is not an omitted/defaulted value
  tasks.runParallel([['journal:new', { types: null }]])
  // @ts-expect-error misspelled overrides must not silently use defaults
  tasks.runParallel([['journal:new', { types: ['Mood'], typse: ['Health'] }]])
  // @ts-expect-error boolean overrides must stay boolean
  tasks.runParallel([['journal:me:update', { full: 123 }]])
  // @ts-expect-error date overrides must keep their date type
  tasks.runParallel([['day:schedule:update', { day: 123 }]])
  tasks.runParallel([
    // @ts-expect-error a neighbor's parameters cannot be used for this command
    ['journal:new', { full: true }],
    ['journal:me:update', { full: false }],
  ])
  tasks.runParallel([
    ['plugin:example', rawArgs],
    // @ts-expect-error a plugin neighbor must not disable checking a known command
    ['journal:new', { types: 123 }],
  ])
  tasks.runParallel([
    [dynamicName, rawArgs],
    // @ts-expect-error a dynamic neighbor must not disable checking a known command
    ['journal:new', { types: 123 }],
  ])

  const invalid: Array<['journal:new', { types: number }]> = [['journal:new', { types: 123 }]]
  // @ts-expect-error saved batches keep checking known command names
  tasks.runParallel(invalid)
  const mismatched: Array<['journal:new', { full: boolean }] | ['journal:me:update', { types: string }]> = [
    ['journal:new', { full: true }],
    ['journal:me:update', { types: 'Mood' }],
  ]
  // @ts-expect-error union elements must keep each command paired with its own arguments
  tasks.runParallel(mismatched)
  const invalidPluginSteps: Array<['journal:new', { full: boolean }] | ['plugin:example', { custom: boolean }]> = [
    ['journal:new', { full: true }],
    ['plugin:example', { custom: true }],
  ]
  // @ts-expect-error a plugin in a saved batch must not disable checking a known command
  tasks.runParallel(invalidPluginSteps)
}

test('runParallel starts later commands before earlier ones finish and returns results in input order', async () => {
  const firstStarted = Promise.withResolvers<void>()
  const releaseFirst = Promise.withResolvers<void>()
  const secondFinished = Promise.withResolvers<void>()
  const started: string[] = []
  const finished: string[] = []
  const expected = [CommandResult.success({ step: 'First' }), CommandResult.success({ step: 'Second' })]
  await withParallel(
    {},
    async ({ step }) => {
      started.push(step)
      if (step === 'First') {
        firstStarted.resolve()
        await releaseFirst.promise
      } else {
        await firstStarted.promise
      }
      finished.push(step)
      if (step === 'Second') secondFinished.resolve()
      return expected[step === 'First' ? 0 : 1]
    },
    async (tasks) => {
      let settled = false
      const pending = tasks
        .runParallel([
          ['test:parallel-step', { step: 'First' }],
          ['test:parallel-step', { step: 'Second' }],
        ])
        .then((results) => {
          settled = true
          return results
        })
      await secondFinished.promise
      const whileFirstBlocked = { started: started.toSorted(), finished: [...finished], settled }
      releaseFirst.resolve()
      const results = await pending
      assert({
        given: 'a first command blocked while the second finishes',
        should: 'run concurrently, wait for both and preserve the original results in input order',
        actual: {
          whileFirstBlocked,
          finished,
          results,
          sameResults: results.every((result, i) => result === expected[i]),
        },
        expected: {
          whileFirstBlocked: { started: ['First', 'Second'], finished: ['Second'], settled: false },
          finished: ['Second', 'First'],
          results: expected,
          sameResults: true,
        },
      })
    },
  )
})

test('runParallel collects fail and error results alongside successful results', async () => {
  const outcomes: Record<string, CommandResult<Result>> = {
    Fail: CommandResult.fail('Mock failure', { step: 'Fail' }),
    Error: CommandResult.error(new Error('Mock error')),
    Success: CommandResult.success({ step: 'Success' }),
  }
  await withParallel(
    {},
    async ({ step }) => outcomes[step],
    async (tasks, loaded) => {
      const results = await tasks.runParallel([
        ['test:parallel-step', { step: 'Fail' }],
        ['test:parallel-step', { step: 'Error' }],
        ['test:parallel-step', { step: 'Success' }],
      ])
      assert({
        given: 'a returned failure, a returned error and a success in one batch',
        should: 'run every command and return each original result',
        actual: {
          loaded: loaded.length,
          results,
          sameResults: results.every((result, i) => result === Object.values(outcomes)[i]),
        },
        expected: { loaded: 3, results: Object.values(outcomes), sameResults: true },
      })
    },
  )
})

test('runParallel propagates a thrown error while other commands continue', async () => {
  const slowStarted = Promise.withResolvers<void>()
  const releaseSlow = Promise.withResolvers<void>()
  const slowFinished = Promise.withResolvers<void>()
  const thrown = new Error('Mock step exception')
  let finished = false
  await withParallel(
    {},
    async ({ step }) => {
      if (step === 'Throw') {
        await slowStarted.promise
        throw thrown
      }
      slowStarted.resolve()
      await releaseSlow.promise
      finished = true
      slowFinished.resolve()
      return CommandResult.success({ step })
    },
    async (tasks, loaded) => {
      const caught = await tasks
        .runParallel([
          ['test:parallel-step', { step: 'Throw' }],
          ['test:parallel-step', { step: 'Slow' }],
        ])
        .then(
          () => undefined,
          (error: unknown) => error,
        )
      const finishedBeforeRejection = finished
      releaseSlow.resolve()
      await slowFinished.promise
      assert({
        given: 'one command throwing while another is still working',
        should: 'reject with the original error without cancelling the other command',
        actual: { sameError: caught === thrown, loaded: loaded.length, finishedBeforeRejection, finished },
        expected: { sameError: true, loaded: 2, finishedBeforeRejection: false, finished: true },
      })
    },
  )
})

test('runParallel handles an empty batch without loading a command', async () => {
  await withParallel(
    {},
    async ({ step }) => CommandResult.success({ step }),
    async (tasks, loaded) => {
      const results = await tasks.runParallel([])
      assert({
        given: 'an empty batch',
        should: 'return no results and load no commands',
        actual: { results, loaded },
        expected: { results: [], loaded: [] },
      })
    },
  )
})

test('runParallel preserves defaults, inheritance and isolated overrides', async () => {
  const received: Params[] = []
  const capture = async ({ step, count, enabled, types, note }: Params) => {
    received.push({ step, count, enabled, types, note })
    return CommandResult.success({ step })
  }
  await withParallel({}, capture, async (tasks) => {
    await tasks.runParallel([['test:parallel-step']])
  })
  const parent = { step: 'Inherited', count: 8, enabled: true, types: ['Inherited'], note: 'Parent note' }
  await withParallel(parent, capture, async (tasks) => {
    await tasks.runParallel([
      ['test:parallel-step'],
      [
        'test:parallel-step',
        { step: 'Override', count: 0, enabled: false, types: 'Planning,Review', note: 'Override note' },
      ],
      ['test:parallel-step'],
    ])
  })
  assert({
    given: 'omitted arguments, inherited values and an explicit override in a parallel batch',
    should: 'apply defaults and normalize overrides without leaking values into sibling commands',
    actual: received.toSorted((a, b) => a.step.localeCompare(b.step)),
    expected: [
      { step: 'Default', count: 5, enabled: true, types: ['Planning'], note: undefined },
      parent,
      parent,
      { step: 'Override', count: 0, enabled: false, types: ['Planning', 'Review'], note: 'Override note' },
    ],
  })
})

test('runParallel supports mixed dynamic, unregistered and registered commands', async () => {
  const received: Array<{ count: number; enabled: boolean; types: string[] }> = []
  await withParallel(
    {},
    async ({ step, count, enabled, types }) => {
      received.push({ count, enabled, types })
      return CommandResult.success({ step })
    },
    async (tasks) => {
      const dynamicName: string = 'test:parallel-step'
      const results = await tasks.runParallel([
        [dynamicName, { count: '0', enabled: 'false', types: 'Planning,Review' }],
        ['plugin:parallel', { count: '1', enabled: 'true', types: 'Review' }],
        ['test:parallel-step', { count: 2, enabled: false, types: ['Planning'] }],
      ])
      assert({
        given: 'runtime-selected, plugin and registered commands in one batch',
        should: 'resolve their inputs through the dispatcher and return all results',
        actual: {
          statuses: results.map((result) => result.status),
          received: received.toSorted((a, b) => a.count - b.count),
        },
        expected: {
          statuses: ['success', 'success', 'success'],
          received: [
            { count: 0, enabled: false, types: ['Planning', 'Review'] },
            { count: 1, enabled: true, types: ['Review'] },
            { count: 2, enabled: false, types: ['Planning'] },
          ],
        },
      })
    },
  )
})
