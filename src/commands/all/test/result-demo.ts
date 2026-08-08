import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  fail: Flag.bool('Return a fail result'),
  error: Flag.bool('Return an error result'),
}

type Params = InferParams<typeof params>

/**
 * Test task that returns different result types based on arguments.
 * Used for testing CommandService composition methods.
 */
export default class TestResultDemoTask extends Command {
  static override description: CommandDescription = {
    name: 'test:result-demo',
    description: 'Return different result types for testing',
    params,
  }

  async run({ args }: CommandArgs<Params>): Promise<CommandResult> {
    const { fail, error } = args

    if (error) {
      return CommandResult.error(new Error('Something went wrong'), 'Internal error')
    }

    if (fail) {
      return CommandResult.fail('Validation failed')
    }

    return CommandResult.success({ demo: true })
  }
}
