import { Arg, Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { getManifest } from './_commandsManifest.ts'

const params = {
  command: Arg.string('Command to extract flags from'),
}

type Params = InferParams<typeof params>

export default class CliFlagsTask extends Command {
  static override description: CommandDescription = {
    name: 'cli:flags',
    description: 'Extract flags for zshell completion',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { output } = context
    const { command } = args

    const manifest = await getManifest()
    const all = [...manifest.commands.core, ...manifest.commands.local, ...manifest.commands.global]
    const entry = all.find((c) => c.name === command)

    if (!entry) return CommandResult.error(`Command '${command}' not found in manifest`)

    // Universal help flags
    output.log('-h: Show help|bool')
    output.log('--help: Show help|bool')

    for (const flag of entry.flags) {
      if (flag.kind !== 'flag' && flag.kind !== 'arg-or-flag') continue
      const isBoolStr = flag.type === 'bool' ? 'bool' : 'non-bool'
      output.log(`--${flag.name}: ${flag.description}|${isBoolStr}`)
      if (flag.short) {
        output.log(`-${flag.short}: ${flag.description}|${isBoolStr}`)
      }
    }

    return CommandResult.success()
  }
}
