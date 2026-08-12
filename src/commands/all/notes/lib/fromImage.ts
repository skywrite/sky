import { copyFile, mkdir, stat } from 'node:fs/promises'
import * as path from 'node:path'
import * as p from '@clack/prompts'
import { generateObject } from 'ai'
import colors from 'picocolors'
import { z } from 'zod'
import { CommandResult } from '#commands/mod.ts'
import type { CommandArgs } from '#commands/mod.ts'
import slugify from '#lib/string/slugify.ts'
import { aiModel } from '#shared/ai/models.ts'
import { exists, readTextFile, rename } from '#shared/fs/mod.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { extractTypedTime } from '#universal/dates/extractTypedTime.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { findScreenshotsOnDesktop } from '../../message/_lib/findScreenshotOnDesktop.ts'
import { loadImageForAI } from '../../message/_lib/loadImage.ts'

const EXTRACT_PROMPT_FILE = new URL('../prompts/extract-from-image.prompt.md', import.meta.url).pathname
const CORRECTIONS_PROMPT_FILE = new URL('../prompts/parse-corrections.prompt.md', import.meta.url).pathname

const ExtractionSchema = z.object({
  title: z
    .string()
    .describe(
      'What the note is about, 5-15 words. It becomes the filename, so name the subject rather than the medium.',
    ),
  body: z
    .string()
    .describe(
      "The images transcribed as markdown, starting headings at '##'. Faithful capture of what is written, not a summary of it.",
    ),
  when: z
    .string()
    .nullable()
    .describe(
      'A date or time written in the images, as "YYYY-MM-DD HH:MM" or "YYYY-MM-DD". Null when nothing in the ' +
        'images says when they are from — never fall back to the current date.',
    ),
  rel: z.array(z.string()).describe('People and organizations named in the images. Empty when none are named.'),
  continuityNotes: z
    .string()
    .nullable()
    .describe(
      'Suspected gaps between images or uncertain ordering, in one or two sentences. Null when the images join up cleanly.',
    ),
})

const CorrectionsSchema = z.object({
  summary: z.string().optional().describe('Updated title, only if the user changed it'),
  when: z
    .string()
    .optional()
    .describe(
      'Updated time as "YYYY-MM-DD HH:MM" if the date changed, or just "HH:MM" if only the time changed. ' +
        'Hours are not capped at 23 — copy extended hours like "25:30" through verbatim, never normalized',
    ),
  rel: z
    .array(z.string())
    .optional()
    .describe('The complete replacement list of related people and organizations, only if the user changed it'),
})

export interface ImageNoteExtraction {
  title: string
  body: string
  when: string | null
  rel: string[]
  continuityNotes: string | null
}

export interface NotesFromImageOptions {
  /** Raw `--from-image` value; `'true'` when the flag was given without a path. */
  fromImage: string
  /** `--summary` when the user typed one — it outranks the extracted title. */
  summary?: string
  /** The date/time the note files under before the images get a say. */
  when: PlainDateTime
  /** Whether the user typed `--when`; an explicit one outranks any date in the images. */
  whenExplicit: boolean
  /** `--ai-context`: extra guidance for the extraction. */
  aiContext?: string
  context: CommandArgs['context']
}

export interface ImageNote {
  summary: string
  when: PlainDateTime
  rel: string[]
  body: string
  /** Attachment filenames, empty when the images were left where they were. */
  attachmentFiles: string[]
}

/**
 * Turn one or more images into the makings of a note.
 *
 * The shape follows `message:new --from-image` — resolve images, read them with
 * a vision model, show what came back, take freeform corrections, park the
 * files in the day's attachments — but what the model is asked for is different.
 * A message screenshot is a dialogue with senders; a note image is a whiteboard,
 * a page, or a slide, and what it wants is a faithful transcription under a
 * title. So there is no `from`/`to`/medium here, and the body is markdown the
 * model wrote rather than a rendered dialogue.
 *
 * Writing the note is left to the caller, which shares that path with
 * `--from-audio`.
 */
export async function notesFromImage(options: NotesFromImageOptions): Promise<CommandResult<ImageNote>> {
  const { context, aiContext } = options
  const { output, config } = context

  const resolved = await resolveImagePaths(options.fromImage, output)
  if (!resolved.ok || !resolved.data) return CommandResult.fail(resolved.message ?? 'No images to read')
  const imagePaths = resolved.data

  const label = imagePaths.length === 1 ? 'image' : `${imagePaths.length} images`
  output.log(colors.gray(`Reading ${label}...`))

  let when = options.when
  const extraction = await extractNoteFromImage(imagePaths, {
    aiContext,
    referenceDate: `${when.plainDate}`,
  })

  let summary = options.summary || extraction.title
  let rel = extraction.rel

  // A date written on the page beats the clock: `when` defaults to now, which is
  // when the photo got filed rather than when the note was made. A typed --when
  // is the user saying otherwise, and always wins.
  if (extraction.when && !options.whenExplicit) {
    when = new PlainDateTime(extraction.when.includes(' ') ? extraction.when : `${extraction.when} ${when.time}`)
  }

  output.log(colors.cyan('\n─── Extracted ───'))
  output.log(colors.white(`  Summary:  ${summary}`))
  output.log(colors.white(`  When:     ${when}`))
  output.log(colors.white(`  Related:  ${rel.length > 0 ? rel.join(', ') : '(none)'}`))
  output.log(colors.white(`  Images:   ${imagePaths.length}`))
  output.log(colors.white(`  Length:   ${extraction.body.split('\n').length} lines`))
  if (extraction.continuityNotes) {
    output.log(colors.yellow(`  Notes:    ${extraction.continuityNotes}`))
  }
  output.log(colors.cyan('─────────────────'))

  const corrections = await p.text({
    message: 'Any corrections? (Enter to accept)',
    placeholder: 'e.g. summary: Atlas launch sequencing, when: 14:30, rel: Jane Doe',
  })

  if (p.isCancel(corrections)) {
    p.cancel('Cancelled.')
    return CommandResult.fail('Cancelled')
  }

  if (corrections) {
    output.log(colors.gray('Parsing corrections...'))

    // An explicitly typed `when:` is read here, not by the model — it can't then
    // normalize an extended hour or roll the date forward. Applied before the
    // call so a model failure can't discard it.
    const typedTime = extractTypedTime(corrections)
    if (typedTime) {
      when = new PlainDateTime(typedTime.hasDate ? typedTime.value : `${when.plainDate} ${typedTime.value}`)
    }

    const c = await parseNoteCorrections({ summary, when: when.time, rel, corrections })

    if (c.summary) summary = c.summary
    if (c.rel) rel = c.rel
    if (!typedTime && c.when) {
      // AI may return "HH:MM" or "YYYY-MM-DD HH:MM". Test for a leading date
      // rather than for a hyphen anywhere: a negative hour ("-7:56", valid per
      // docs/nbfs.md) carries one but has no date.
      const hasDate = /^\d{4}-\d{2}-\d{2}\b/.test(c.when)
      when = new PlainDateTime(hasDate ? c.when : `${when.plainDate} ${c.when}`)
    }

    output.log(colors.green('Applied corrections.'))
  }

  const moveLabel = imagePaths.length === 1 ? 'Move image to attachments?' : 'Move images to attachments?'
  const moveConfirm = await p.confirm({ message: moveLabel })

  if (p.isCancel(moveConfirm)) {
    p.cancel('Cancelled.')
    return CommandResult.fail('Cancelled')
  }

  const attachmentFiles = moveConfirm
    ? await stashImages(imagePaths, when, summary, config.DIR_ATTACHMENTS as string, output)
    : []

  return CommandResult.success({
    summary,
    when,
    rel,
    body: demoteBodyHeadings(stripCodeFence(extraction.body)),
    attachmentFiles,
  })
}

/**
 * The images to read: the comma-separated paths given to `--from-image`, or a
 * pick from the Desktop when the flag came without one.
 */
async function resolveImagePaths(
  fromImage: string,
  output: CommandArgs['context']['output'],
): Promise<CommandResult<string[]>> {
  // A valueless --from-image arrives as boolean true at runtime despite the type.
  const hasExplicitPath = typeof fromImage === 'string' && fromImage !== 'true'
  let imagePaths: string[]

  if (hasExplicitPath) {
    imagePaths = fromImage
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => path.resolve(s))
    if (imagePaths.length === 0) {
      return CommandResult.fail('No image path given: --from-image /path/a.png,/path/b.png')
    }
  } else {
    output.log(colors.gray('No image path specified, searching Desktop...'))
    const found = await findScreenshotsOnDesktop()
    if (found.length === 0) {
      return CommandResult.fail('No image found on Desktop. Specify a path: --from-image /path/to/image.png')
    }

    if (found.length === 1) {
      imagePaths = found
      output.log(colors.cyan(`Found: ${path.basename(found[0])}`))
    } else {
      // Hinted with each file's own timestamp rather than an age, so the list
      // reads the same however long it sits open.
      const hints = new Map(
        await Promise.all(
          found.map(async (fp) => {
            const captured = new PlainDateTime((await stat(fp)).mtime)
            return [fp, `${captured.date} ${captured.time}`] as const
          }),
        ),
      )
      const selected = await p.multiselect({
        message: 'Select images to include (space to toggle, enter to confirm)',
        options: found.map((fp) => ({ value: fp, label: path.basename(fp), hint: hints.get(fp) })),
        required: true,
      })

      if (p.isCancel(selected)) {
        p.cancel('Cancelled.')
        return CommandResult.fail('Cancelled')
      }

      imagePaths = selected
    }
  }

  for (const ip of imagePaths) {
    if (!(await exists(ip))) return CommandResult.fail(`File not found: ${ip}`)
  }

  // Pages of one note have to reach the model in capture order — multiselect
  // returns them in the order they were toggled.
  if (imagePaths.length > 1) {
    const withMtime = await Promise.all(imagePaths.map(async (ip) => ({ ip, mtime: (await stat(ip)).mtimeMs ?? 0 })))
    withMtime.sort((a, b) => a.mtime - b.mtime)
    imagePaths = withMtime.map((x) => x.ip)
  }

  return CommandResult.success(imagePaths)
}

export interface ExtractOptions {
  /** Extra guidance for the model, from `--ai-context`. */
  aiContext?: string
  /**
   * `YYYY-MM-DD` the images are being filed under, used to resolve a relative
   * label written on the page. Passed in rather than read from a clock here.
   */
  referenceDate?: string
}

export async function extractNoteFromImage(
  imagePaths: string[],
  { aiContext, referenceDate }: ExtractOptions = {},
): Promise<ImageNoteExtraction> {
  const imageBlocks = await Promise.all(
    imagePaths.map(async (imagePath) => {
      const { image, mediaType } = await loadImageForAI(imagePath)
      return { type: 'file' as const, data: image, mediaType }
    }),
  )

  const promptContent = await readTextFile(EXTRACT_PROMPT_FILE)
  let { output: prompt } = renderPromptFile(promptContent, 'extract-from-image.prompt.md', {
    user: { referenceDate: referenceDate ?? '(unknown)' },
  })
  if (aiContext) {
    prompt += `\n\nAdditional context: ${aiContext}`
  }

  const result = await generateObject({
    ...aiModel('reasoning'),
    schema: ExtractionSchema,
    messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: prompt }] }],
  })

  return result.object
}

export interface CorrectionsContext {
  summary: string
  when: string
  rel: string[]
  corrections: string
}

export async function parseNoteCorrections(ctx: CorrectionsContext): Promise<z.infer<typeof CorrectionsSchema>> {
  const promptContent = await readTextFile(CORRECTIONS_PROMPT_FILE)
  const renderInput: RenderInput = {
    user: {
      summary: ctx.summary,
      when: ctx.when,
      rel: ctx.rel.length > 0 ? ctx.rel.join(', ') : '(none)',
      corrections: ctx.corrections,
    },
  }
  const { output: prompt } = renderPromptFile(promptContent, 'parse-corrections.prompt.md', renderInput)

  const result = await generateObject({ ...aiModel('balanced'), schema: CorrectionsSchema, prompt })
  return result.object
}

/**
 * Move the images into the day's attachments, named after the note rather than
 * whatever the camera called them — the same `<date>_notes_<slug><ext>` shape
 * `--from-audio` gives its recording, numbered when there is more than one.
 *
 * Warns rather than throws: a failure here must not lose the transcription that
 * was just paid for.
 */
async function stashImages(
  imagePaths: string[],
  when: PlainDateTime,
  summary: string,
  attachmentsRoot: string,
  output: CommandArgs['context']['output'],
): Promise<string[]> {
  const noteDate = when.plainDate
  const summarySlug = slugify(summary, { preserveCase: true, suggestedLength: 40 })
  const stashed: string[] = []

  try {
    const attachDir = path.join(attachmentsRoot, dayAttachmentsDir(noteDate))
    await mkdir(attachDir, { recursive: true })

    for (let i = 0; i < imagePaths.length; i++) {
      const imagePath = imagePaths[i]
      const indexSuffix = imagePaths.length > 1 ? `_${i + 1}` : ''
      const name = `${noteDate}_notes_${summarySlug}${indexSuffix}${path.extname(imagePath).toLowerCase()}`

      const destPath = path.join(attachDir, name)
      await rename(imagePath, destPath).catch(async () => await copyFile(imagePath, destPath))
      stashed.push(name)
    }

    output.log(colors.gray(`Moved ${stashed.length} image(s) to ${attachDir}\n`))
  } catch (err) {
    output.error(`Could not move the images into attachments: ${err}`)
  }

  return stashed
}

/** Models sometimes wrap the whole answer in a fence despite being told not to. */
export function stripCodeFence(text: string): string {
  const fenced = text.trim().match(/^```(?:markdown|md)?\n([\s\S]*)\n```$/)
  return (fenced ? fenced[1] : text).trim()
}

/**
 * Demote every heading a level when the body opens one at `#`.
 *
 * The note file already carries `# <summary>`, so an h1 in the body makes a
 * second document title and flattens the outline for anything that reads by
 * heading level. The prompt asks for `##` and below; this catches the model
 * that ignores it, and shifts the whole tree rather than just the offending
 * line so the relative levels survive. Headings inside a fenced block are left
 * alone — a `#` there is a shell comment, not an outline level.
 */
export function demoteBodyHeadings(markdown: string): string {
  const lines = markdown.split('\n')
  const isOutline: boolean[] = []
  let inFence = false

  for (const line of lines) {
    const fenceDelimiter = /^\s*(?:```|~~~)/.test(line)
    isOutline.push(!inFence && !fenceDelimiter)
    if (fenceDelimiter) inFence = !inFence
  }

  if (!lines.some((line, i) => isOutline[i] && /^#\s/.test(line))) return markdown

  // h6 has nowhere to go, so it stays where it is.
  return lines.map((line, i) => (isOutline[i] ? line.replace(/^(#{1,5})(\s)/, '#$1$2') : line)).join('\n')
}
