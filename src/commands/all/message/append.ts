import { sha256Of, clearTranscriptRun } from '#commands/all/audio/transcript/lib/transcriptRun.ts'
import {
  Command,
  CommandResult,
  Flag,
  type CommandArgs,
  type CommandDescription,
  type InferParams,
} from '#commands/mod.ts'
import { formatAudioTurns } from './_lib/audioConversation.ts'
import { filedClips } from './_lib/filedAudioClips.ts'
import { appendAudioConversation, readAudioConversation } from './_lib/savedAudioConversation.ts'

const params = {
  file: Flag.string('Notebook-relative path of the iMessage Audio conversation', { required: true }),
  fromAudioTurns: Flag.stringArray('Ordered audio files to add, one turn per file', { required: true }),
  audioSpeakers: Flag.stringArray('Who speaks in each audio file, in the same order', { required: true }),
  fresh: Flag.bool('Start the transcription over', { default: false }),
}

export default class MessageAppendTask extends Command {
  static override description: CommandDescription = {
    name: 'message:append',
    description: 'Add audio turns to a saved iMessage Audio conversation.',
    params,
  }

  async run({ args, context, tasks }: CommandArgs<InferParams<typeof params>>) {
    const { config, output, signal } = context
    const speakers = args.audioSpeakers.map((name) => name.trim())
    if (
      !args.fromAudioTurns.length ||
      speakers.length !== args.fromAudioTurns.length ||
      speakers.some((name) => !name || name.length > 200 || /[\r\n]/.test(name))
    )
      return CommandResult.fail("Enter who's speaking in each audio file.")
    const target = await readAudioConversation(config, args.file)
    const hashes = await Promise.all(args.fromAudioTurns.map(sha256Of))
    // Clips already in the conversation are not transcribed again; the writer checks once more under its lock.
    const known = await filedClips(config, target.conversation.path, hashes)
    const turns = args.fromAudioTurns
      .map((file, index) => ({ file, hash: hashes[index], speaker: speakers[index] }))
      .filter((turn) => {
        if (known.has(turn.hash)) return false
        known.add(turn.hash)
        return true
      })
    if (!turns.length) {
      output.log('These audio clips are already in the conversation.')
      return CommandResult.success({ filePath: target.file, added: 0 })
    }
    output.plan([
      { id: 'transcribe', label: 'Transcribing new audio' },
      { id: 'names', label: 'Checking names' },
      { id: 'paragraphs', label: 'Formatting messages' },
      { id: 'file', label: 'Adding to conversation' },
    ])
    const cleaned = await tasks.run('audio:transcript:clean', {
      fromAudioTurns: turns.map((turn) => turn.file),
      fresh: args.fresh,
      save: false,
      output: undefined,
    })
    if (!cleaned.ok || !cleaned.data) return CommandResult.fail(`Audio transcription failed: ${cleaned.message}`)
    signal?.throwIfAborted()
    output.stage('paragraphs', 'Formatting messages')
    const bodies = await formatAudioTurns(
      cleaned.data.cleanedText,
      turns.map((turn) => turn.speaker),
      { signal },
    )
    output.stage('file', 'Adding to conversation')
    const result = await appendAudioConversation(
      config,
      args.file,
      turns.map((turn, index) => ({ ...turn, body: bodies[index] })),
      cleaned.data.rel,
      signal,
    )
    if (cleaned.data.run) await clearTranscriptRun(cleaned.data.run)
    output.log(
      result.added
        ? `Added ${result.added} audio message${result.added === 1 ? '' : 's'} to the conversation.`
        : 'These audio clips are already in the conversation.',
    )
    return CommandResult.success(result)
  }
}
