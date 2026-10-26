/**
 * notion:find — search the connected Notion workspace, as the person who
 * signed in sees it. Auto-approved in ai:chat: a search changes nothing.
 */

import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { Arg, Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { NOTION_NOT_CONNECTED, type NotionMatch, NotionError, type NotionSearch, openNotion } from '#lib/notion/mod.ts'

const params = {
  query: Arg.string('Words to look for in page titles and content'),
}

type Params = InferParams<typeof params>
type Result = {
  query: string
  workspace?: string
  /** What matched, when Notion's answer reads as expected */
  matches?: NotionMatch[]
  /** Notion's answer as it came, when it does not */
  content?: string
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'notion:find': { params: Params; result: Result }
  }
}

/** One match per line: title, kind, where it sits, when it changed, and its link. */
function matchLine(match: NotionMatch): string {
  const where = match.path ? `  ${match.path}` : ''
  const edited = match.edited ? `  ${match.edited.slice(0, 10)}` : ''
  return `${match.title}  [${match.type ?? 'page'}]${where}${edited}  ${match.url ?? match.id ?? ''}`.trimEnd()
}

@AIChatTool({ needsApproval: false })
export default class NotionFindTask extends Command {
  static override description: CommandDescription = {
    name: 'notion:find',
    description:
      'Search the connected Notion workspace for pages and databases, by words in their titles and content, as ' +
      'the person who signed in sees it. Returns the matches with their titles, links, ids, where each sits and ' +
      'the words around the match; read one with notion:read. Reads only.',
    usage: ['sky notion:find "launch plan"'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const query = args.query?.trim()
    if (!query) return CommandResult.fail('Say what to look for in Notion.')

    const notion = await openNotion(context.secrets, context.signal ? { signal: context.signal } : {})
    if (!notion) return CommandResult.fail(NOTION_NOT_CONNECTED)

    let found: NotionSearch
    try {
      found = await notion.search(query)
    } catch (error) {
      if (error instanceof NotionError) return CommandResult.fail(error.message)
      throw error
    }

    const workspace = notion.workspace ? { workspace: notion.workspace } : {}
    if ('text' in found) {
      context.output.log(found.text)
      return CommandResult.success({ query, ...workspace, content: found.text })
    }
    if (found.matches.length === 0) context.output.log(`Nothing in Notion matches “${query}”.`)
    for (const match of found.matches) context.output.log(matchLine(match))
    return CommandResult.success({ query, ...workspace, matches: found.matches })
  }
}
