import { unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { validateAnyArgFlagExists } from '#commands/cli/mod.ts'
import { ArgOrFlag, category, Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DayDirFileWriter, messageFileName } from '#lib/nbfs/mod.ts'
import openEditor from '#lib/shell/openEditor.ts'
import slugify from '#lib/string/slugify.ts'
import { MCPTool } from '#mcp/decorators.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import EmailDocument from '#shared/models/Email/mod.ts'
import { readDay, writeDay } from '#shared/nbfs/mod.ts'

const params = {
  to: ArgOrFlag.string('Person'),
  from: Flag.string('Person'),
  cc: Flag.string('Person'),
  bcc: Flag.string('Person'),
  subject: Flag.string('Email subject'),
  summary: Flag.string('Summary of the email'),
  markdown: Flag.string('Markdown content', { hidden: true }),
  follow: Flag.string('Follow file name', { hidden: true }),
  previous: Flag.string('Previous message ref', { hidden: true }),
  tags: Flag.string('Tags to propagate from previous message', { hidden: true }),
  rel: Flag.string('Related reference to propagate from previous message', { hidden: true }),
  noEditor: Flag.boolean('Skip opening editor', { hidden: true }),
  when: whenNBTime(),
  category: category(),
}

type Params = InferParams<typeof params>
type Result = { filePath: string }

@MCPTool()
export default class EmailNewTask extends Command {
  static override description: CommandDescription = {
    name: 'email:new',
    description: 'Create new Email.',
    params,
    postProcess: [validateAnyArgFlagExists('to', 'from')],
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { from, to, cc, bcc, when, summary, subject, category, markdown, follow, previous, tags, rel, noEditor } =
      args

    const whenDate = when.plainDate

    let who = to || from || ''
    if (to && from) {
      who = `${from} to ${to}`
    }

    const whoSlug = slugify(who, { preserveCase: true, suggestedLength: 40 })

    const description = (summary || subject || '') as string

    let fileSlug = whoSlug
    if (description) fileSlug += `_${slugify(description, { suggestedLength: 40, preserveCase: true })}`

    const fileName = messageFileName(when, 'email', fileSlug)

    const ddfw = new DayDirFileWriter(whenDate)

    // Build the key for matching existing items
    const key = `${when.time} > ${who} Email`

    // Check for existing item and delete old file if found
    let dayDoc = await readDay(whenDate)
    const existing = dayDoc.getCompleteItem(key, category)

    // Preserve all user-curated YAML fields from existing file, then overwrite system-generated ones
    let preservedYaml: Record<string, unknown> = {}
    if (existing) {
      try {
        const oldFilePath = path.join(ddfw.fullDir, existing.path)
        const oldContents = await readTextFile(oldFilePath)
        const oldDoc = EmailDocument.fromMarkdown(oldContents)
        preservedYaml = { ...oldDoc.yaml }
        await unlink(oldFilePath)
        output.log(`  Replacing existing Email entry (deleted ${existing.path})`)
      } catch {
        // File may not exist, that's ok
      }
    }

    const email = new EmailDocument({
      ...preservedYaml,
      from,
      ...(to ? { to } : {}),
      ...(cc ? { cc } : {}),
      ...(bcc ? { bcc } : {}),
      when,
      subject,
      summary,
      ...(follow ? { follow } : {}),
      ...(previous ? { previous } : {}),
      ...(tags ? { tags } : {}),
      ...(rel ? { rel } : {}),
    })
    let data = email.toMarkdown()

    if (markdown) {
      data += markdown
    }

    let filePath: string
    try {
      filePath = await ddfw.write(fileName, data.trimStart())
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to write email file')
    }

    // Add or replace entry in Day
    try {
      const entrySubject = subject || summary || ''
      const value = `[${entrySubject}](${filePath})`
      dayDoc = dayDoc.setCompleteItem(key, value, { time: when.time, category })
      await writeDay(dayDoc)
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to write day item')
    }

    if (!noEditor) {
      await openEditor([{ file: path.join(ddfw.fullDir, filePath), line: data.split('\n').length }])
    }

    output.log(`\n  Successfully created ${filePath}.\n`)

    return CommandResult.success({ filePath })
  }
}
