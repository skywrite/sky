/**
 * ai:voice:audition — hear every voice say one passage.
 *
 * The audition lives on the web, at /voice/audition — a page the sidebar
 * does not link: a textarea with the passage, the voices by group, each
 * playing through a receive-only call of its own. This command opens it,
 * carrying an optional passage along; the service does the rest.
 */

import open from 'open'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  passage: Flag.string('The passage every voice says (default: the greeting shape, with your name)', {
    short: 'p',
    optional: true,
  }),
  noOpen: Flag.bool('Print the URL instead of opening the browser', { default: false }),
}

type Params = InferParams<typeof params>

type Result = { url: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ai:voice:audition': { params: Params; result: Result }
  }
}

/** The audition page for a passage; no passage means the page's default. */
export function auditionUrl(port: number, passage?: string): string {
  const url = new URL(`http://localhost:${port}/voice/audition`)
  const trimmed = passage?.trim()
  if (trimmed) url.searchParams.set('passage', trimmed)
  return url.toString()
}

export default class AiVoiceAuditionTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:voice:audition',
    description: 'Hear every Realtime voice say one passage, on the web — the pick is by ear.',
    params,
  }

  run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const url = auditionUrl(config.PORT_SERVER as number, args.passage)
    output.log(`Audition: ${url}`)
    if (!args.noOpen) {
      // A browser that will not open is not a failure — the URL is on screen.
      open(url).catch(() => undefined)
    }
    return Promise.resolve(CommandResult.success({ url }))
  }
}
