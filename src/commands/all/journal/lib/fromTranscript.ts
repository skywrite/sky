import { runOptionsFor, TranscriptRun } from '#commands/all/audio/transcript/lib/transcriptRun.ts'
import ZoomVTT from '#commands/all/audio/transcript/lib/ZoomVTT/mod.ts'
import { CommandResult } from '#commands/mod.ts'
import type { CommandArgs } from '#commands/mod.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import type { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { fileRecordedJournal, recordedJournalPlan } from './recordedJournal.ts'

/** `[h:mm:ss]` opening a turn, as the cue parsers write it */
const TURN_STAMP = /^[ \t]*\[\d+:\d{2}(?::\d{2})?\][ \t]*/

/**
 * The spoken words, the way a voice memo's transcript reads. A cue file comes
 * out of the clean pass as turn text: every turn opens with its start stamp,
 * and with its speaker's name when the file names speakers. The journal's
 * sections are cut at quoted words, which the stamps break, so they go. One
 * speaker is the person journaling, so the name goes too and the turns run
 * together — a Zoom Clip's turns are its cues, often half a sentence. Several
 * speakers keep their names, a turn to a paragraph.
 */
export function spokenText(turnText: string, speakers: string[]): string {
  const turns = turnText
    .split(/\n[ \t]*\n/)
    .map((turn) => turn.replace(TURN_STAMP, '').trim())
    .filter(Boolean)
  if (speakers.length > 1) return turns.join('\n\n')
  const label = speakers[0] ? `${speakers[0]}:` : null
  return turns.map((turn) => (label && turn.startsWith(label) ? turn.slice(label.length).trim() : turn)).join(' ')
}

/**
 * A recorded journal that arrives as its transcript — a Zoom .vtt — has nothing
 * to transcribe: the same clean pass reads its cues and checks names, then the
 * shared pipeline organizes, names and files the entries from the spoken
 * words, retaining the transcript where an audio or video journal retains its
 * recording.
 */
export async function journalFromTranscript(options: {
  /** A .vtt path, or `'true'` (the bare flag) for the newest .vtt on the Desktop */
  fromZoomVtt: string
  when: PlainDateTime
  split?: string
  fresh?: boolean
  noAutoTag?: boolean
  noAutoRel?: boolean
  context: CommandArgs['context']
  tasks: CommandArgs['tasks']
}) {
  const { context, tasks } = options
  const split = options.split ?? 'auto'
  context.output.plan(recordedJournalPlan('Transcript', split))
  const result = await tasks.run('audio:transcript:clean', { fromZoomVtt: options.fromZoomVtt, fresh: options.fresh })
  if (!result.ok || !result.data) return CommandResult.fail(`Transcript pipeline failed: ${result.message}`)
  const clean = result.data
  context.signal?.throwIfAborted()
  if (!clean.run || !clean.transcriptFilePath)
    return CommandResult.fail('The transcript could not be found for filing.')
  const { speakers } = ZoomVTT.parse(await readTextFile(clean.transcriptFilePath))
  const words = spokenText(clean.cleanedText, speakers)
  if (!words) return CommandResult.fail('The transcript came back empty.')
  const run = await TranscriptRun.open(clean.run, runOptionsFor(context))
  return fileRecordedJournal({
    ...options,
    kind: 'Transcript',
    source: clean.transcriptFilePath,
    cleanedText: words,
    rel: [...clean.who, ...clean.rel].filter(Boolean),
    run,
    split,
    reviewTypes: true,
  })
}
