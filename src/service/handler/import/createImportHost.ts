/**
 * The import over the real notebook: uploads under the user-data directory,
 * the door commands run in-process with the browser answering their
 * questions, the first minute of a recording heard through the same
 * transcription call the pipeline uses, a screenshot's pixels read from its
 * header, and the day's calendar read the way the meeting check reads it.
 */

import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { generateText } from 'ai'
import { transcribeAudio } from '#commands/all/audio/transcript/lib/audio.ts'
import { audioTurnsKey } from '#commands/all/audio/transcript/lib/audioTurns.ts'
import { transcriptionUploadLimit } from '#commands/all/audio/transcript/lib/models.ts'
import { peekTranscriptRun, sha256Of } from '#commands/all/audio/transcript/lib/transcriptRun.ts'
import { checkDayMeetings, START_TOLERANCE_MINUTES } from '#commands/all/day/meeting/lib/meetingCheck.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import { runCommand, type RunEvent } from '#commands/lib/core/runCommand.ts'
import { probeMedia, runFfmpeg } from '#lib/media/ffmpeg/mod.ts'
import { imageSize } from '#lib/media/image/mod.ts'
import { KeychainSecretsProvider } from '#lib/secrets/KeychainSecretsProvider.ts'
import { aiModel } from '#shared/ai/models.ts'
import type * as ConfigModule from '#shared/config.ts'
import { loadSkyConfig } from '#shared/config/loader.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { JournalTypes } from '#shared/models/Journal/mod.ts'
import { dayDir, fetchNowSync } from '#shared/nbfs/mod.ts'
import { PlainDate, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import type { CalendarMatch, ImportJob, ImportRoutesOptions, Listen, RunOutcome, StagedFile } from './mod.ts'
import {
  opening,
  type ReadBack,
  readAudio,
  readDocument,
  readImage,
  readIMessageAudio,
  readSrt,
  readText,
  readTranscript,
  readUnknown,
  RECORDING_KINDS,
  type RecordingKind,
  sourceOf,
} from './readback.ts'
import { startArgs } from './startArgs.ts'
import { startOnSavedDay } from './startOnSavedDay.ts'

/** How long a recording sky listens to before guessing what it is. */
const LISTEN_SECONDS = 45

const GUESS: Record<RecordingKind, string> = {
  meeting: 'Sounds like a meeting recap.',
  journal: 'Sounds like a journal entry.',
  note: 'Sounds like a note to keep.',
  message: 'Sounds like a message to send.',
  event: 'Sounds like something that happened.',
}

/** One word from a small model: which door the opening words point at. */
async function classify(text: string): Promise<RecordingKind> {
  const result = await generateText({
    ...aiModel('fast'),
    prompt: `Someone recorded a voice memo. Here is how it starts:

"""
${text}
"""

Which of these is it? Answer with exactly one word.
- meeting: a recap or notes of a meeting or call with other people
- journal: personal reflection — feelings, the day, lessons, gratitude
- note: an idea, a thought, or information to keep
- message: words dictated to be sent to someone
- event: something that happened, being logged`,
  })
  const word = result.text
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '')
  return RECORDING_KINDS.includes(word as RecordingKind) ? (word as RecordingKind) : 'note'
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** The notebook's spelling of an instant. */
function notebookWhen(instant: ZonedDateTime, timeDir: string): string {
  try {
    return fetchNowSync({ timeDir, now: instant }).plainDateTime.toString()
  } catch {
    return instant.plainDateTime.toString()
  }
}

/** Where a filed document is, relative to the notebook root. */
function filedPath(data: unknown, when: PlainDateTime, config: typeof ConfigModule): string | null {
  const d = (data ?? {}) as { file?: unknown; filePath?: unknown; files?: unknown }
  const first = Array.isArray(d.files) ? d.files[0] : undefined
  const rel = [d.file, d.filePath, first].find((v): v is string => typeof v === 'string' && v.length > 0)
  if (!rel) return null
  const absolute = path.isAbsolute(rel) ? rel : path.join(config.DIR_TIME, dayDir(when.plainDate), rel)
  return path.relative(config.DIR_BASE, absolute)
}

export function createImportHost(config: typeof ConfigModule, env: Record<string, string>): ImportRoutesOptions {
  const secrets = new KeychainSecretsProvider()

  const read: ImportRoutesOptions['read'] = async ({ path: filePath, name, size }) => {
    const source = sourceOf(name)
    if (source === null) return readUnknown(name)
    if (source === 'transcript') return readTranscript(await readTextFile(filePath), name)
    if (source === 'srt') return readSrt(await readTextFile(filePath), name)
    if (source === 'text') return readText(await readTextFile(filePath), name)
    if (source === 'image') return readImage(size, await imageSize(filePath).catch(() => null))
    if (source === 'document') return readDocument(name)
    const info = await probeMedia(filePath).catch(() => null)
    const limit = transcriptionUploadLimit(loadSkyConfig().ai.models.transcription)
    if (source === 'imessage-audio') return readIMessageAudio(size, info?.durationSeconds ?? null, limit)
    return readAudio(size, info?.durationSeconds ?? null, limit)
  }

  // A transcript's clock is its end; a recording's is when it stopped. Either
  // way the start is that less the length, spelled in notebook time. A
  // transcript whose cues stamp the time of day says itself when it began.
  const suggestWhen = (file: StagedFile, readback: ReadBack): string => {
    if (readback.source === 'document') return notebookWhen(ZonedDateTime.now(), config.DIR_TIME).slice(0, 10)
    const end = file.lastModified ?? Date.now()
    if (readback.clockStartSeconds !== null) {
      return notebookWhen(startOnSavedDay(end, readback.clockStartSeconds), config.DIR_TIME)
    }
    const start =
      readback.durationMinutes && readback.source !== 'imessage-audio'
        ? end - Math.round(readback.durationMinutes * 60_000)
        : end
    return notebookWhen(new ZonedDateTime(new Date(start)), config.DIR_TIME)
  }

  // The first LISTEN_SECONDS of a recording, transcribed. The scratch clip is
  // named apart: a CAF group's clips are heard at once in the same job dir.
  const hear = async (filePath: string, jobDir: string): Promise<string> => {
    const clip = path.join(jobDir, `listen-${randomUUID()}.wav`)
    try {
      await runFfmpeg('ffmpeg', ['-y', '-i', filePath, '-t', String(LISTEN_SECONDS), '-ac', '1', '-ar', '16000', clip])
      return (await transcribeAudio(await readFile(clip), 'listen.wav')).text.trim()
    } finally {
      await rm(clip, { force: true })
    }
  }

  const listen = async (filePath: string, jobDir: string): Promise<Listen | null> => {
    const heard = await hear(filePath, jobDir)
    if (!heard) return null
    const kind = await classify(heard)
    return { kind, opening: opening(heard), guess: GUESS[kind] }
  }

  // A CAF clip: its opening words alone. It is a message; no kind to guess.
  const clipOpening = async (filePath: string, jobDir: string): Promise<string | null> => {
    const heard = await hear(filePath, jobDir)
    return heard ? opening(heard) : null
  }

  const calendar = async (when: string, readback: ReadBack): Promise<CalendarMatch | null> => {
    // A screenshot or a dragged text is a conversation, and an .srt a video,
    // not a meeting; and a dragged text's time is only when it was dropped.
    // The calendar has nothing to say about any of them.
    if (['image', 'srt', 'selection', 'document', 'imessage-audio'].includes(readback.source)) return null
    const day = new PlainDate(when.slice(0, 10))
    const start = minutesOf(when.slice(11))
    const check = await checkDayMeetings(secrets, day, config.DIR_TIME)
    const events = check.meetings.map((m) => m.event).filter((e) => !e.allDay && e.status !== 'cancelled')
    const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance
    // A transcript starts when its meeting did; a memo is made after one ends.
    const matched = events.find((e) => near(minutesOf(e.start.slice(11, 16)), start, START_TOLERANCE_MINUTES))
    const justAfter =
      readback.source === 'audio'
        ? events.find((e) => {
            const end = minutesOf(e.end.slice(11, 16))
            return end <= start + START_TOLERANCE_MINUTES && end >= start - 45
          })
        : undefined
    const event = matched ?? justAfter
    if (!event) return null
    return {
      title: event.title,
      start: event.start.slice(11, 16),
      end: event.end ? event.end.slice(11, 16) : null,
      who: event.attendees.filter((a) => !a.self).map((a) => a.name ?? a.email.split('@')[0]),
      relation: matched ? 'matches' : 'just-after',
    }
  }

  // The pipeline's run record for the file — what an earlier run of the same
  // bytes left to pick up. Keyed at upload, so a run that has since moved the
  // file into the attachments is still found by its key.
  const record: ImportRoutesOptions['record'] = async ({ path: filePath, paths, key }) => {
    const runKey = key ?? (paths ? await audioTurnsKey(paths) : await sha256Of(filePath))
    const resume = await peekTranscriptRun(runKey)
    return {
      key: runKey,
      // Audio messages need only paragraph breaks after the names review, never a write-up.
      resume: paths && resume && resume.step !== 'Checking names' ? { ...resume, step: 'Formatting message' } : resume,
    }
  }

  const run = async function* (
    job: ImportJob,
    filePaths: string[],
    signal: AbortSignal,
  ): AsyncGenerator<RunEvent, RunOutcome, void> {
    const fields = job.fields
    if (!fields) return { ok: false, message: 'nothing to start with' }
    if (!job.readback.kinds.includes(fields.kind)) {
      return { ok: false, message: `this file cannot be filed as a ${fields.kind}` }
    }

    // A when the person changed goes as stated, and the command keeps it over
    // anything the words say; left as proposed, it goes as the file's clock.
    const { command, args, rawArgs } = startArgs(
      { source: job.readback.source, runKey: job.runKey, suggestedWhen: job.suggestedWhen, id: job.id },
      fields,
      filePaths,
    )
    const result = yield* runCommand(command, { context: CommandContext.server(config, env), args, rawArgs, signal })
    const file = filedPath(result.data, PlainDateTime.fromString(fields.when.slice(0, 16)), config)
    if (!result.ok) return { ok: false, message: result.message ?? `${command} did not finish`, file }
    return { ok: true, file }
  }

  return {
    dir: path.join(config.DIR_USER_DATA, 'imports'),
    read,
    suggestWhen,
    listen,
    opening: clipOpening,
    calendar,
    record,
    run,
    journalTypes: [...JournalTypes],
  }
}
