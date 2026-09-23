import { spyOn } from 'bun:test'
import { z } from 'zod'
import {
  Command,
  type CommandArgs,
  type CommandDescription,
  CommandResult,
  Flag,
  type InferParams,
} from '#commands/mod.ts'
import * as config from '#config'
import { assert, test } from '#test'
import { BufferedOutput } from '../../output/BufferedOutput.ts'
import CommandContext from '../CommandContext.ts'
import CommandService from '../CommandService.ts'

const params = {
  enabled: Flag.bool('Enable the action', { default: true }),
  count: Flag.number('Current count', { default: 5, schema: z.coerce.number().int().nonnegative() }),
}

class PrimitiveTask extends Command {
  static override description: CommandDescription = {
    name: 'test:primitive-overrides',
    description: 'Exercise boolean decisions and numeric arithmetic',
    params,
  }

  async run({ args }: CommandArgs<InferParams<typeof params>>): Promise<CommandResult> {
    return CommandResult.success({
      enabled: args.enabled,
      count: args.count,
      action: args.enabled ? 'apply' : 'skip',
      nextCount: args.count === undefined ? undefined : args.count + 1,
    })
  }
}

function createService(parentArgs: Record<string, unknown> = {}) {
  const context = CommandContext.test(config).fork({ output: new BufferedOutput() })
  const service = new CommandService(context, parentArgs)
  const load = spyOn(service, 'get').mockResolvedValue(PrimitiveTask)
  return { service, load }
}

test('string boolean and number overrides drive boolean decisions and numeric arithmetic', async () => {
  const { service, load } = createService({ enabled: true, count: 99 })
  try {
    for (const [enabled, count] of [
      ['false', '12'],
      ['true', '0'],
    ]) {
      const result = await service.run('test:primitive-overrides', { enabled, count })
      assert({
        given: `string overrides enabled=${enabled} and count=${count}`,
        should: 'override inherited values with a boolean and number before execution',
        actual: result.data,
        expected: {
          enabled: enabled === 'true',
          count: Number(count),
          action: enabled === 'true' ? 'apply' : 'skip',
          nextCount: Number(count) + 1,
        },
      })
    }
  } finally {
    load.mockRestore()
  }
})

test('primitive overrides preserve typed false, zero, defaults, inheritance and explicit undefined', async () => {
  const { service, load } = createService({ enabled: false, count: 9 })
  const { service: defaultService, load: defaultLoad } = createService()
  try {
    const typed = await service.run('test:primitive-overrides', { enabled: false, count: 0 })
    const cleared = await service.run('test:primitive-overrides', { enabled: undefined, count: undefined })
    const inherited = await service.run('test:primitive-overrides')
    const defaults = await defaultService.run('test:primitive-overrides')
    assert({
      given: 'typed overrides, explicit clears, inherited values and omitted arguments',
      should: 'preserve their existing precedence without treating false or zero as missing',
      actual: [typed.data, cleared.data, inherited.data, defaults.data],
      expected: [
        { enabled: false, count: 0, action: 'skip', nextCount: 1 },
        { enabled: undefined, count: undefined, action: 'skip', nextCount: undefined },
        { enabled: false, count: 9, action: 'skip', nextCount: 10 },
        { enabled: true, count: 5, action: 'apply', nextCount: 6 },
      ],
    })
  } finally {
    load.mockRestore()
    defaultLoad.mockRestore()
  }
})

test('invalid primitive overrides fail validation before the command runs', async () => {
  const { service, load } = createService()
  const run = spyOn(PrimitiveTask.prototype, 'run')
  try {
    for (const overrides of [{ enabled: 'no' }, { count: 'not-a-number' }, { count: '-1' }]) {
      let message = ''
      try {
        await service.run('test:primitive-overrides', overrides)
      } catch (error) {
        message = (error as Error).message
      }
      assert({
        given: `invalid overrides ${JSON.stringify(overrides)}`,
        should: 'reject the value before executing the command',
        actual: { rejected: message.startsWith('Validation failed for'), executions: run.mock.calls.length },
        expected: { rejected: true, executions: 0 },
      })
    }
  } finally {
    run.mockRestore()
    load.mockRestore()
  }
})
