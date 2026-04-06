import { Arg, Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  category: Arg.string('Secret category (e.g. email, api, slack)'),
  name: Arg.string('Secret name (e.g. personal, anthropic)'),
}

type Params = InferParams<typeof params>

export default class SecretsDeleteTask extends Command {
  static override description: CommandDescription = {
    name: 'secrets:delete',
    description: 'Delete a secret from the OS keychain.',
    usage: ['sky secrets:delete email personal'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { output, secrets } = context
    const { category, name } = args

    await secrets.delete(category, name)
    output.log(`\n  Deleted ${category}/${name}\n`)

    return CommandResult.success()
  }
}
