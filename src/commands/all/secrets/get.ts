import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  category: Arg.string('Service or category (e.g. gmail, anthropic, slack)'),
  name: Arg.string('Account or entry name (e.g. personal, work, main)'),
  reveal: Flag.boolean('Show unmasked values', { default: () => false }),
}

type Params = InferParams<typeof params>

function mask(val: string): string {
  if (val.length <= 4) return '****'
  return '****' + val.slice(-4)
}

export default class SecretsGetTask extends Command {
  static override description: CommandDescription = {
    name: 'secrets:get',
    description: 'Retrieve a secret from the OS keychain.',
    usage: ['sky secrets:get gmail personal', 'sky secrets:get anthropic main --reveal'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { output, secrets } = context
    const { category, name, reveal } = args

    const entry = await secrets.get(category, name)

    if (entry === null) {
      output.log(`\n  Not found: ${category}/${name}\n`)
      return CommandResult.fail(`Secret ${category}/${name} not found`)
    }

    output.log('')
    output.log(`  ${category}/${name} (${entry.type})`)
    output.log('')

    switch (entry.type) {
      case 'login':
        output.log(`  User:    ${entry.user}`)
        output.log(`  Pass:    ${reveal ? entry.pass : mask(entry.pass)}`)
        break
      case 'secret':
        output.log(`  Value:   ${reveal ? entry.val : mask(entry.val)}`)
        break
    }

    output.log(`  Created: ${entry.created.slice(0, 10)}`)
    output.log(`  Updated: ${entry.updated.slice(0, 10)}`)
    if (entry.notes) output.log(`  Notes:   ${entry.notes}`)
    output.log('')

    return CommandResult.success()
  }
}
