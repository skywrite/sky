import { runOptionsFor, TranscriptRun } from '#commands/all/audio/transcript/lib/transcriptRun.ts'
import { CommandResult } from '#commands/mod.ts'
import type { CommandArgs } from '#commands/mod.ts'
import type { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { fileRecordedJournal, recordedJournalPlan } from './recordedJournal.ts'

export async function journalFromAudio(options: {
  fromAudio: string
  when: PlainDateTime
  types: string[]
  split?: string
  fresh?: boolean
  noAutoTag?: boolean
  noAutoRel?: boolean
  context: CommandArgs['context']
  tasks: CommandArgs['tasks']
}) {
  const { context, tasks } = options
  context.output.plan(recordedJournalPlan('Audio', options.split))
  const result = await tasks.run('audio:transcript:clean', { fromAudio: options.fromAudio, fresh: options.fresh })
  if (!result.ok || !result.data) return CommandResult.fail(`Audio pipeline failed: ${result.message}`)
  const clean = result.data
  context.signal?.throwIfAborted()
  if (!clean.cleanedText.trim()) return CommandResult.fail('The transcript came back empty.')
  if (!clean.run || !clean.audioFilePath) return CommandResult.fail('The recording could not be found for filing.')
  const run = await TranscriptRun.open(clean.run, runOptionsFor(context))
  return fileRecordedJournal({
    ...options,
    kind: 'Audio',
    source: clean.audioFilePath,
    cleanedText: clean.cleanedText,
    rel: [...clean.who, ...clean.rel].filter(Boolean),
    run,
    reviewTypes: Boolean(options.split),
  })
}
