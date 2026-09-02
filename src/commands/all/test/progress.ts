import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'

/**
 * A fixture for the runner: plans two steps, reports them, asks one question,
 * counts through the second step, and returns what it was told.
 */
export default class TestProgressTask extends Command {
  static override description: CommandDescription = {
    name: 'test:progress',
    description: 'Fixture: reports progress and asks one question.',
  }

  async run({ context }: CommandArgs): Promise<CommandResult> {
    const { output, prompt } = context
    output.plan([
      { id: 'read', label: 'Reading' },
      { id: 'write', label: 'Writing' },
    ])
    output.stage('read', 'Reading')
    output.log('read one file')
    const name = await prompt.text({ message: 'What should it be called?' })
    if (name === null) return CommandResult.fail('Cancelled')
    output.stage('write', 'Writing', name)
    for (let i = 1; i <= 2; i++) {
      if (context.signal?.aborted) return CommandResult.fail('Cancelled')
      output.tick(i, 2, 'parts')
    }
    output.write('done.')
    return CommandResult.success({ name })
  }
}
