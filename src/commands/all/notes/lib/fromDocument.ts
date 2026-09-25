import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { CommandResult } from '#commands/mod.ts'
import { createDayFile } from '#lib/nbfs/createDayFile.ts'
import { insertBlock } from '#lib/nbfs/listBlocks.ts'
import { ensureDay } from '#lib/nbfs/mod.ts'
import withDayWrite from '#lib/nbfs/withDayWrite.ts'
import { copyToDayAttachments } from '#lib/notebook/attachments.ts'
import { atomicWrite, readOptional, withLock } from '#lib/outbox/files.ts'
import slugify from '#lib/string/slugify.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { actionKindRel, dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { Instant, instantNow, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { documentActivity, documentWorkWhen, isNoteDocument } from './documentInput.ts'

interface DocumentNoteOptions {
  source: string
  summary?: string
  when: string
  body?: string
  category: string
  /** An import job's identity makes retries idempotent; it is not the content's filename. */
  run?: string
  config: { DIR_BASE: string; DIR_TIME: string; DIR_ATTACHMENTS: string; DIR_USER_DATA: string; DIR_STATE: string }
  signal?: AbortSignal
  stage: (id: string, label: string) => void
  summarize: (file: string) => Promise<string>
  enrich: (input: { summary: string; body: string }) => Promise<{ tags?: string; rel?: string[] }>
}

interface Capture {
  filePath: string
  initial: string
  attachment: string
  when: string
  title: string
  category: string
  created: boolean
  summary?: string
  enriched?: { tags?: string; rel?: string[] }
}

const SUMMARY_MARKER = '<!-- sky:attachment-summary -->'

/** Save first, then summarize. A retry appends to the same note and preserves edits made while AI was working. */
export async function notesFromDocument(options: DocumentNoteOptions): Promise<CommandResult<{ filePath: string }>> {
  const run = options.run ?? randomUUID()
  if (!/^[a-zA-Z0-9-]+$/.test(run)) return CommandResult.fail('Invalid note import identity.')
  const stateFile = path.join(options.config.DIR_USER_DATA, 'note-imports', `${run}.json`)
  let savedFile: string | undefined
  try {
    return await withLock(
      `${stateFile}.lock`,
      async () => {
        options.signal?.throwIfAborted()
        const previous = await readOptional(stateFile)
        let capture = previous ? (JSON.parse(previous) as Capture) : null
        if (!capture) {
          if (!isNoteDocument(options.source))
            throw new Error('Choose a PDF, Word document, presentation, spreadsheet, or Markdown file.')
          const when = documentWorkWhen(options.when)
          const title = (options.summary ?? documentActivity(path.basename(options.source))).trim()
          if (!title || /[\r\n]/.test(title)) throw new Error('Describe the work in one line.')
          options.stage('save', 'Saving the note and attachment')
          const copied = await copyToDayAttachments({
            sourcePath: options.source,
            attachmentsRoot: options.config.DIR_ATTACHMENTS,
            day: when.datetime.plainDate,
            fileName: path.basename(options.source),
          })
          if (!copied) throw new Error('The document could not be found.')
          const created = Instant.from(instantNow())
            .toZonedDateTimeISO(ZonedDateTime.now().timezone)
            .toPlainDateTime()
            .toString({ smallestUnit: 'second' })
          const stamp = created.replace('T', '_').replaceAll(':', '')
          const slug = slugify(title, { preserveCase: true, suggestedLength: 70 }) || 'Document-work'
          const initial = new Document(
            { summary: title, when: when.toString(), type: 'Notes', attachments: [copied.attachment] },
            // The hidden import identity distinguishes independent identical captures during crash recovery.
            `# ${title}\n\n<!-- sky:note-import:${run} -->\n\n${options.body?.trim() ? `${options.body.trim()}\n` : ''}`,
          ).toMarkdown()
          capture = {
            filePath: path.join(
              options.config.DIR_TIME,
              dayDir(when.datetime.plainDate),
              actionKindRel('note'),
              `${stamp}_${slug}.md`,
            ),
            initial,
            attachment: copied.path,
            when: when.toString(),
            title,
            category: options.category,
            created: false,
          }
          await atomicWrite(stateFile, JSON.stringify(capture))
        }
        const persist = () => atomicWrite(stateFile, JSON.stringify(capture))
        if (!capture.created) {
          const base = capture.filePath.replace(/\.md$/, '')
          let suffix = 2
          while (!(await createDayFile(capture.filePath, capture.initial))) {
            // A restart after publishing must also recognize a note the person has since edited.
            if ((await readOptional(capture.filePath))?.includes(`<!-- sky:note-import:${run} -->`)) break
            capture.filePath = `${base}-${suffix++}.md`
            await persist()
          }
          capture.created = true
          await persist()
        }
        savedFile = capture.filePath
        const when = documentWorkWhen(capture.when)
        const day = when.datetime.plainDate
        const relative = path.relative(path.join(options.config.DIR_TIME, dayDir(day)), capture.filePath)
        await withDayWrite(options.config, day.toString(), async () => {
          await ensureDay(day, options.config.DIR_TIME)
          const dayText = await readFile(path.join(options.config.DIR_TIME, dayFile(day)), 'utf8')
          if (!dayText.includes(`](${relative})`)) {
            const label = capture.title.replace(/[\\[\]]/g, '\\$&')
            await atomicWrite(
              path.join(options.config.DIR_TIME, dayFile(day)),
              insertBlock(dayText, capture.category, `- ${capture.when.slice(11)} > Notes -> [${label}](${relative})`),
            )
          }
        })
        // Read before calling AI: a deleted note must not be silently recreated on retry.
        await readFile(capture.filePath, 'utf8')
        if (!capture.summary) {
          options.signal?.throwIfAborted()
          options.stage('summary', 'Summarizing the attachment')
          capture.summary = (await options.summarize(capture.attachment)).trim()
          if (!capture.summary) throw new Error('The summary was empty. Try again.')
          await persist()
        }
        if (!capture.enriched) {
          options.signal?.throwIfAborted()
          options.stage('tags', 'Adding tags and links')
          capture.enriched = await options.enrich({
            summary: capture.title,
            body: `${Document.fromMarkdown(capture.initial).markdown}\n\n${capture.summary}`,
          })
          await persist()
        }
        options.signal?.throwIfAborted()
        const current = Document.fromMarkdown(await readFile(capture.filePath, 'utf8'))
        if (!current.markdown.includes(SUMMARY_MARKER)) {
          // The summary is nested below its own heading; the person's note remains untouched.
          const summary = capture.summary.replace(/^# [^\n]*\n+/, '').replace(/^(#{1,5}) /gm, '#$1 ')
          const tags = [
            ...current.tags,
            ...(capture.enriched.tags
              ?.split(';')
              .map((tag) => tag.trim())
              .filter(Boolean) ?? []),
          ]
          const rel = [...current.rel, ...(capture.enriched.rel ?? [])]
          const result = new Document(
            { ...current.yaml, tags: [...new Set(tags)].join('; '), rel: [...new Set(rel)] },
            `${current.markdown.trimEnd()}\n\n${SUMMARY_MARKER}\n## Attachment summary\n\n${summary}\n`,
          )
          await atomicWrite(capture.filePath, result.toMarkdown())
        }
        return CommandResult.success({ filePath: capture.filePath })
      },
      false,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return CommandResult.fail(
      savedFile ? `Your note and attachment are saved. The summary did not finish: ${message}` : message,
      savedFile ? { filePath: savedFile } : undefined,
    )
  }
}
