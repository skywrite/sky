/**
 * notion:read — one page of a Notion page, database or view, in Notion's
 * markup, from the connected workspace. The read half of Notion in ai:chat:
 * auto-approved, so "what does this page say" costs one tool call.
 */

import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { paginateRead } from '#commands/lib/chat/readPage.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { NOTION_NOT_CONNECTED, NotionError, type NotionPage, openNotion } from '#lib/notion/mod.ts'
import { notionLink } from './lib/page.ts'

const params = {
  target: Arg.string('A Notion page, database or view link (app.notion.com, notion.so, notion.site), or its id'),
  offset: Flag.number('Character offset a truncated read said to continue from'),
}

type Params = InferParams<typeof params>
type Result = {
  target: string
  workspace?: string
  title?: string
  url?: string
  /** The pages above it */
  path?: string
  /** When it was last edited, as Notion gives it */
  edited?: string
  content: string
  /** External files this read concerned — the chat host records them on the transcript. */
  files: Array<{ title: string; url: string }>
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'notion:read': { params: Params; result: Result }
  }
}

@AIChatTool({ needsApproval: false })
export default class NotionReadTask extends Command {
  static override description: CommandDescription = {
    name: 'notion:read',
    description:
      'Read a Notion page, database or view by its link or id, in Notion’s markup, from the connected Notion ' +
      'workspace; the result also names its title, link, the pages above it and when it was last edited. Long ' +
      'pages return 40k chars per call — when the content ends with a [Truncated …] marker, call again with the ' +
      'offset it names. A very large page can list blocks Notion did not load; read one by passing its id. Reads ' +
      'only; nothing here changes Notion.',
    usage: ['sky notion:read <notion-link-or-id>', 'sky notion:read <notion-link> --offset 40000'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const target = args.target?.trim()
    if (!target) return CommandResult.fail('Give the Notion link or page id to read.')

    const notion = await openNotion(context.secrets, context.signal ? { signal: context.signal } : {})
    if (!notion) return CommandResult.fail(NOTION_NOT_CONNECTED)

    let read: NotionPage
    try {
      read = await notion.fetch(target)
    } catch (error) {
      if (error instanceof NotionError) return CommandResult.fail(error.message)
      throw error
    }

    const page = paginateRead(read.text, args.offset)
    if (!page)
      return CommandResult.fail(`Offset ${args.offset} is past the end: the page has ${read.text.length} chars.`)

    const { title, path, edited } = read
    const url = read.url ?? notionLink(target)
    context.output.log(page.content)
    return CommandResult.success({
      target,
      ...(notion.workspace ? { workspace: notion.workspace } : {}),
      ...(title ? { title } : {}),
      ...(url ? { url } : {}),
      ...(path ? { path } : {}),
      ...(edited ? { edited } : {}),
      content: page.content,
      files: url ? [{ title: title ?? 'Notion page', url }] : [],
    })
  }
}
