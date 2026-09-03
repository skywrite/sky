/**
 * What a start of an import runs: the door command for the kind chosen,
 * its arguments, and — kept apart — what the person actually said.
 *
 * A recording can be filed as any kind; each door takes it as --from-audio,
 * the meeting door as --from-voice-memo. A transcript and a notetaker's
 * text are meetings. A screenshot is a message, by --from-image.
 *
 * The dialog's When arrives either as sky's own proposal, untouched, or as
 * a value the person changed. Only the second is theirs. It goes as a raw
 * argument, which the doors read as a stated start that wins over anything
 * the words say. The proposal goes as what it is, the file's clock: the
 * pipeline gives the model that fact to resolve the words against, and
 * falls back on it only when the words give no time.
 */

import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { StartFields } from './jobs.ts'
import type { ReadBack } from './readback.ts'

export interface StartContext {
  /** What was staged: a recording, a transcript, a notetaker's text, or a screenshot */
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
export function startArgs(job: StartContext, fields: StartFields, filePath: string): StartArgs {
  const when = PlainDateTime.fromString(fields.when)
  const category = `${fields.category} Complete`
  const { fresh } = fields
  // Changed by hand, the when is the person's word; left as proposed, it is sky's reading.
  const stated = fields.when !== job.suggestedWhen
  const rawArgs = stated ? { _: [], when: fields.when } : { _: [] }
  switch (fields.kind) {
    case 'meeting':
      return {
        command: 'meeting:new',
        args: {
          ...(job.source === 'transcript'
            ? { fromZoomVtt: filePath }
            : job.source === 'text'
              ? { fromText: filePath }
              : { fromVoiceMemo: filePath }),
          category,
          when,
          fresh,
          run: job.runKey ?? undefined,
          ...(stated ? {} : { clock: fields.when }),
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
          ...(job.source === 'image' ? { fromImage: filePath } : { fromAudio: filePath }),
          category,
          when,
          fresh,
        },
        rawArgs,
      }
    case 'event':
      return { command: 'event:new', args: { fromAudio: filePath, category, when, fresh }, rawArgs }
  }
}
