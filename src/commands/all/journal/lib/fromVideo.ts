import { rm, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { runOptionsFor, TranscriptRun } from '#commands/all/audio/transcript/lib/transcriptRun.ts'
import { CommandResult } from '#commands/mod.ts'
import type { CommandArgs } from '#commands/mod.ts'
import { extractAudio, type MediaInfo, probeMedia } from '#lib/media/ffmpeg/mod.ts'
import { VIDEO_EXTENSIONS } from '#lib/media/video.ts'
import { exists } from '#shared/fs/mod.ts'
import notebookTimeOf from '#shared/nbfs/notebookTimeOf.ts'
import { Instant, type PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { desktopFilesByExt } from '../../audio/transcript/lib/desktopFiles.ts'
import { fileRecordedJournal, recordedJournalPlan } from './recordedJournal.ts'

export { VIDEO_EXTENSIONS } from '#lib/media/video.ts'

/** Recording provenance stamped on video journal entries. */
export const VIDEO_JOURNAL_TYPE = 'Video'

export interface FromVideoOptions {
  /** Explicit path, or undefined to take the newest video off the Desktop. */
  videoPath?: string
  when: PlainDateTime
  /** A date/time the caller chose takes precedence over the recording's clock. */
  whenStated?: boolean
  context: CommandArgs['context']
  tasks: CommandArgs['tasks']
  noAutoTag?: boolean
  noAutoRel?: boolean
  /** Defaults to 'auto'; "Health, Faith" proposes those types plus a remainder. */
  split?: string
  /** Start over: forget what an earlier run of the recording already produced. */
  fresh?: boolean
}

/**
 * Turn a recorded video journal into a journal entry.
 *
 * The recording is probed, its audio extracted, and the result put through the
 * same clean pass `--from-audio` uses, so mis-heard names and terms are
 * corrected against the glossary while the words themselves are left alone.
 * The shared recorded-journal pipeline then sections, groups, names, and files
 * the entries with one retained recording.
 *
 * The entry is timed from when recording *started*: the date an Apple camera
 * wrote down when it began, else the file's own clock less the duration.
 */
export async function journalFromVideo(options: FromVideoOptions): Promise<CommandResult> {
  const { context, tasks } = options
  const { output } = context
  const split = options.split ?? 'auto'
  output.plan(recordedJournalPlan('Video', split))

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

  const start = options.whenStated
    ? { when: options.when, note: undefined }
    : await recordingStart(videoPath, media, options.when, context.notebookNow.timezone, context.config.DIR_TIME)
  const when = start.when
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
  context.signal?.throwIfAborted()
  output.stage('extract-audio', 'Extracting audio')
  const audioPath = await extractAudio(videoPath)

  try {
    const cleanResult = await tasks.run('audio:transcript:clean', { fromAudio: audioPath, run: run.key })
    if (!cleanResult.ok || !cleanResult.data) return CommandResult.fail(`Transcription failed: ${cleanResult.message}`)
    const clean = cleanResult.data
    context.signal?.throwIfAborted()
    if (!clean.cleanedText.trim()) return CommandResult.fail('The transcript came back empty.')
    return await fileRecordedJournal({
      ...options,
      kind: 'Video',
      source: videoPath,
      cleanedText: clean.cleanedText,
      rel: [...clean.who, ...clean.rel].filter(Boolean),
      when,
      whenNote: start.note,
      run,
      split,
      reviewTypes: true,
    })
  } finally {
    await rm(path.dirname(audioPath), { recursive: true, force: true })
  }
}

/**
 * When recording started, and where that came from.
 *
 * An Apple camera writes down when it began recording (`capturedAt`), and the
 * copy to a Mac keeps it: AirDrop and Photos exports reset `creation_time` and
 * the file's mtime to the moment of the copy, which once filed a journal
 * recorded days earlier on the day it was imported.
 *
 * Those two timestamps mark roughly when recording *finished*, so the
 * duration comes off whichever one is used. Measured on a phone recording: an
 * 11m19s clip carried a `creation_time` 54 seconds before its mtime — a minute
 * apart from each other and eleven minutes after the speaking began.
 * `creation_time` is preferred over mtime because it lives inside the
 * container, where a plain file copy leaves it alone. Without a duration
 * neither can be walked back, so they stand as-is.
 *
 * The moment is written the way the notebook writes time: on the clock of the
 * day that was running then, in that day's time zone.
 */
async function recordingStart(
  videoPath: string,
  media: MediaInfo,
  typedWhen: PlainDateTime,
  timezone: string,
  timeDir: string,
): Promise<{ when: PlainDateTime; note: string }> {
  const at = (instant: Instant) => notebookTimeOf(instant, timezone, timeDir)
  const finished = (instant: Instant) =>
    at(instant.subtract({ milliseconds: Math.round((media.durationSeconds ?? 0) * 1000) }))
  for (const [stamp, read, note] of [
    [media.capturedAt, at, 'from the video'],
    [media.creationTime, finished, "from the file's time"],
  ] as const) {
    if (!stamp) continue
    try {
      return { when: read(Instant.from(stamp)), note }
    } catch {
      /* Not a timestamp: try the next clock. */
    }
  }
  const mtime = (await stat(videoPath)).mtimeMs
  return Number.isFinite(mtime)
    ? { when: finished(Instant.fromEpochMilliseconds(Math.trunc(mtime))), note: "from the file's time" }
    : { when: typedWhen, note: 'suggested' }
}
