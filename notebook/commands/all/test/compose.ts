import { Command, CommandResult, when as whenParam } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  when: whenParam(),
}

type Params = InferParams<typeof params>

export default class TestComposeTask extends Command {
  static override description: CommandDescription = {
    name: 'test:compose',
    description: 'A test task that composes the subtask with different arguments using CommandService',
    params,
  }

  async run(commandArgs: CommandArgs<Params>): Promise<CommandResult> {
    const { args, context, tasks } = commandArgs
    const { output } = context
    const { when } = args

    output.log(`Base when: ${when?.toString()}`)

    // Call subtask twice with different messages using CommandService.run()
    output.log('First call:')
    const result1 = await tasks.run('test:subtask', {
      message: 'First message from parent',
      when,
    })

    if (result1.status !== 'success') {
      return result1
    }

    output.log('Second call:')
    const result2 = await tasks.run('test:subtask', {
      message: 'Second message from parent',
      when,
    })

    return result2.status === 'success'
      ? CommandResult.success({
          baseWhen: when?.toString(),
          results: [result1.data, result2.data],
        })
      : result2
  }
}
