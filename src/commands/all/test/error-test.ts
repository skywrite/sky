import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  throw: Flag.boolean('Throw an error instead of returning CommandResult'),
  error: Flag.boolean('Return CommandResult.error()', { short: 'e' }),
  fail: Flag.boolean('Return CommandResult.fail()', { short: 'f' }),
}

type Params = InferParams<typeof params>

export default class TestErrorTestTask extends Command {
  static override description: CommandDescription = {
    name: 'test:error-test',
    description: 'Test task to verify error handling',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { output } = context
    const { throw: shouldThrow, error, fail } = args

    if (shouldThrow) {
      // This should be caught by the wrapper and converted to CommandResult.error
      throw new Error('This is a thrown error from the task')
    }

    if (error) {
      // This returns a proper CommandResult.error
      return CommandResult.error('This is a returned error', 'Task encountered an error condition')
    }

    if (fail) {
      // This returns a CommandResult.fail
      return CommandResult.fail('Task failed validation', { reason: 'Invalid input' })
    }

    // Default success case - use output handler
    output.log('Task executed successfully!')
    return CommandResult.success({ message: 'All good!' })
  }
}
