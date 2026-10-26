/**
 * google:email:export — the content of one email (an essay, a newsletter issue) filed as a
 * markdown document in a folder, classified with the same fields as the folder's other documents.
 * Chat reads the email, decides the classification, and exports it here; the words are copied, never rewritten.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { resolveFilePath } from '#commands/lib/chat/fileTools.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { AccountResolutionError, getThread } from '#lib/google/mod.ts'
import slugify from '#lib/string/slugify.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import truncate from '#shared/strings/truncate.ts'
import { Instant } from '#universal/dates/nbdt/mod.ts'
import { accountSwitchNote } from '../lib/resolveClient.ts'
import { emailMarkdown, keepBetween, words } from './lib/emailContent.ts'
import { findOwningGmailClient } from './lib/resolveGmailClient.ts'

const params = {
  thread: Arg.string('Gmail thread id from google:email:search'),
  directory: Flag.string('Folder to file it in, absolute or ~/path, such as the author’s folder', { required: true }),
  message: Flag.string('The message to export, when the thread has more than one'),
  title: Flag.string('The document’s heading; left out, the email subject'),
  name: Flag.string('File name without .md, in the style of the folder’s other files; left out, made from the title'),
  author: Flag.string('Who wrote it'),
  tags: Flag.string('Topic tags separated by ;, in the style of the folder’s other files, e.g. Topic/Subtopic; Other'),
  cadence: Flag.string('How often to re-read it, in the style of the folder’s other files, e.g. 3 months'),
  importance: Flag.number('1 to 10, in the style of the folder’s other files', {
    optional: true,
    schema: z.coerce.number().int().min(1).max(10),
  }),
  start: Flag.string('The first words of the content to keep; paragraphs before the one holding them are left out'),
  end: Flag.string('The last words of the content to keep; paragraphs after the one holding them are left out'),
  account: Flag.string('Mailbox to try first; use the account from google:email:search', { short: 'a' }),
}

type Params = InferParams<typeof params>

type Result = {
  path: string
  title: string
  threadId: string
  messageId: string
  account: string
  accountNote?: string
  /** The first and last paragraphs kept, so the cut can be checked against the email. */
  begins: string
  ends: string
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:email:export': { params: Params; result: Result }
  }
}

/** A document already in the folder under this heading, so exporting one email twice files it once. */
async function filedAs(directory: string, title: string): Promise<string | undefined> {
  const wanted = words(title)
  const names = await readdir(directory).catch(() => [])
  for (const name of names.filter((entry) => entry.endsWith('.md')).sort()) {
    const file = path.join(directory, name)
    const heading = /^# (.+)$/m.exec(await readFile(file, 'utf8').catch(() => ''))?.[1]
    if (heading && words(heading) === wanted) return file
  }
  return undefined
}

@AIChatTool({ needsApproval: false })
export default class GoogleEmailExport extends Command {
  static override description: CommandDescription = {
    name: 'google:email:export',
    description:
      'Export the content of one email (an essay, a newsletter issue) into a folder as a markdown document: ' +
      'the writer’s own words, copied as written, without the email around them. ' +
      'Before exporting into a folder, list it with list_directory and frontmatter=true to see how its files are named ' +
      'and classified, and read the email with google:email:read. Classify it the same way: pass the fields the ' +
      'folder’s files use (author, tags, cadence, importance) and a name in their style. ' +
      'Pass start and end, the first and last words of the content, to leave out the newsletter’s header and footer. ' +
      'The file’s authored date is the email’s date and created is today. ' +
      'Never overwrites: a taken file name, or a document in the folder with the same heading, is refused and nothing ' +
      'is written. Returns the saved path with the first and last paragraphs kept; check them against the email. ' +
      'Does not change the email in Gmail.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    try {
      context.signal?.throwIfAborted()
      if (typeof args.directory !== 'string' || !args.directory.trim())
        return CommandResult.fail('Pass directory: the folder to file the email in.')
      const directory = resolveFilePath(args.directory, context.env.SKY_USER_CWD ?? context.config.DIR_BASE)
      const found = await findOwningGmailClient({
        secrets: context.secrets,
        requested: args.account,
        what: `Gmail thread ${args.thread}`,
        attempt: (client) => getThread(client, args.thread, { format: 'full' }),
      })
      const messages = found.value
      const message = args.message
        ? messages.find((candidate) => candidate.id === args.message)
        : messages.length === 1
          ? messages[0]
          : undefined
      if (!message) {
        const listed = messages.map((candidate) => `${candidate.id} (${candidate.from?.address ?? 'unknown sender'})`)
        return CommandResult.fail(
          messages.length === 0
            ? `Gmail thread ${args.thread} has no messages.`
            : `${args.message ? `Message ${args.message} is not in` : 'Pass message to choose one message from'} ` +
                `Gmail thread ${args.thread}: ${listed.join(', ')}. Nothing was written.`,
        )
      }

      const kept = keepBetween(emailMarkdown(message), { start: args.start, end: args.end })
      if ('missing' in kept)
        return CommandResult.fail(
          `The ${kept.missing} words were not found in the email’s content${kept.missing === 'end' ? ' after the start' : ''}. ` +
            'Quote words from a single paragraph exactly as google:email:read shows them. Nothing was written.',
        )
      if (!kept.text) return CommandResult.fail('The email has no readable content to export. Nothing was written.')

      const title =
        args.title?.trim() || message.subject?.trim() || truncate(kept.text.split('\n')[0].replace(/^#+\s*/, ''), 80)
      const already = await filedAs(directory, title)
      if (already)
        return CommandResult.fail(`Already filed: ${already} has the heading “${title}”. Nothing was written.`)

      // Named by title like the folder's hand-filed documents, not with a timestamp: the export joins a folder the owner keeps by hand.
      const name =
        slugify((args.name?.trim() || title).replace(/\.md$/i, ''), { preserveCase: true, suggestedLength: 70 }) ||
        'Email'
      const file = path.join(directory, `${name}.md`)
      const authored = message.date
        ? Instant.fromEpochMilliseconds(Number(message.date))
            .toZonedDateTimeISO(context.notebookNow.timezone)
            .toPlainDate()
            .toString()
        : undefined
      const yaml = {
        created: context.notebookNow.date,
        ...(authored ? { authored } : {}),
        ...(args.author?.trim() ? { author: args.author.trim() } : {}),
        ...(args.tags?.trim() ? { tags: TagSet.fromString(args.tags).toString() } : {}),
        ...(args.cadence?.trim() ? { cadence: args.cadence.trim() } : {}),
        ...(args.importance !== undefined ? { importance: args.importance } : {}),
      }
      await mkdir(directory, { recursive: true })
      try {
        await writeFile(file, new Document(yaml, `# ${title}\n\n${kept.text}\n`).toMarkdown(), { flag: 'wx' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        return CommandResult.fail(
          `${file} already exists. Nothing was overwritten. Pass a different name, or skip it if it is the same piece.`,
        )
      }

      const paragraphs = kept.text.split(/\n\s*\n/)
      const accountNote = accountSwitchNote(found)
      output.log(`Exported “${title}” → ${file}`)
      return CommandResult.success({
        path: file,
        title,
        threadId: args.thread,
        messageId: message.id,
        account: found.client.email,
        ...(accountNote ? { accountNote } : {}),
        begins: truncate(paragraphs[0], 200),
        ends: truncate(paragraphs.at(-1)!, 200),
      })
    } catch (error) {
      if (error instanceof AccountResolutionError) return CommandResult.fail(error.message)
      return CommandResult.error(error instanceof Error ? error : new Error(String(error)), 'Gmail export failed')
    }
  }
}
