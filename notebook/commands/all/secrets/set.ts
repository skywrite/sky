import * as p from '@clack/prompts'
import { Arg, Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { createLogin, createSecret, updateEntry } from '#lib/secrets/marshal.ts'
import type { EntityType } from '#lib/secrets/types.ts'

const params = {
  category: Arg.string('Service or category (e.g. gmail, anthropic, slack)'),
  name: Arg.string('Account or entry name (e.g. personal, work, main)'),
}

type Params = InferParams<typeof params>

export default class SecretsSetTask extends Command {
  static override description: CommandDescription = {
    name: 'secrets:set',
    description: 'Store a secret in the OS keychain.',
    usage: ['sky secrets:set gmail personal', 'sky secrets:set anthropic main', 'sky secrets:set slack work'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { output, secrets } = context
    const { category, name } = args

    const existing = await secrets.get(category, name)

    let type: EntityType
    if (existing) {
      type = existing.type
      output.log(`\n  Updating existing ${existing.type}: ${category}/${name}`)
    } else {
      const selected = await p.select({
        message: 'Secret type:',
        options: [
          { value: 'login' as const, label: 'Login (username + password)' },
          { value: 'secret' as const, label: 'Secret (single value)' },
        ],
      })
      if (p.isCancel(selected)) return CommandResult.fail('Cancelled')
      type = selected
    }

    let entry
    if (type === 'login') {
      const user = await p.text({
        message: 'Username:',
        ...(existing?.type === 'login' ? { initialValue: existing.user } : {}),
      })
      if (p.isCancel(user)) return CommandResult.fail('Cancelled')

      const pass = await p.password({ message: 'Password:' })
      if (p.isCancel(pass)) return CommandResult.fail('Cancelled')

      entry = existing ? updateEntry(existing, { user, pass }) : createLogin({ user, pass })
    } else {
      const val = await p.password({ message: 'Value:' })
      if (p.isCancel(val)) return CommandResult.fail('Cancelled')

      entry = existing ? updateEntry(existing, { val }) : createSecret(val)
    }

    const notes = await p.text({
      message: 'Notes (optional):',
      ...(existing?.notes ? { initialValue: existing.notes } : {}),
    })
    if (p.isCancel(notes)) return CommandResult.fail('Cancelled')
    if (notes) {
      entry = updateEntry(entry, { notes })
    } else if (entry.notes) {
      delete entry.notes
    }

    await secrets.set(category, name, entry)
    output.log(`\n  Stored ${category}/${name} (${type})\n`)

    return CommandResult.success()
  }
}
