/**
 * notion:table:new — make a table (a Notion database) on a page or as a
 * private one, with its first rows if given. In ai:chat it asks first.
 */

import colors from 'picocolors'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { NOTION_NOT_CONNECTED, NotionError, openNotion } from '#lib/notion/mod.ts'
import { rowsOf, schemaOf } from '../lib/columns.ts'
import { isNotionRef } from '../lib/place.ts'

/** Notion takes at most this many pages in one call. */
const ROWS_PER_CALL = 100

const params = {
  title: Arg.string('The table’s title'),
  columns: Flag.string(
    'Its columns, comma-separated, in Notion’s column syntax: "Name" TITLE, "Status" SELECT(\'Todo\':gray, ' +
      '\'Done\':green), "Due" DATE, "Points" NUMBER. Left out, a Name column alone',
  ),
  rows: Flag.string(
    'Rows to add, as a JSON list with one object per row, column name to value: [{"Name": "Atlas", "Status": ' +
      '"Todo", "date:Due:start": "2026-11-01", "Points": 3}]',
  ),
  parent: Flag.string('The link or id of the Notion page to put the table on. Left out, a private table'),
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
    'notion:table:new': { params: Params; result: Result }
  }
}

@AIChatTool({ needsApproval: true })
export default class NotionTableNewTask extends Command {
  static override description: CommandDescription = {
    name: 'notion:table:new',
    description:
      'Create a table (a Notion database) in the connected Notion workspace, on a page or as a private table, ' +
      'with its first rows if given. The user approves it first. `columns` uses Notion’s column syntax: the title ' +
      "column as TITLE, then RICH_TEXT, NUMBER [FORMAT 'dollar'], SELECT('opt':color, …), MULTI_SELECT(…), " +
      "STATUS(…), DATE, PEOPLE, CHECKBOX, URL, EMAIL, PHONE_NUMBER, FORMULA('expression'). In `rows`, a date " +
      'column Due takes "date:Due:start", a checkbox true or false. A table goes on a page, not at the top of a ' +
      'teamspace: for one there, create the page with notion:new first. To add rows later, use notion:new with ' +
      'the table’s link. Returns the table’s link.',
    usage: [
      'sky notion:table:new "Q3 metrics" --columns \'"Metric" TITLE, "Target" NUMBER, "Owner" PEOPLE\'',
      'sky notion:table:new "Atlas tasks" --parent <page-link> --rows \'[{"Name": "Draft the brief"}]\'',
    ],
    params,
  }

  static formatApproval(input: Record<string, unknown>, output: OutputHandler): void {
    const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string).trim() : '')
    const rows = text('rows') ? rowsOf(text('rows')) : []
    output.log('')
    output.log(colors.bold('Create this Notion table?'))
    output.log('')
    output.log(`  Title:   ${text('title')}`)
    output.log(`  In:      ${text('parent') || 'your private pages, where only you can see it'}`)
    output.log(`  Columns: ${text('columns') || '"Name" TITLE'}`)
    if (typeof rows === 'string') output.log(`  Rows:    ${text('rows')}`)
    else if (rows.length > 0) {
      output.log(`  Rows:    ${rows.length}`)
      for (const row of rows) output.log(`    ${JSON.stringify(row)}`)
    }
    output.log('')
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const title = args.title?.trim()
    if (!title) return CommandResult.fail('Give the new table a title.')
    const rows = args.rows?.trim() ? rowsOf(args.rows) : []
    if (typeof rows === 'string') return CommandResult.fail(rows)
    const parent = args.parent?.trim()
    if (parent && !isNotionRef(parent))
      return CommandResult.fail(
        `Give the link or id of the page to put the table on, not “${parent}”. For a table in a teamspace, ` +
          'create a page there with notion:new first, then the table on that page.',
      )

    const notion = await openNotion(context.secrets, context.signal ? { signal: context.signal } : {})
    if (!notion) return CommandResult.fail(NOTION_NOT_CONNECTED)

    try {
      let page: string | undefined
      let where = 'as a private table'
      if (parent) {
        const target = await notion.target(parent)
        if (target.kind !== 'page')
          return CommandResult.fail(
            target.kind === 'table'
              ? `“${target.title ?? 'That link'}” is a table; a new table goes on a page.`
              : 'That link is not a Notion page.',
          )
        page = target.id
        where = `on “${target.title ?? 'the page'}”`
      }

      const table = await notion.createTable(title, schemaOf(args.columns), page)
      const link = table.url ? `: ${table.url}` : ''
      const source = table.dataSource?.id
      if (rows.length > 0 && !source)
        return CommandResult.fail(
          `Created the table “${title}” ${where}${link}. Notion did not say where its rows go, so none were added.`,
        )

      let added = 0
      try {
        for (let at = 0; source && at < rows.length; at += ROWS_PER_CALL) {
          const batch = rows.slice(at, at + ROWS_PER_CALL)
          await notion.createPages(
            batch.map((properties) => ({ properties })),
            { dataSource: source },
          )
          added += batch.length
        }
      } catch (error) {
        if (!(error instanceof NotionError)) throw error
        const kept =
          added > 0 ? `Notion added ${added} of ${rows.length} rows, then refused` : 'Notion refused its rows'
        return CommandResult.fail(`Created the table “${title}” ${where}${link}. ${kept}: ${error.message}`)
      }

      const counted = added > 0 ? ` with ${added} row${added === 1 ? '' : 's'}` : ''
      const report = `Created the table “${title}” ${where}${counted}${link}`
      context.output.log(report)
      return CommandResult.success({
        report,
        ...(table.url ? { url: table.url } : {}),
        files: table.url ? [{ title, url: table.url }] : [],
      })
    } catch (error) {
      if (error instanceof NotionError) return CommandResult.fail(error.message)
      throw error
    }
  }
}
