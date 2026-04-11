import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { buildManifest, updateManifest } from './_commandsManifest.ts'

const params = {
  rebuild: Flag.boolean('Force rebuild the manifest', { default: false }),
  verbose: Flag.boolean('Include descriptions in output', { short: 'v', default: false }),
}

type Params = InferParams<typeof params>

export default class CliCommandsTask extends Command {
  static override description: CommandDescription = {
    name: 'cli:commands',
    description: 'List all commands (rebuilds manifest if stale)',
    params,
  }

  async run({ context, args }: CommandArgs<Params>): Promise<CommandResult> {
    const { output } = context
    const { rebuild, verbose } = args

    const manifest = rebuild ? await buildManifest() : await updateManifest()
    const all = [...manifest.commands.core, ...manifest.commands.local, ...manifest.commands.global]

    for (const cmd of all) {
      if (verbose && cmd.description) {
        output.log(`${cmd.name}\t${cmd.description}`)
      } else {
        output.log(cmd.name)
      }
    }

    return CommandResult.success()
  }
}
