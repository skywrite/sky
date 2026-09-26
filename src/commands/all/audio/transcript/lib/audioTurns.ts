import { createHash } from 'node:crypto'
import type { CommandArgs } from '#commands/mod.ts'
import { runOptionsFor, sha256Of, TranscriptRun } from './transcriptRun.ts'

/** Ordered audio bytes identify a conversation; filenames and speaker guesses do not. */
export async function audioTurnsKey(files: string[]): Promise<string> {
  if (!files.length) throw new Error('Choose at least one audio file.')
  const hashes = await Promise.all(files.map(sha256Of))
  return createHash('sha256')
    .update(JSON.stringify(['audio-turns-v1', ...hashes]))
    .digest('hex')
}

/** Each file is a turn, not a speaker identity. Children live under the conversation's retry record. */
export async function transcribeAudioTurns(
  files: string[],
  { context, tasks }: Pick<CommandArgs, 'context' | 'tasks'>,
  fresh = false,
): Promise<{ run: TranscriptRun; text: string }> {
  context.signal?.throwIfAborted()
  const run = await TranscriptRun.open(await audioTurnsKey(files), runOptionsFor(context), 'Audio conversation')
  context.signal?.throwIfAborted()
  if (fresh) await run.clear()
  const kept = await run.get('raw')
  if (kept) return { run, text: kept.data.text }
  const turns: string[] = []
  for (const [index, file] of files.entries()) {
    context.signal?.throwIfAborted()
    context.output.log(`Transcribing file ${index + 1} of ${files.length}`)
    const result = await tasks.run('audio:transcript:create', {
      file,
      run: `${run.key}/turns/${index + 1}`,
      fresh: false,
      save: false,
      output: undefined,
      delete: false,
      diarize: false,
    })
    if (!result.ok || !result.data?.transcript.trim()) {
      throw new Error(`Audio file ${index + 1}: ${result.message ?? 'Transcription returned no words.'}`)
    }
    context.signal?.throwIfAborted()
    turns.push(`### Turn ${index + 1}\n\n${result.data.transcript.trim()}`)
  }
  const text = turns.join('\n\n')
  await run.put('raw', { text })
  return { run, text }
}
