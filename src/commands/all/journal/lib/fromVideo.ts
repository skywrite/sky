import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { generateText } from 'ai'
import { CommandResult } from '#commands/mod.ts'
import type { CommandArgs } from '#commands/mod.ts'
import { extractAudio, probeMedia } from '#lib/media/ffmpeg/mod.ts'
import { DayDirFileWriter } from '#lib/nbfs/mod.ts'
import { autoRelMessage, mergeRel } from '#lib/notebook/enrich/autoRel.ts'
import { autoTagMessage } from '#lib/notebook/enrich/autoTag.ts'
import openEditor from '#lib/shell/openEditor.ts'
import slugify from '#lib/string/slugify.ts'
import { aiModel } from '#shared/ai/models.ts'
import { exists, readTextFile, rename } from '#shared/fs/mod.ts'
import JournalDocument from '#shared/models/Journal/document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { dayWord } from '#universal/dates/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { desktopFilesByExt } from '../../audio/transcript/lib/desktopFiles.ts'

const PROMPT_FILE = new URL('../prompts/video-sections.prompt.md', import.meta.url).pathname

/** Containers a screen or camera recording plausibly arrives in. */
export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.mkv'] as const

/** The journal type a video entry files under; the tag follows from it. */
export const VIDEO_JOURNAL_TYPE = 'Video'

/**
 * Corpus and framing for enriching a journal entry. No `to` accompanies it: a
 * journal has no counterparty, so there is no conversation history to key a
 * prior on — the menu and the entry's own words carry the classification.
 *
 * Journals are tagged deeper than chat: a fifth of the archive since 2025
 * carries more than three tags, where slack is at 3%. Five covers 97% of them.
 */
const JOURNAL_ENRICH: { mediums: string[]; kind: string; maxTags: number } = {
  mediums: ['journal'],
  kind: 'journal entry',
  maxTags: 5,
}

export interface FromVideoOptions {
  /** Explicit path, or undefined to take the newest video off the Desktop. */
  videoPath?: string
  when: PlainDateTime
  context: CommandArgs['context']
  tasks: CommandArgs['tasks']
  noAutoTag?: boolean
  noAutoRel?: boolean
}

/**
 * Turn a recorded video journal into a journal entry.
 *
 * The recording is probed, its audio extracted, and the result put through the
 * same clean pass `--from-audio` uses, so mis-heard names and terms are
 * corrected against the glossary while the words themselves are left alone. A
 * model then inserts section headings and writes a summary over that text
 * without rewriting it — the part `--from-audio` deliberately skips.
 *
 * The entry is timed from when recording *started*: a file's mtime is when it
 * stopped, so the duration comes back off it. A container carrying its own
 * creation_time is trusted over both.
 */
export async function journalFromVideo(options: FromVideoOptions): Promise<CommandResult> {
  const { context, tasks } = options
  const { output, config } = context

  // 1. Find the recording.
  let videoPath = options.videoPath
  if (!videoPath) {
    const candidates = await desktopFilesByExt(VIDEO_EXTENSIONS)
    if (candidates.length === 0) {
      return CommandResult.fail(
        `No video found on the Desktop (looked for ${VIDEO_EXTENSIONS.join(', ')}). Pass a path: --from-video <file>`,
      )
    }
    videoPath = candidates[0].path
    if (candidates.length > 1) output.log(`${candidates.length} videos on Desktop, using newest`)
  }
  if (!(await exists(videoPath))) return CommandResult.fail(`File not found: ${videoPath}`)
  output.log(`Video: ${path.basename(videoPath)}`)

  // 2. Probe before spending anything. A recording made with the mic off would
  //    otherwise cost an extraction and a paid transcription to discover.
  const media = await probeMedia(videoPath)
  if (!media.hasAudio) {
    return CommandResult.fail(`${path.basename(videoPath)} has no audio track, so there is nothing to transcribe.`)
  }

  const when = await resolveRecordingStart(videoPath, media.durationSeconds, media.creationTime, options.when)
  if (media.durationSeconds !== null) {
    output.log(`Length: ${Math.round(media.durationSeconds / 60)}m, recorded from ${when.date} ${when.time}`)
  }

  // 3. Video containers are not what the transcription endpoints want, and the
  //    video stream would be most of an upload that only needs the audio.
  output.log('Extracting audio...')
  const audioPath = await extractAudio(videoPath)

  // 4. Transcribe and correct, reusing the audio pipeline wholesale.
  const cleanResult = await tasks.run('audio:transcript:clean', { fromAudio: audioPath })
  if (!cleanResult.ok || !cleanResult.data) {
    return CommandResult.fail(`Transcription failed: ${cleanResult.message}`)
  }
  const clean = cleanResult.data
  if (!clean.cleanedText.trim()) return CommandResult.fail('The transcript came back empty.')

  // 5. Headings and a summary over the words, without touching the words.
  output.log('Organizing into sections...')
  const { output: prompt } = renderPromptFile(await readTextFile(PROMPT_FILE), 'video-sections.prompt.md', {
    journal: { date: when.date, transcript: clean.cleanedText },
  })
  const { text } = await generateText({ ...aiModel('reasoning'), prompt })

  const { title, body: titleless } = splitTitle(stripCodeFence(text))
  const { markdown: body, renamed } = disarmTranscriptHeadings(titleless)
  if (renamed > 0) output.log(`Renamed ${renamed} heading(s) that would have been ignored downstream`)

  // 6. Enrich against the archived journals. The type tag says what kind of
  //    entry this is; the corpus says what it is about, which until now was
  //    left for the writer to add by hand afterwards. Auto-rel adds to the
  //    transcript's own extraction rather than replacing it — the clean pass
  //    reads corrections and the glossary, so it catches names, especially
  //    family ones, that the entity graph never carried.
  const enrichInput = { summary: title, body }
  const [autoTags, autoRel] = await Promise.all([
    options.noAutoTag ? undefined : autoTagMessage(enrichInput, JOURNAL_ENRICH),
    options.noAutoRel ? undefined : autoRelMessage(enrichInput, JOURNAL_ENRICH),
  ])

  // 7. Assemble the document. `summary:` carries the title the same way
  //    journal:rename stamps it, which also stops rename touching this file.
  const heading = `# **${VIDEO_JOURNAL_TYPE}: ${when.date} - ${dayWord(when.toDayDateValue(), 'short')} - ${when.time}**`
  const doc = JournalDocument.fromMarkdown([heading, '', body].join('\n'))
  const pipelineRel = [...clean.who, ...clean.rel].filter(Boolean)
  const rel = mergeRel(pipelineRel, autoRel) ?? []
  if (title) doc.yaml['summary'] = title
  doc.yaml['rel'] = rel.length > 0 ? rel : null
  // The type tag leads; TagSet dedupes should the classifier propose it too.
  const typeTag = `Journal/${VIDEO_JOURNAL_TYPE}`
  doc.yaml['tags'] = String(TagSet.fromString([typeTag, autoTags].filter(Boolean).join('; ')))
  if (autoTags) output.log(`  Auto-tags: ${autoTags}`)
  if (rel.length > pipelineRel.length) output.log(`  Auto-rel: ${rel.slice(pipelineRel.length).join(', ')}`)

  // 8. Park the recording with the day's other attachments, named after the
  //    entry rather than whatever the camera called it. A failure there must not
  //    lose the entry we just paid to produce, so it only warns.
  const typeSlug = slugify(VIDEO_JOURNAL_TYPE)
  const titleSlug = title ? slugify(title, { suggestedLength: 40, preserveCase: true }) : ''
  const nameParts = [typeSlug, titleSlug].filter(Boolean).join('_')

  const attachment = await stashRecording(videoPath, when, nameParts, config.DIR_ATTACHMENTS, output)
  if (attachment) doc.yaml['attachments'] = [{ file: attachment }]

  const ddfw = new DayDirFileWriter(when.plainDate)
  const prefix = await nextJournalPrefix(ddfw.fullDir)
  const relPath = await ddfw.write(`journal/${prefix}_${nameParts}.md`, doc.toMarkdown())

  output.log(`\n  Successfully created ${relPath}.\n`)
  openEditor([{ file: path.join(ddfw.fullDir, relPath), line: 1, column: 0 }])
  return CommandResult.success()
}

/**
 * A heading containing "transcript" is dropped along with everything beneath it
 * by ai:chat's context gathering and the journal/mi gatherers, so a model
 * reaching for the obvious heading would silently delete the entry's body from
 * every downstream reader. Rewriting the heading is cheaper than re-prompting.
 */
export function disarmTranscriptHeadings(markdown: string): { markdown: string; renamed: number } {
  let renamed = 0
  const out = markdown.replace(/^(#{2,6})\s+(.*)$/gm, (line, hashes: string, text: string) => {
    if (!/transcript/i.test(text)) return line
    renamed += 1
    const stripped = text
      .replace(/\btranscripts?\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
    return `${hashes} ${stripped || 'What was said'}`
  })
  return { markdown: out, renamed }
}

/** Models sometimes wrap the whole answer in a fence despite being told not to. */
export function stripCodeFence(text: string): string {
  const fenced = text.trim().match(/^```(?:markdown|md)?\n([\s\S]*)\n```$/)
  return (fenced ? fenced[1] : text).trim()
}

/**
 * Lift the `TITLE:` line the prompt asks for off the front of the answer.
 *
 * The title names the file and fills `summary:`, but it is not part of the
 * entry, so it never reaches the document body. A model that forgets the line
 * costs a plainer filename, not a failed run.
 */
export function splitTitle(text: string): { title: string; body: string } {
  const match = text.match(/^\s*TITLE:\s*(.+?)\s*$/m)
  if (!match) return { title: '', body: text.trim() }
  return { title: match[1].trim(), body: text.replace(match[0], '').trim() }
}

/**
 * The next free two-digit prefix in the day's journal directory.
 *
 * Journals are named `NN_type_slug.md` so a day's entries list in a stable
 * order. `journal:new` assigns those numbers across the batch it writes in one
 * go; a video arrives on its own, so it takes the next number after whatever is
 * already filed rather than colliding at 00 and being suffixed `-2`.
 */
export async function nextJournalPrefix(dayFullDir: string): Promise<string> {
  let highest = -1
  try {
    for (const name of await readdir(path.join(dayFullDir, 'journal'))) {
      const prefix = name.match(/^(\d{2})_/)
      if (prefix) highest = Math.max(highest, Number(prefix[1]))
    }
  } catch {
    // No journal directory yet — this is the day's first entry.
  }
  return String(highest + 1).padStart(2, '0')
}

/**
 * When recording started.
 *
 * Both timestamps a recording carries mark roughly when it *finished*, so the
 * duration comes off whichever one is used. Measured on a phone recording: an
 * 11m19s clip carried a `creation_time` 54 seconds before its mtime — a minute
 * apart from each other and eleven minutes after the speaking began. Treating
 * `creation_time` as the start would have dated the entry to the moment the
 * recording stopped.
 *
 * `creation_time` is preferred over mtime because it lives inside the container
 * and survives being copied off a phone, whereas mtime becomes the transfer
 * time. Without a duration neither can be walked back, so they stand as-is.
 */
async function resolveRecordingStart(
  videoPath: string,
  durationSeconds: number | null,
  creationTime: string | null,
  typedWhen: PlainDateTime,
): Promise<PlainDateTime> {
  const rewind = (finishedAt: Date) => new PlainDateTime(new Date(finishedAt.getTime() - (durationSeconds ?? 0) * 1000))

  if (creationTime) {
    const parsed = new Date(creationTime)
    if (!Number.isNaN(parsed.getTime())) return rewind(parsed)
  }

  const mtime = (await stat(videoPath)).mtime
  if (!Number.isNaN(mtime.getTime())) return rewind(mtime)

  return typedWhen
}

/**
 * Move the recording into the day's attachments, named after the entry rather
 * than whatever the camera called it — the same `<date>_<slug><ext>` shape
 * meeting:new and video:new give their sources. Warns rather than fails.
 */
async function stashRecording(
  videoPath: string,
  when: PlainDateTime,
  nameParts: string,
  attachmentsRoot: string,
  output: CommandArgs['context']['output'],
): Promise<string | null> {
  try {
    const dir = path.join(attachmentsRoot, dayAttachmentsDir(when.plainDate))
    await mkdir(dir, { recursive: true })

    const name = `${when.date}_${nameParts}${path.extname(videoPath).toLowerCase()}`
    const dest = path.join(dir, name)
    await rename(videoPath, dest).catch(async () => await copyFile(videoPath, dest))
    return name
  } catch (err) {
    output.error(`Could not move the recording into attachments: ${err}`)
    return null
  }
}
