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
import { BufferedOutput } from '../output/BufferedOutput.ts'
import CommandContext from './CommandContext.ts'
import CommandService from './CommandService.ts'

const stepParams = {
  step: Flag.string('Step label', { default: 'Default' }),
  count: Flag.number('Count', { default: 5 }),
  enabled: Flag.bool('Enable this step', { default: true }),
  types: Flag.stringArray('Types', { parse: (raw) => raw.split(','), default: () => ['Planning'] }),
  note: Flag.string('Optional note'),
}
type StepParams = InferParams<typeof stepParams>
type StepResult = { step: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'test:sequence-step': {
      params: StepParams
      paramsIn: InferParamsInput<typeof stepParams>
      result: StepResult
    }
  }
}

async function withSequence(
  parent: Record<string, unknown>,
  execute: (args: StepParams) => Promise<CommandResult<StepResult>>,
  check: (tasks: CommandService, loaded: string[]) => Promise<void>,
) {
  class Step extends Command {
    static override description = {
      name: 'test:sequence-step',
      description: 'Test sequential execution',
      params: stepParams,
    }

    async run({ args }: CommandArgs<StepParams>) {
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

// Compiled by dev:typecheck; never executed. Every tuple must keep its own command's input type.
function _verifySequentialCallTypes(
  tasks: CommandService,
  dynamicName: string,
  rawArgs: Record<string, unknown>,
  dynamicTasks: Array<[string, Record<string, unknown>?]>,
) {
  tasks.runSequential([])
  tasks.runSequential([['journal:new'], ['journal:me:update', {}]])
  tasks.runSequential([
    ['journal:new', { types: 'Mood,Health' }],
    ['journal:new', { types: ['Mood', 'Health'] }],
    ['journal:new', { types: undefined }],
    ['journal:me:update', { full: false }],
    ['day:schedule:update', { day: new PlainDate('2031-03-16') }],
    ['markdown:sel', { server: true }],
  ])
  tasks.runSequential(dynamicTasks)
  tasks.runSequential([
    [dynamicName, rawArgs],
    ['plugin:example', rawArgs],
    ['journal:new', { types: 'Mood' }],
  ])

  const namedSteps: Array<['journal:new', { types: string | string[] }]> = [['journal:new', { types: ['Mood'] }]]
  tasks.runSequential(namedSteps)
  const correlated: Array<['journal:new', { types: string }] | ['journal:me:update', { full: boolean }]> = [
    ['journal:new', { types: 'Mood' }],
    ['journal:me:update', { full: true }],
  ]
  tasks.runSequential(correlated)
  const pluginSteps: Array<['journal:new', { types: string }] | ['plugin:example', { custom: boolean }]> = [
    ['journal:new', { types: 'Mood' }],
    ['plugin:example', { custom: true }],
  ]
  tasks.runSequential(pluginSteps)
  interface JournalOverrides {
    types: string[]
  }
  const storedArgs: JournalOverrides = { types: ['Mood'] }
  tasks.runSequential([['journal:new', storedArgs]])
  const readonlySteps = [
    ['journal:new', { types: 'Mood' }],
    ['journal:me:update', { full: false }],
  ] as const
  tasks.runSequential(readonlySteps)

  // @ts-expect-error registered list input cannot be a number
  tasks.runSequential([['journal:new', { types: 123 }]])
  // @ts-expect-error registered list elements must be strings
  tasks.runSequential([['journal:new', { types: [123] }]])
  // @ts-expect-error null is not an omitted/defaulted value
  tasks.runSequential([['journal:new', { types: null }]])
  // @ts-expect-error misspelled overrides must not silently use defaults
  tasks.runSequential([['journal:new', { types: ['Mood'], typse: ['Health'] }]])
  // @ts-expect-error the boolean command must keep its own parameter type
  tasks.runSequential([['journal:me:update', { full: 123 }]])
  // @ts-expect-error the date command must keep its own parameter type
  tasks.runSequential([['day:schedule:update', { day: 123 }]])
  tasks.runSequential([
    // @ts-expect-error adding another registered command cannot make its arguments valid for the first
    ['journal:new', { full: true }],
    ['journal:me:update', { full: false }],
  ])
  tasks.runSequential([
    ['plugin:example', rawArgs],
    // @ts-expect-error an unregistered neighbor must not disable checking a registered command
    ['journal:new', { types: 123 }],
  ])
  tasks.runSequential([
    [dynamicName, rawArgs],
    // @ts-expect-error a dynamic neighbor must not disable checking a registered command
    ['journal:new', { types: 123 }],
  ])

  const invalidSteps: Array<['journal:new', { types: number }]> = [['journal:new', { types: 123 }]]
  // @ts-expect-error named batches retain checking when their command names remain known
  tasks.runSequential(invalidSteps)
  const mismatched: Array<['journal:new', { full: boolean }] | ['journal:me:update', { types: string }]> = [
    ['journal:new', { full: true }],
    ['journal:me:update', { types: 'Mood' }],
  ]
  // @ts-expect-error a union of steps must keep each command paired with its own arguments
  tasks.runSequential(mismatched)
  const invalidPluginSteps: Array<['journal:new', { full: boolean }] | ['plugin:example', { custom: boolean }]> = [
    ['journal:new', { full: true }],
    ['plugin:example', { custom: true }],
  ]
  // @ts-expect-error a plugin in a saved batch must not disable checking a registered command
  tasks.runSequential(invalidPluginSteps)
}

test('CommandService.runSequential() returns success when all tasks succeed', async () => {
  const output = new BufferedOutput()
  const context = CommandContext.test(config).fork({ output })
  const service = new CommandService(context)

  const result = await service.runSequential([['test:context'], ['test:context']])

  assert({
    given: 'all tasks succeed',
    should: 'return success',
    actual: result.status,
    expected: 'success',
  })
})

test('CommandService.runSequential() stops on first failure and returns fail result', async () => {
  const output = new BufferedOutput()
  const context = CommandContext.test(config).fork({ output })
  const service = new CommandService(context)

  const result = await service.runSequential([
    ['test:context'],
    ['test:result-demo', { fail: true }],
    ['test:context'], // Should not run
  ])

  assert({
    given: 'a task fails in sequence',
    should: 'return fail status',
    actual: result.status,
    expected: 'fail',
  })

  assert({
    given: 'a task fails in sequence',
    should: 'return the failure message',
    actual: result.message,
    expected: 'Validation failed',
  })
})

test('CommandService.runSequential() stops on first error and returns error result', async () => {
  const output = new BufferedOutput()
  const context = CommandContext.test(config).fork({ output })
  const service = new CommandService(context)

  const result = await service.runSequential([
    ['test:context'],
    ['test:result-demo', { error: true }],
    ['test:context'], // Should not run
  ])

  assert({
    given: 'a task errors in sequence',
    should: 'return error status',
    actual: result.status,
    expected: 'error',
  })
})

test('CommandService.runSequential() returns success for empty task list', async () => {
  const output = new BufferedOutput()
  const context = CommandContext.test(config).fork({ output })
  const service = new CommandService(context)

  const result = await service.runSequential([])

  assert({
    given: 'an empty task list',
    should: 'return success',
    actual: result.status,
    expected: 'success',
  })
})

test('runSequential waits for each step to finish before starting the next', async () => {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const events: string[] = []
  await withSequence(
    {},
    async ({ step }) => {
      events.push(`${step}:start`)
      if (step === 'First') {
        started.resolve()
        await release.promise
      }
      events.push(`${step}:end`)
      return CommandResult.success({ step })
    },
    async (tasks, loaded) => {
      const pending = tasks.runSequential([
        ['test:sequence-step', { step: 'First' }],
        ['test:sequence-step', { step: 'Second' }],
      ])
      await started.promise
      const whileWaiting = { loaded: loaded.length, events: [...events] }
      release.resolve()
      const result = await pending
      assert({
        given: 'a first step paused on unfinished work',
        should: 'defer loading the next step and return success only after both complete in order',
        actual: { whileWaiting, events, result },
        expected: {
          whileWaiting: { loaded: 1, events: ['First:start'] },
          events: ['First:start', 'First:end', 'Second:start', 'Second:end'],
          result: CommandResult.success(),
        },
      })
    },
  )
})

test('runSequential stops loading steps after a failure, error result or thrown error', async () => {
  const thrown = new Error('Mock step exception')
  for (const outcome of [
    CommandResult.fail('Mock failure', { step: 'Blocked' }),
    CommandResult.error(thrown),
    thrown,
  ]) {
    const executed: string[] = []
    await withSequence(
      {},
      async ({ step }) => {
        executed.push(step)
        if (step === 'Blocked') {
          if (outcome instanceof Error) throw outcome
          return outcome
        }
        return CommandResult.success({ step })
      },
      async (tasks, loaded) => {
        let returned: unknown
        try {
          returned = await tasks.runSequential([
            ['test:sequence-step', { step: 'First' }],
            ['test:sequence-step', { step: 'Blocked' }],
            ['test:sequence-step', { step: 'Skipped' }],
          ])
        } catch (error) {
          returned = error
        }
        assert({
          given: outcome instanceof Error ? 'a step throwing' : `a step returning ${outcome.status}`,
          should: 'preserve the original failure and never load or execute later steps',
          actual: { sameOutcome: returned === outcome, loaded: loaded.length, executed },
          expected: { sameOutcome: true, loaded: 2, executed: ['First', 'Blocked'] },
        })
      },
    )
  }
})

test('runSequential preserves defaults and inheritance without leaking overrides between steps', async () => {
  const received: StepParams[] = []
  const capture = async ({ step, count, enabled, types, note }: StepParams) => {
    received.push({ step, count, enabled, types, note })
    return CommandResult.success({ step })
  }
  await withSequence({}, capture, async (tasks) => {
    await tasks.runSequential([['test:sequence-step']])
  })
  const parent = { step: 'Inherited', count: 8, enabled: true, types: ['Inherited'], note: 'Parent note' }
  await withSequence(parent, capture, async (tasks) => {
    await tasks.runSequential([
      ['test:sequence-step'],
      [
        'test:sequence-step',
        { step: 'Override', count: 0, enabled: false, types: 'Planning,Review', note: 'Override note' },
      ],
      ['test:sequence-step'],
    ])
  })
  assert({
    given: 'omitted arguments, inherited values and an override in the middle of a batch',
    should: 'apply defaults, normalize inputs, preserve false and zero, and isolate each step',
    actual: received,
    expected: [
      { step: 'Default', count: 5, enabled: true, types: ['Planning'], note: undefined },
      parent,
      { step: 'Override', count: 0, enabled: false, types: ['Planning', 'Review'], note: 'Override note' },
      parent,
    ],
  })
})

test('runSequential supports mixed dynamic, unregistered and registered commands', async () => {
  const received: Array<{ count: number; enabled: boolean; types: string[] }> = []
  await withSequence(
    {},
    async ({ step, count, enabled, types }) => {
      received.push({ count, enabled, types })
      return CommandResult.success({ step })
    },
    async (tasks) => {
      const dynamicName: string = 'test:sequence-step'
      const result = await tasks.runSequential([
        [dynamicName, { count: '0', enabled: 'false', types: 'Planning,Review' }],
        ['plugin:sequence', { count: '1', enabled: 'true', types: 'Review' }],
        ['test:sequence-step', { count: 2, enabled: false, types: ['Planning'] }],
      ])
      assert({
        given: 'a batch combining runtime-selected commands, a plugin and a typed command',
        should: 'resolve their arguments through the same dispatcher and finish in order',
        actual: { status: result.status, received },
        expected: {
          status: 'success',
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
