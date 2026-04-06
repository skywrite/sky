import { Arg, Command, CommandResult, when as whenParam } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  message: Arg.string('A message to display', { default: 'default message' }),
  when: whenParam(),
}

type Params = InferParams<typeof params>

export default class TestSubtaskTask extends Command {
  static override description: CommandDescription = {
    name: 'test:subtask',
    description: 'A test subtask that accepts when flag and other arguments',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { output } = context
    const { message, when } = args

    output.log(`  ${message} at ${when?.toString()}`)
    output.log('message from subtask')

    // Simulate some work
    await new Promise((resolve) => setTimeout(resolve, 100))

    return CommandResult.success({
      message,
      when: when?.toString(),
      processed: true,
    })
  }
}
