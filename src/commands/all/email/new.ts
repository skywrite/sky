import * as path from 'node:path'
import { validateAnyArgFlagExists } from '#commands/cli/mod.ts'
import { ArgOrFlag, category, Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DayDirFileWriter, messageFileName } from '#lib/nbfs/mod.ts'
import { atomicWrite } from '#lib/outbox/files.ts'
import openEditor from '#lib/shell/openEditor.ts'
import slugify from '#lib/string/slugify.ts'
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
  threadId: Flag.string('Gmail thread ID (decimal, also used by IMAP)', { hidden: true }),
  follow: Flag.string('Follow file name', { hidden: true }),
  previous: Flag.string('Previous message ref', { hidden: true }),
  tags: Flag.string('Tags to propagate from previous message', { hidden: true }),
  rel: Flag.string('Related reference to propagate from previous message', { hidden: true }),
  noEditor: Flag.bool('Skip opening editor', { hidden: true }),
  when: whenNBTime(),
  category: category(),
}

type Params = InferParams<typeof params>
type Result = { filePath: string }

export default class EmailNewTask extends Command {
  static override description: CommandDescription = {
    name: 'email:new',
    description: 'Create new Email.',
    params,
    postProcess: [validateAnyArgFlagExists('to', 'from')],
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const {
      from,
      to,
      cc,
      bcc,
      when,
      summary,
      subject,
      category,
      markdown,
      threadId,
      follow,
      previous,
      tags,
      rel,
      noEditor,
    } = args

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

    const baseKey = `${when.time} > ${who} Email`

    // /Now captures share a minute. Only a matching thread (or an older
    // capture's follow ID) proves this is a re-capture; an unknown identity
    // must keep its own slot, even when the subject and participants agree.
    let dayDoc = await readDay(whenDate)
    let key = baseKey
    let existing = dayDoc.getCompleteItem(key, category)
    let existingDoc: EmailDocument | undefined
    let suffix = 2
    while (existing) {
      try {
        existingDoc = EmailDocument.fromMarkdown(await readTextFile(path.join(ddfw.fullDir, existing.path)))
      } catch {
        // An unreadable capture cannot establish identity.
      }
      const oldThreadId = existingDoc?.yaml['threadId']
      const sameCapture =
        threadId && typeof oldThreadId === 'string'
          ? threadId === oldThreadId
          : !!follow && follow === existingDoc?.yaml['follow']
      if (sameCapture) break
      existingDoc = undefined
      key = `${baseKey} (${suffix++})`
      existing = dayDoc.getCompleteItem(key, category)
    }

    const email = new EmailDocument({
      ...existingDoc?.yaml,
      from,
      ...(to ? { to } : {}),
      ...(cc ? { cc } : {}),
      ...(bcc ? { bcc } : {}),
      when,
      subject,
      summary,
      ...(threadId ? { threadId } : {}),
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
      if (existing) {
        // Keep follow references stable and leave the saved file intact if writing fails.
        filePath = existing.path
        await atomicWrite(path.join(ddfw.fullDir, filePath), data.trimStart())
      } else {
        filePath = await ddfw.write(fileName, data.trimStart())
      }
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
