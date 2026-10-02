import { randomUUID } from 'node:crypto'
import { readFile, stat, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { CommandResult } from '#commands/mod.ts'
import { createDayFile } from '#lib/nbfs/createDayFile.ts'
import { insertBlock } from '#lib/nbfs/listBlocks.ts'
import { ensureDay } from '#lib/nbfs/mod.ts'
import withDayWrite from '#lib/nbfs/withDayWrite.ts'
import { withMarkdownWrite } from '#lib/nbfs/withMarkdownWrite.ts'
import { copyFileDedup, copyToDayAttachments } from '#lib/notebook/attachments.ts'
import { imageCreationStamp, imageFileName, imageSummary } from '#lib/notebook/imageName.ts'
import { atomicWrite, readOptional, withLock } from '#lib/outbox/files.ts'
import slugify from '#lib/string/slugify.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { actionKindRel, dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { Instant, instantNow, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { documentTitle, documentWorkWhen, isNoteDocument, isNoteImage } from './documentInput.ts'

interface DocumentNoteOptions {
  source: string | string[]
  summary?: string
  when: string
  body?: string
  tags?: string
  category: string
  /** An import job's identity makes retries idempotent; it is not the content's filename. */
  run?: string
  config: { DIR_BASE: string; DIR_TIME: string; DIR_ATTACHMENTS: string; DIR_USER_DATA: string; DIR_STATE: string }
  signal?: AbortSignal
  stage: (id: string, label: string) => void
  summarize: (file: string) => Promise<string>
  /** Image notes preserve the text and structure instead of summarizing it. */
  transcribe?: (files: string[]) => Promise<{ title: string; body: string }>
  enrich: (input: { summary: string; body: string }) => Promise<{ tags?: string; rel?: string[] }>
}

interface Capture {
  filePath: string
  initial: string
  attachment: string
  attachments?: string[]
  images?: boolean
  ownsImages?: boolean
  imageTitle?: string
  imageName?: string
  imageStamp?: string
  imageRenames?: { from: string; to: string }[]
  when: string
  title: string
  category: string
  created: boolean
  summary?: string
  enriched?: { tags?: string; rel?: string[] }
}

const SUMMARY_MARKER = '<!-- sky:attachment-summary -->'

/** Save first, then read the attachment. Retries reuse the note and preserve edits made while AI was working. */
export async function notesFromDocument(options: DocumentNoteOptions): Promise<CommandResult<{ filePath: string }>> {
  let sources = typeof options.source === 'string' ? [options.source] : options.source
  const images = sources.length > 0 && sources.every(isNoteImage)
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
          if (!images && (sources.length !== 1 || !isNoteDocument(sources[0])))
            throw new Error('Choose images, a PDF, Word document, presentation, spreadsheet, or Markdown file.')
          if (images && !options.transcribe) throw new Error('Image text extraction is unavailable.')
          if (images && sources.length > 1) {
            const ordered = await Promise.all(
              sources.map(async (file) => ({ file, mtime: (await stat(file)).mtimeMs })),
            )
            sources = ordered.sort((a, b) => a.mtime - b.mtime).map(({ file }) => file)
          }
          const when = documentWorkWhen(options.when)
          const title = (options.summary ?? documentTitle(path.basename(sources[0]))).trim()
          if (!title || /[\r\n]/.test(title)) throw new Error('Enter a title in one line.')
          options.stage('save', 'Saving the note and attachment')
          const copied = await Promise.all(
            sources.map(async (source) => {
              const attachment = await copyToDayAttachments({
                sourcePath: source,
                attachmentsRoot: options.config.DIR_ATTACHMENTS,
                day: when.datetime.plainDate,
                fileName: path.basename(source),
                unique: images,
              })
              if (!attachment) throw new Error(`${path.basename(source)} could not be found.`)
              return attachment
            }),
          )
          const created = Instant.from(instantNow())
            .toZonedDateTimeISO(ZonedDateTime.now().timezone)
            .toPlainDateTime()
            .toString({ smallestUnit: 'second' })
          const stamp = created.replace('T', '_').replaceAll(':', '')
          const slug = slugify(title, { preserveCase: true, suggestedLength: 70 }) || 'Document'
          const initial = new Document(
            {
              summary: title,
              when: when.toString(),
              type: 'Notes',
              ...(options.tags ? { tags: TagSet.fromString(options.tags).toString() } : {}),
              attachments: copied.map((item) => item.attachment),
            },
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
            attachment: copied[0].path,
            attachments: copied.map((item) => item.path),
            images,
            ownsImages: images,
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
          options.stage('summary', capture.images ? 'Reading the image text' : 'Summarizing the attachment')
          if (capture.images) {
            const read = await options.transcribe!(capture.attachments ?? [capture.attachment])
            capture.summary = read.body.trim()
            capture.imageTitle = read.title
          } else capture.summary = (await options.summarize(capture.attachment)).trim()
          if (!capture.summary)
            throw new Error(
              capture.images ? 'No image text was returned. Try again.' : 'The summary was empty. Try again.',
            )
          await persist()
        }
        if (capture.images && !capture.imageRenames) {
          capture.imageName ??= await imageSummary(capture.imageTitle ?? '', capture.summary, {
            signal: options.signal,
          })
          capture.imageStamp ??=
            path.basename(capture.filePath).match(/^\d{4}-\d{2}-\d{2}_\d{6}/)?.[0] ?? imageCreationStamp()
          await persist()
          const files = capture.attachments ?? [capture.attachment]
          const renamed: { from: string; to: string }[] = []
          for (const [index, file] of files.entries()) {
            const name = await copyFileDedup(
              file,
              path.dirname(file),
              imageFileName(
                capture.imageStamp,
                capture.imageName,
                path.extname(file),
                files.length > 1 ? index + 1 : undefined,
              ),
            )
            if (!name) throw new Error(`${path.basename(file)} could not be found.`)
            renamed.push({ from: file, to: path.join(path.dirname(file), name) })
          }
          capture.imageRenames = renamed
          capture.attachments = renamed.map(({ to }) => to)
          capture.attachment = capture.attachments[0]
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
        const { filePath, imageRenames, images: imageCapture, summary: capturedText, enriched } = capture
        await withMarkdownWrite(filePath, async () => {
          const current = Document.fromMarkdown(await readFile(filePath, 'utf8'))
          const renamed = new Map(imageRenames?.map(({ from, to }) => [path.basename(from), path.basename(to)]))
          const originalAttachments = current.yaml.attachments
          const attachments = Array.isArray(originalAttachments)
            ? originalAttachments.map((attachment) =>
                attachment && typeof attachment === 'object' && typeof attachment.file === 'string'
                  ? { ...attachment, file: renamed.get(attachment.file) ?? attachment.file }
                  : attachment,
              )
            : originalAttachments
          const named = JSON.stringify(attachments) !== JSON.stringify(originalAttachments)
          if (!current.markdown.includes(SUMMARY_MARKER)) {
            // Image text keeps the captured structure; document summaries have their own heading.
            const summary = imageCapture
              ? capturedText
              : `## Attachment summary\n\n${capturedText.replace(/^# [^\n]*\n+/, '').replace(/^(#{1,5}) /gm, '#$1 ')}`
            const tags = [
              ...current.tags,
              ...(enriched.tags
                ?.split(';')
                .map((tag) => tag.trim())
                .filter(Boolean) ?? []),
            ]
            const rel = [...current.rel, ...(enriched.rel ?? [])]
            const result = new Document(
              {
                ...current.yaml,
                ...(named ? { attachments } : {}),
                tags: [...new Set(tags)].join('; '),
                rel: [...new Set(rel)],
              },
              `${current.markdown.trimEnd()}\n\n${SUMMARY_MARKER}\n${summary}\n`,
            )
            await atomicWrite(filePath, result.toMarkdown())
          } else if (named) {
            await atomicWrite(filePath, new Document({ ...current.yaml, attachments }, current.markdown).toMarkdown())
          }
        })
        if (capture.ownsImages) {
          for (const renamed of capture.imageRenames ?? []) {
            if (renamed.from !== renamed.to)
              await unlink(renamed.from).catch((error) => {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
              })
          }
        }
        return CommandResult.success({ filePath: capture.filePath })
      },
      false,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return CommandResult.fail(
      savedFile
        ? `Your note and ${images && sources.length > 1 ? 'attachments' : 'attachment'} are saved. ${images ? 'Reading the image text' : 'The summary'} did not finish: ${message}`
        : message,
      savedFile ? { filePath: savedFile } : undefined,
    )
  }
}
