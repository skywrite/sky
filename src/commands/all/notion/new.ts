/**
 * notion:new — make a page in the connected Notion workspace: private, under
 * a page, at the top of a teamspace, or as a row in a table. In ai:chat it
 * asks first, and the card shows the page as it will be made.
 */

import colors from 'picocolors'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { NOTION_NOT_CONNECTED, NotionError, openNotion } from '#lib/notion/mod.ts'
import { columnsOf } from './lib/columns.ts'
import { placeFor } from './lib/place.ts'

const params = {
  title: Arg.string('The page’s title; for a row, the table’s title column'),
  content: Flag.string('The page’s body in Notion’s Markdown'),
  parent: Flag.string(
    'Where it goes: a Notion page’s link or id (a sub-page), a table’s link (a row), or a teamspace’s name (at its ' +
      'top). Left out, a private page',
  ),
  icon: Flag.string('An emoji for the page, like 🚀'),
  properties: Flag.string(
    'For a row: its other columns as JSON, column name to value, in the forms notion_read shows for the table — ' +
      'a date column Due as {"date:Due:start": "2026-11-01"}, a checkbox as true or false, a number as a number',
  ),
}

type Params = InferParams<typeof params>
type Result = {
  report: string
  url?: string
  /** External files this call concerned — the chat host records them on the transcript. */
  files: Array<{ title: string; url: string }>
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'notion:new': { params: Params; result: Result }
  }
}

@AIChatTool({ needsApproval: true })
export default class NotionNewTask extends Command {
  static override description: CommandDescription = {
    name: 'notion:new',
    description:
      'Create a page in the connected Notion workspace: a private page, a sub-page, a page at the top of a ' +
      'teamspace, or a row in a table. The user approves it first. `parent` takes a page’s link or id, a table’s ' +
      'link (the page becomes a row: read the table with notion:read first for its columns, and give them in ' +
      '`properties`), or a teamspace’s name; left out, the page is private. `content` is Markdown — headings, ' +
      'lists, to-dos, quotes, tables, code — and for Notion’s own blocks (callouts, toggles, tabs, columns, colors) ' +
      'its markup, which notion:read returns for notion://docs/notion-flavored-markdown-spec. Never repeat the ' +
      'title in the content. Returns the new page’s link.',
    usage: [
      'sky notion:new "Atlas launch plan" --content "## Goals\n\n- Ship in March"',
      'sky notion:new "Kickoff notes" --parent <page-link>',
      'sky notion:new "Hiring plan" --parent "Engineering"',
      'sky notion:new "Atlas" --parent <table-link> --properties \'{"Status": "Done"}\'',
    ],
    params,
  }

  static formatApproval(input: Record<string, unknown>, output: OutputHandler): void {
    const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string).trim() : '')
    const columns = text('properties') ? columnsOf(text('properties')) : {}
    output.log('')
    output.log(colors.bold('Create this Notion page?'))
    output.log('')
    output.log(`  Title: ${text('title')}`)
    output.log(`  In:    ${text('parent') || 'your private pages, where only you can see it'}`)
    if (text('icon')) output.log(`  Icon:  ${text('icon')}`)
    if (typeof columns === 'string') output.log(`  Properties: ${text('properties')}`)
    else for (const [name, value] of Object.entries(columns)) output.log(`  ${name}: ${JSON.stringify(value)}`)
    if (text('content')) {
      output.log('')
      output.log(colors.dim('---'))
      output.log(text('content').replace(/^/gm, '  '))
      output.log(colors.dim('---'))
    }
    output.log('')
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const title = args.title?.trim()
    if (!title) return CommandResult.fail('Give the new page a title.')
    const columns = args.properties?.trim() ? columnsOf(args.properties) : {}
    if (typeof columns === 'string') return CommandResult.fail(columns)

    const notion = await openNotion(context.secrets, context.signal ? { signal: context.signal } : {})
    if (!notion) return CommandResult.fail(NOTION_NOT_CONNECTED)

    try {
      const place = await placeFor(notion, args.parent)
      if (typeof place === 'string') return CommandResult.fail(place)
      const row = Boolean(place.parent && 'dataSource' in place.parent)
      if (!row && Object.keys(columns).length > 0)
        return CommandResult.fail(`Only a row in a table takes properties, and this page would go ${place.where}.`)

      const content = args.content?.trim()
      const icon = args.icon?.trim()
      const [made] = await notion.createPages(
        [
          {
            properties: { ...columns, [place.titleColumn ?? 'title']: title },
            ...(content ? { content } : {}),
            ...(icon ? { icon } : {}),
          },
        ],
        place.parent,
      )
      const url = made?.url
      const report = `Created “${title}” ${place.where}${url ? `: ${url}` : '. Notion did not send its link.'}`
      context.output.log(report)
      return CommandResult.success({ report, ...(url ? { url } : {}), files: url ? [{ title, url }] : [] })
    } catch (error) {
      if (error instanceof NotionError) return CommandResult.fail(error.message)
      throw error
    }
  }
}
