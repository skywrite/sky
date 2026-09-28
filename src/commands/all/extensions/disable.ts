import { Arg, Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { setExtensionEnabled } from '#lib/extensions/mod.ts'

const params = {
  extension: Arg.string('The extension: author/name, or the name alone when only one has it'),
}

type Params = InferParams<typeof params>
type Result = { id: string; enabled: boolean }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'extensions:disable': { params: Params; result: Result }
  }
}

export default class ExtensionsDisableTask extends Command {
  static override description: CommandDescription = {
    name: 'extensions:disable',
    description: 'Switch an installed extension off. Its folder stays; nothing loads from it.',
    usage: ['sky extensions:disable skywrite/hubspot'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const outcome = await setExtensionEnabled(args.extension, false)
    if (!outcome.changed) return CommandResult.fail(outcome.reason)
    context.output.log(`${outcome.id} is off. Reload the web app to drop its screens.`)
    return CommandResult.success({ id: outcome.id, enabled: false })
  }
}
