/**
 * What a start of an import runs: the door command for the kind chosen,
 * its arguments, and — kept apart — what the person actually said.
 *
 * A recording can be filed as any kind: the meeting and event doors take it
 * as --from-voice-memo, the rest as --from-audio. A transcript is a meeting.
 * Text — a .txt, or a text dragged onto the day — is a meeting or a message,
 * each by --from-text. A screenshot is a message, by --from-image. An .srt is
 * a video, by --from-srt.
 *
 * The dialog's When arrives either as sky's own proposal, untouched, or as
 * a value the person changed or chose by dropping on a calendar slot.
 * A drop on the Meetings section chooses only the day, not the clock time.
 * The person's choice goes as a raw
 * argument, which the doors read as a stated start that wins over anything
 * the words say. The proposal goes as what it is, the file's clock: the
 * pipeline gives the model that fact to resolve the words against, and
 * falls back on it only when the words give no time. A dragged text has
 * no clock of its own — its proposal is when it was dropped — so none goes.
 */

import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { StartFields } from './jobs.ts'
import type { ReadBack } from './readback.ts'

export interface StartContext {
  /** What was staged: a recording, a transcript, a video's .srt, a notetaker's text, a screenshot, or a dragged text */
  source: ReadBack['source']
  /** The pipeline's record key for the file; null when the host keeps none */
  runKey: string | null
  /** The when sky proposed, notebook time, YYYY-MM-DD HH:MM */
  suggestedWhen: string
}

export interface StartArgs {
  command: string
  args: Record<string, unknown>
  /** What the person typed, as the command line would carry it */
  rawArgs: { _: string[]; when?: string }
}

/** The door and its arguments for the fields the dialog settled. */
export function startArgs(job: StartContext, fields: StartFields, input: string | string[]): StartArgs {
  const filePaths = typeof input === 'string' ? [input] : input
  const filePath = filePaths[0]
  const when = PlainDateTime.fromString(fields.when)
  const category = `${fields.category} Complete`
  const { fresh } = fields
  // A section drop changes the date without stating the proposed clock time.
  const day = fields.kind === 'meeting' && fields.dayStated ? when.plainDate.toString() : undefined
  const proposedWhen = day ? `${day} ${job.suggestedWhen.split(' ')[1]}` : job.suggestedWhen
  const stated = fields.whenStated === true || fields.when !== proposedWhen
  const rawArgs = stated ? { _: [], when: fields.when } : { _: [] }
  const text = job.source === 'text' || job.source === 'selection'
  switch (fields.kind) {
    case 'meeting':
      return {
        command: 'meeting:new',
        args: {
          ...(job.source === 'transcript'
            ? { fromZoomVtt: filePath }
            : text
              ? { fromText: filePath }
              : { fromVoiceMemo: filePath }),
          category,
          when,
          fresh,
          run: job.runKey ?? undefined,
          ...(day ? { day } : {}),
          ...(stated || job.source === 'selection' ? {} : { clock: job.suggestedWhen }),
        },
        rawArgs,
      }
    case 'journal':
      return {
        command: 'journal:new',
        args: { fromAudio: filePath, types: [fields.journalType], when, fresh },
        rawArgs,
      }
    case 'note':
      return { command: 'notes:new', args: { fromAudio: filePath, category, when, fresh }, rawArgs }
    case 'message':
      return {
        command: 'message:new',
        args: {
          ...(job.source === 'image'
            ? { fromImage: filePaths.join(',') }
            : text
              ? { fromText: filePath }
              : { fromAudio: filePath }),
          category,
          when,
          fresh,
        },
        rawArgs,
      }
    case 'event':
      return { command: 'event:new', args: { fromVoiceMemo: filePath, category, when, fresh }, rawArgs }
    case 'video':
      return {
        command: 'video:new',
        args: {
          fromSrt: filePath,
          category,
          when,
          fresh,
          run: job.runKey ?? undefined,
          ...(stated ? {} : { clock: fields.when }),
        },
        rawArgs,
      }
  }
}
