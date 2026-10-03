import { Arg, Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { addExtension } from '#lib/extensions/mod.ts'

const params = {
  folder: Arg.string('The extension folder on this Mac'),
}

type Params = InferParams<typeof params>
type Result = { id: string; dir: string; commands: string[] }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'extensions:add': { params: Params; result: Result }
  }
}

export default class ExtensionsAddTask extends Command {
  static override description: CommandDescription = {
    name: 'extensions:add',
    description: 'Install an extension from a folder.',
    descriptionLong: [
      'Checks the folder’s package.json as an extension manifest, links the',
      'folder into ~/.sky/extensions/<author>/<name>, installs its',
      'dependencies, and rebuilds the command manifest. The extension’s',
      'commands answer at once, each under its own name as prefix.',
    ],
    usage: ['sky extensions:add ~/code/sky-extensions/extensions/skywrite/hubspot'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const outcome = await addExtension(args.folder)
    if (!outcome.added) return CommandResult.fail(outcome.reason)
    output.log(`Installed ${outcome.id} from ${outcome.dir}`)
    if (outcome.commands.length) {
      output.log('Commands:')
      for (const name of outcome.commands) output.log(`  sky ${name}`)
    } else {
      output.log('It has no commands.')
    }
    return CommandResult.success({ id: outcome.id, dir: outcome.dir, commands: outcome.commands })
  }
}
