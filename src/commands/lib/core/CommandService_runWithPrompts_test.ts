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
import CommandContext from './CommandContext.ts'
import CommandService from './CommandService.ts'
import { Prompt } from './Prompt.ts'

const params = {
  full: Flag.bool('Ask all questions', { default: false }),
  topics: Flag.stringArray('Topics to cover', { parse: (raw) => raw.split(','), default: () => ['Planning'] }),
  server: Flag.stringOrBool('Service host', { bareValue: 'example.test:9999' }),
}

type Params = InferParams<typeof params>
type Input = Partial<InferParamsInput<typeof params>>
type Result = { args: Params; answer: string; confirmation: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'test:typed-prompts': { params: Params; paramsIn: InferParamsInput<typeof params>; result: Result }
  }
}

class InteractiveTask extends Command {
  static override description = { name: 'test:typed-prompts', description: 'Test prompt composition', params }

  async run(): Promise<CommandResult<Result>> {
    throw new Error('This fixture must be run through its prompt generator')
  }

  override async *runWithPrompts({ args }: CommandArgs<Params>): AsyncGenerator<Prompt, CommandResult<Result>, string> {
    const answer = yield Prompt.text('answer', 'What is the next step?')
    const confirmation = yield Prompt.confirm('confirm', 'Save this answer?', { default: true })
    return CommandResult.success({
      args: { full: args.full, topics: args.topics, server: args.server },
      answer,
      confirmation,
    })
  }
}

async function withService(parent: Record<string, unknown>, run: (tasks: CommandService) => Promise<void>) {
  const tasks = new CommandService(CommandContext.test(config), parent)
  const load = spyOn(tasks, 'get').mockResolvedValue(InteractiveTask)
  try {
    await run(tasks)
  } finally {
    load.mockRestore()
  }
}

// Compiled by dev:typecheck; never executed. Exercise actual overload selection.
async function* _verifyPromptCallTypes(
  tasks: CommandService,
  dynamicName: string,
  rawArgs: Record<string, unknown>,
  knownNames: 'journal:me:update' | 'test:typed-prompts',
  mixedNames: 'journal:me:update' | 'plugin:interactive',
): AsyncGenerator<Prompt, void, string> {
  yield* tasks.runWithPrompts('journal:me:update')
  yield* tasks.runWithPrompts('journal:me:update', {})
  yield* tasks.runWithPrompts('journal:me:update', { full: false })
  yield* tasks.runWithPrompts('test:typed-prompts', { topics: ['Planning'], server: 'example.test' })
  yield* tasks.runWithPrompts('test:typed-prompts', { topics: undefined })
  yield* tasks.runWithPrompts(knownNames)
  yield* tasks.runWithPrompts(dynamicName, rawArgs)
  yield* tasks.runWithPrompts('plugin:interactive', rawArgs)
  const plugin = yield* tasks.runWithPrompts<'plugin:interactive', Result>('plugin:interactive', rawArgs)
  const answer: string | undefined = plugin.data?.answer
  // @ts-expect-error an explicitly typed plugin result must not become any
  const wrongPluginResult: number | undefined = plugin.data?.answer

  // A wider input must still select the registered overload and keep its result type.
  const result = yield* tasks.runWithPrompts('test:typed-prompts', { topics: 'Planning,Review', server: true })
  const topics: string[] | undefined = result.data?.args.topics
  const server: string | undefined = result.data?.args.server
  // @ts-expect-error paramsIn must not turn the final result into any
  const wrongResult: number[] | undefined = result.data?.args.topics

  // @ts-expect-error full is boolean, not numeric
  tasks.runWithPrompts('journal:me:update', { full: 123 })
  // @ts-expect-error misspelled overrides must not silently use defaults
  tasks.runWithPrompts('journal:me:update', { full: true, ful: true })
  // @ts-expect-error list inputs cannot be numbers
  tasks.runWithPrompts('test:typed-prompts', { topics: 123 })
  // @ts-expect-error list elements must be strings
  tasks.runWithPrompts('test:typed-prompts', { topics: [123] })
  // @ts-expect-error null is not an omitted/defaulted value
  tasks.runWithPrompts('test:typed-prompts', { topics: null })
  // @ts-expect-error known unions cannot escape to the unregistered overload
  tasks.runWithPrompts(knownNames, { full: 123 })
  // @ts-expect-error adding an unregistered name must not disable checking a known command
  tasks.runWithPrompts(mixedNames, { full: 123 })
  // @ts-expect-error a manually supplied result type must not bypass the registered command
  tasks.runWithPrompts<Result>('test:typed-prompts', { topics: 123 })
  // @ts-expect-error spelling out both generics cannot make a known name unregistered
  tasks.runWithPrompts<'test:typed-prompts', Result>('test:typed-prompts', { topics: 123 })

  const prompts = tasks.runWithPrompts('test:typed-prompts')
  // @ts-expect-error replies stay typed as strings
  await prompts.next(123)
}

test('runWithPrompts forwards prompts and replies and returns the command result with defaults', async () => {
  await withService({}, async (tasks) => {
    const prompts = tasks.runWithPrompts('test:typed-prompts')
    const first = await prompts.next()
    const second = await prompts.next('Write the plan')
    const final = await prompts.next('yes')
    assert({
      given: 'an interactive command called without overrides',
      should: 'yield both prompts, deliver both replies and return its result with defaults and absent optional values',
      actual: [first, second, final],
      expected: [
        { done: false, value: Prompt.text('answer', 'What is the next step?') },
        { done: false, value: Prompt.confirm('confirm', 'Save this answer?', { default: true }) },
        {
          done: true,
          value: CommandResult.success({
            args: { full: false, topics: ['Planning'], server: undefined },
            answer: 'Write the plan',
            confirmation: 'yes',
          }),
        },
      ],
    })
  })
})

test('runWithPrompts preserves inherited values and resolves wider explicit inputs', async () => {
  const parent = { full: true, topics: ['Inherited'], server: 'parent.test' }
  for (const [overrides, expected] of [
    [undefined, parent],
    [
      { full: false, topics: 'Planning,Review', server: true },
      { full: false, topics: ['Planning', 'Review'], server: 'example.test:9999' },
    ],
    [{ topics: ['Review'] }, { ...parent, topics: ['Review'] }],
  ] satisfies Array<[Input | undefined, Params]>) {
    await withService(parent, async (tasks) => {
      const prompts = tasks.runWithPrompts('test:typed-prompts', overrides)
      await prompts.next()
      await prompts.next('Review the plan')
      const final = await prompts.next('no')
      if (!final.done) throw new Error('Expected the command to finish after the second reply')
      assert({
        given: `inherited arguments and overrides ${JSON.stringify(overrides)}`,
        should: 'use inherited values unless overridden and give the handler resolved input types',
        actual: final.value.data,
        expected: { args: expected, answer: 'Review the plan', confirmation: 'no' },
      })
    })
  }
})

test('runWithPrompts validates malformed dynamic input before yielding a prompt', async () => {
  await withService({}, async (tasks) => {
    const execute = spyOn(InteractiveTask.prototype, 'runWithPrompts')
    try {
      const dynamicName: string = 'test:typed-prompts'
      for (const overrides of [{ full: 123 }, { topics: 123 }, { topics: ['Planning', 123] }]) {
        let message = ''
        try {
          await tasks.runWithPrompts(dynamicName, overrides).next()
        } catch (error) {
          message = (error as Error).message
        }
        assert({
          given: `malformed external input ${JSON.stringify(overrides)}`,
          should: 'reject it before executing the interactive command',
          actual: { rejected: message.startsWith('Validation failed for'), executions: execute.mock.calls.length },
          expected: { rejected: true, executions: 0 },
        })
      }
    } finally {
      execute.mockRestore()
    }
  })
})

test('runWithPrompts supports an unregistered plugin with an explicitly typed result', async () => {
  await withService({}, async (tasks) => {
    const prompts = tasks.runWithPrompts<'plugin:interactive', Result>('plugin:interactive', {
      full: 'false',
      topics: 'Planning,Review',
      server: true,
    })
    await prompts.next()
    await prompts.next('Check the plan')
    const final = await prompts.next('yes')
    if (!final.done) throw new Error('Expected the plugin to finish after the second reply')
    assert({
      given: 'an unregistered interactive command with raw argument values',
      should: 'resolve the arguments and carry replies into the declared result',
      actual: final.value.data,
      expected: {
        args: { full: false, topics: ['Planning', 'Review'], server: 'example.test:9999' },
        answer: 'Check the plan',
        confirmation: 'yes',
      },
    })
  })
})
