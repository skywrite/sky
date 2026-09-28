import { Arg, Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { removeExtension } from '#lib/extensions/mod.ts'

const params = {
  extension: Arg.string('The extension: author/name, or the name alone when only one has it'),
}

type Params = InferParams<typeof params>
type Result = { id: string; dir: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'extensions:remove': { params: Params; result: Result }
  }
}

export default class ExtensionsRemoveTask extends Command {
  static override description: CommandDescription = {
    name: 'extensions:remove',
    description: 'Uninstall an extension. Its folder stays where it was.',
    usage: ['sky extensions:remove skywrite/hubspot', 'sky extensions:remove hubspot'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const outcome = await removeExtension(args.extension)
    if (!outcome.removed) return CommandResult.fail(outcome.reason)
    output.log(`Removed ${outcome.id}. Its folder is still at ${outcome.dir}.`)
    return CommandResult.success({ id: outcome.id, dir: outcome.dir })
  }
}
