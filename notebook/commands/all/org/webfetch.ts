import { Arg, Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { webFetch } from './_webFetch.ts'

const params = {
  url: Arg.string('Organization website URL', { required: true }),
}

type Params = InferParams<typeof params>

export default class OrgWebFetchTask extends Command {
  static override description: CommandDescription = {
    name: 'org:webfetch',
    description: 'Fetch and analyze organization website',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { output } = context
    const { url } = args

    output.log(`Fetching: ${url}`)

    try {
      const result = await webFetch(url)

      output.log(`\nName: ${result.name}`)
      output.log(`Website: ${result.website}`)
      output.log(`Summary: ${result.summary}`)

      return CommandResult.success({ data: result })
    } catch (error) {
      output.error(`Failed to fetch: ${(error as Error).message}`)
      return CommandResult.error(error as Error)
    }
  }
}
