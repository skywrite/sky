import { Arg, Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  category: Arg.string('Filter by category', { required: false }),
}

type Params = InferParams<typeof params>

export default class SecretsListTask extends Command {
  static override description: CommandDescription = {
    name: 'secrets:list',
    description: 'List known secrets (names only, no values).',
    usage: ['sky secrets:list', 'sky secrets:list gmail'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { output, secrets } = context

    const entries = await secrets.list(args.category || undefined)

    if (entries.length === 0) {
      output.log('\n  No secrets found.\n')
      return CommandResult.success()
    }

    output.log('')
    for (const entry of entries) {
      output.log(`  ${entry.category}/${entry.name}  ${entry.type}`)
    }
    output.log('')

    return CommandResult.success()
  }
}
