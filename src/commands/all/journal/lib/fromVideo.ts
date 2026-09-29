import { rm, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { runOptionsFor, TranscriptRun } from '#commands/all/audio/transcript/lib/transcriptRun.ts'
import { CommandResult } from '#commands/mod.ts'
import type { CommandArgs } from '#commands/mod.ts'
import { extractAudio, probeMedia } from '#lib/media/ffmpeg/mod.ts'
import { exists } from '#shared/fs/mod.ts'
import { Instant, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { desktopFilesByExt } from '../../audio/transcript/lib/desktopFiles.ts'
import { fileRecordedJournal } from './recordedJournal.ts'

/** Containers a screen or camera recording plausibly arrives in. */
export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.mkv'] as const

/** The journal type a video entry files under; the tag follows from it. */
export const VIDEO_JOURNAL_TYPE = 'Video'

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
 * corrected against the glossary while the words themselves are left alone.
 * The shared recorded-journal pipeline then sections, groups, names, and files
 * the entries with one retained recording.
 *
 * The entry is timed from when recording *started*: a file's mtime is when it
 * stopped, so the duration comes back off it. A container carrying its own
 * creation_time is trusted over both.
 */
export async function journalFromVideo(options: FromVideoOptions): Promise<CommandResult> {
  const { context, tasks } = options
  const { output } = context

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

  const when = await resolveRecordingStart(
    videoPath,
    media.durationSeconds,
    media.creationTime,
    options.when,
    context.notebookNow.timezone,
  )
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

  try {
    const cleanResult = await tasks.run('audio:transcript:clean', { fromAudio: audioPath, run: run.key })
    if (!cleanResult.ok || !cleanResult.data) return CommandResult.fail(`Transcription failed: ${cleanResult.message}`)
    const clean = cleanResult.data
    if (!clean.cleanedText.trim()) return CommandResult.fail('The transcript came back empty.')
    return await fileRecordedJournal({
      ...options,
      kind: 'Video',
      source: videoPath,
      cleanedText: clean.cleanedText,
      rel: [...clean.who, ...clean.rel].filter(Boolean),
      when,
      run,
    })
  } finally {
    await rm(path.dirname(audioPath), { recursive: true, force: true })
  }
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
  timezone: string,
): Promise<PlainDateTime> {
  const rewind = (finishedAt: Instant) =>
    new PlainDateTime(
      finishedAt
        .subtract({ milliseconds: Math.round((durationSeconds ?? 0) * 1000) })
        .toZonedDateTimeISO(timezone)
        .toPlainDateTime()
        .toString({ smallestUnit: 'minute' })
        .replace('T', ' '),
    )
  if (creationTime) {
    try {
      return rewind(Instant.from(creationTime))
    } catch {
      /* Fall back to the file's clock. */
    }
  }
  const mtime = (await stat(videoPath)).mtimeMs
  return Number.isFinite(mtime) ? rewind(Instant.fromEpochMilliseconds(Math.trunc(mtime))) : typedWhen
}
