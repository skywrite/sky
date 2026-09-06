import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { generateText } from 'ai'
import { runOptionsFor, TranscriptRun } from '#commands/all/audio/transcript/lib/transcriptRun.ts'
import { CommandResult } from '#commands/mod.ts'
import type { CommandArgs } from '#commands/mod.ts'
import { extractAudio, probeMedia } from '#lib/media/ffmpeg/mod.ts'
import { DayDirFileWriter } from '#lib/nbfs/mod.ts'
import { autoRelMessage, mergeRel, scopeRel } from '#lib/notebook/enrich/autoRel.ts'
import { autoTagMessage } from '#lib/notebook/enrich/autoTag.ts'
import openEditor from '#lib/shell/openEditor.ts'
import slugify from '#lib/string/slugify.ts'
import { aiModel } from '#shared/ai/models.ts'
import { exists, rename } from '#shared/fs/mod.ts'
import JournalDocument from '#shared/models/Journal/document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { desktopFilesByExt } from '../../audio/transcript/lib/desktopFiles.ts'
import { groupByType, groupIntoBuckets, journalTypeMenu } from './groupSections.ts'
import { buildEntryMarkdown, parseSectionedBody, validateGroups } from './splitSections.ts'
import type { BodySection, EntryGroup } from './splitSections.ts'

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
  /** 'auto' groups by subject; "Health, Faith" extracts those entries plus a remainder. */
  split?: string
  /** Start over: forget what an earlier run of the recording already produced. */
  fresh?: boolean
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

  // The run record is the video's, not the extracted audio's: a rerun extracts
  // again, and the pipeline finds the transcript it already paid for by the
  // recording it came from.
  const run = await TranscriptRun.forFile(videoPath, runOptionsFor(context))
  if (options.fresh) {
    await run.clear()
    output.log('Starting over.')
  }

  // 3. Video containers are not what the transcription endpoints want, and the
  //    video stream would be most of an upload that only needs the audio.
  output.log('Extracting audio...')
  const audioPath = await extractAudio(videoPath)

  // 4. Transcribe and correct, reusing the audio pipeline wholesale.
  const cleanResult = await tasks.run('audio:transcript:clean', { fromAudio: audioPath, run: run.key })
  if (!cleanResult.ok || !cleanResult.data) {
    return CommandResult.fail(`Transcription failed: ${cleanResult.message}`)
  }
  const clean = cleanResult.data
  if (!clean.cleanedText.trim()) return CommandResult.fail('The transcript came back empty.')

  // 5. Headings and a summary over the words, without touching the words.
  output.log('Organizing into sections...')
  const { output: prompt } = renderPromptFile(await readPromptFile(PROMPT_FILE), 'video-sections.prompt.md', {
    journal: { date: when.date, transcript: clean.cleanedText },
  })
  const { text } = await generateText({ ...aiModel('reasoning'), prompt })

  const { title, body: titleless } = splitTitle(stripCodeFence(text))
  const { markdown: body, renamed } = disarmTranscriptHeadings(titleless)
  if (renamed > 0) output.log(`Renamed ${renamed} heading(s) that would have been ignored downstream`)

  // 6. Split, when asked: group the sections by subject and plan one entry per
  //    subject. The plan is structural — indexes and titles — and the cutting
  //    is code, so the speaker's words never pass through the grouping model.
  //    Any defect in the plan keeps the single entry: a bad split may never
  //    lose or duplicate the recording.
  const split = options.split ? await planSplit(options.split, body, output) : undefined

  // 7. Park the recording once, with the day's other attachments, named after
  //    the recording rather than whatever the camera called it; every entry
  //    references it. A failure must not lose the entry we just paid to
  //    produce, so it only warns.
  const typeSlug = slugify(VIDEO_JOURNAL_TYPE)
  const titleSlug = title ? slugify(title, { suggestedLength: 40, preserveCase: true }) : ''
  const nameParts = [typeSlug, titleSlug].filter(Boolean).join('_')
  const attachment = await stashRecording(videoPath, when, nameParts, config.DIR_ATTACHMENTS, output)

  const h1 = `# **${VIDEO_JOURNAL_TYPE}: ${when.date} - ${when.plainDate.dayShort} - ${when.time}**`
  const ddfw = new DayDirFileWriter(when.plainDate)
  const pipelineRel = [...clean.who, ...clean.rel].filter(Boolean)

  // 8. Write each entry: enrich against the archived journals, then assemble.
  //    Enrichment is per entry — tags from its own text, and the recording's
  //    pipeline names scoped down to the ones its text concerns, so a person
  //    from one part of the recording is not stamped on every part. Scoping
  //    judges references, not spellings: "the little ones" keeps the children
  //    even when no name appears. Auto-rel then adds to the scoped names
  //    rather than replacing them — the clean pass reads corrections and the
  //    glossary, so it catches names, especially family ones, that the entity
  //    graph never carried. `summary:` carries the title the same way
  //    journal:rename stamps it, which also stops rename touching these files.
  const writeEntry = async (entry: {
    title: string
    markdown: string
    journalType?: string
    /** Headings of the recording's sections NOT in this entry — context for rel scoping. */
    elsewhere?: string[]
  }): Promise<string> => {
    const enrichInput = { summary: entry.title, body: entry.markdown.split('\n').slice(1).join('\n') }
    const scoping = split && !options.noAutoRel && pipelineRel.length > 0
    const [autoTags, autoRel, scoped] = await Promise.all([
      options.noAutoTag ? undefined : autoTagMessage(enrichInput, JOURNAL_ENRICH),
      options.noAutoRel ? undefined : autoRelMessage(enrichInput, JOURNAL_ENRICH),
      scoping
        ? scopeRel(pipelineRel, enrichInput, { kind: JOURNAL_ENRICH.kind, elsewhere: entry.elsewhere })
        : undefined,
    ])
    // A failed scoping keeps the full list: over-attribution degrades
    // gracefully, silently losing a person does not.
    const entryRel = scoping ? (scoped ?? pipelineRel) : pipelineRel

    const doc = JournalDocument.fromMarkdown(entry.markdown)
    const rel = mergeRel(entryRel, autoRel) ?? []
    if (entry.title) doc.yaml['summary'] = entry.title
    doc.yaml['rel'] = rel.length > 0 ? rel : null
    // The provenance tag leads, then the journal type the split filed this
    // under, then the topical proposals; TagSet dedupes any repeats.
    const tags = [`Journal/${VIDEO_JOURNAL_TYPE}`, entry.journalType && `Journal/${entry.journalType}`, autoTags]
    doc.yaml['tags'] = String(TagSet.fromString(tags.filter(Boolean).join('; ')))
    if (autoTags) output.log(`  Auto-tags: ${autoTags}`)
    if (rel.length > 0) output.log(`  Rel: ${rel.join(', ')}`)
    if (attachment) doc.yaml['attachments'] = [{ file: attachment }]

    const entrySlug = entry.title ? slugify(entry.title, { suggestedLength: 40, preserveCase: true }) : ''
    const fileSlug = [typeSlug, entrySlug].filter(Boolean).join('_')
    const prefix = await nextJournalPrefix(ddfw.fullDir)
    return await ddfw.write(`journal/${prefix}_${fileSlug}.md`, doc.toMarkdown())
  }

  const written: string[] = []
  if (split) {
    // Prefixes follow spoken order: the entry that opened the recording files first.
    const inSpokenOrder = [...split.groups].sort((a, b) => Math.min(...a.sections) - Math.min(...b.sections))
    for (const group of inSpokenOrder) {
      output.log(`\nEntry: ${group.title}${group.journalType ? `  [Journal/${group.journalType}]` : ''}`)
      const inGroup = new Set(group.sections)
      written.push(
        await writeEntry({
          title: group.title,
          markdown: buildEntryMarkdown(h1, group, split.sections),
          journalType: group.journalType,
          elsewhere: split.sections.filter((_, i) => !inGroup.has(i)).map((s) => s.heading),
        }),
      )
    }
  } else {
    written.push(await writeEntry({ title, markdown: [h1, '', body].join('\n') }))
  }

  // The entries are filed: the run has nothing left to pick up.
  await run.clear()

  output.log('')
  for (const relPath of written) output.log(`  Created ${relPath}`)
  output.log('')
  openEditor(written.map((file) => ({ file: path.join(ddfw.fullDir, file), line: 1, column: 0 })))
  return CommandResult.success()
}

/**
 * Turn a sectioned body into a split plan, or undefined for every path that
 * should keep today's single entry: one section, a grouping failure, a plan
 * that is not a perfect partition, or a recording that stays one subject.
 */
async function planSplit(
  splitArg: string,
  body: string,
  output: { log: (msg: string) => void },
): Promise<{ groups: EntryGroup[]; sections: BodySection[] } | undefined> {
  const parsed = parseSectionedBody(body)
  if (parsed.sections.length < 2) {
    output.log('Split: only one section — keeping a single entry')
    return undefined
  }
  const totalWords = parsed.sections.reduce((n, s) => n + s.words, 0)
  const buckets =
    splitArg === 'auto'
      ? []
      : splitArg
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)

  output.log(
    buckets.length > 0 ? `Splitting into ${buckets.join(', ')} + remainder...` : 'Splitting by journal type...',
  )
  const outcome =
    buckets.length > 0
      ? await groupIntoBuckets(parsed.sections, buckets, totalWords)
      : await groupByType(parsed.sections, await journalTypeMenu(), totalWords)

  if (outcome.error) {
    output.log(`Split failed (${outcome.error}) — keeping a single entry`)
    return undefined
  }
  const invalid = validateGroups(outcome.groups, parsed.sections.length)
  if (invalid) {
    output.log(`Split plan rejected (${invalid}) — keeping a single entry`)
    return undefined
  }
  if (outcome.groups.length === 1) {
    output.log('Split: the recording stays on one subject — keeping a single entry')
    return undefined
  }

  // Owner-named buckets file under a journal type when they name one.
  if (buckets.length > 0) {
    const menu = await journalTypeMenu()
    const byLower = new Map(menu.map((m) => [m.name.toLowerCase(), m.name]))
    for (const group of outcome.groups) {
      const match = byLower.get(group.title.toLowerCase())
      if (match) group.journalType = match
    }
  }

  output.log(`Split into ${outcome.groups.length} entries:`)
  const preview = [...outcome.groups].sort((a, b) => Math.min(...a.sections) - Math.min(...b.sections))
  for (const group of preview) {
    const secs = [...group.sections]
      .sort((x, y) => x - y)
      .map((i) => i + 1)
      .join(', ')
    output.log(`  - ${group.title}${group.journalType ? `  [Journal/${group.journalType}]` : ''}  (sections ${secs})`)
  }
  return { groups: outcome.groups, sections: parsed.sections }
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
