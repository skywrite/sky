import OpenAI, { toFile } from 'openai'

/**
 * One transcription call, streamed when the model allows it. The deltas
 * are the only progress a transcription offers — there is no percentage —
 * so a caller that renders them shows the transcript as it is heard.
 */

export interface TranscribeOptions {
  /** Settled glossary vocabulary that guides recognition of names and jargon */
  keywords?: string[]
  /** Each piece of text as it is recognized, in order */
  onDelta?: (text: string) => void
  /** The host's cancel */
  signal?: AbortSignal
}

export interface Transcription {
  text: string
  durationSeconds?: number
  language?: string
}

export const TRANSCRIPTION_MODEL = 'gpt-transcribe'

export async function transcribeWithOpenAI(
  audioData: Uint8Array,
  fileName: string,
  options: TranscribeOptions = {},
): Promise<Transcription> {
  const client = new OpenAI()
  const audioFile = await toFile(audioData, fileName)
  const keywords = options.keywords ?? []
  const shared = {
    file: audioFile,
    model: TRANSCRIPTION_MODEL,
    ...(keywords.length > 0 && { keywords }),
  }

  if (options.onDelta) {
    // A stream that fails before its first word falls back to the plain call;
    // one that fails mid-way surfaces, since retrying would replay the words.
    let started = false
    try {
      const stream = await client.audio.transcriptions.create(
        { ...shared, response_format: 'json', stream: true },
        { signal: options.signal },
      )
      let text = ''
      let language: string | undefined
      for await (const event of stream) {
        if (event.type === 'transcript.text.delta') {
          started = true
          text += event.delta
          options.onDelta(event.delta)
        } else if (event.type === 'transcript.text.done') {
          // The streamed done event counts tokens, not seconds — a caller that
          // needs the length reads it off the file instead.
          text = event.text
          language = event.languages?.map((l) => l.code).join(', ') || undefined
        }
      }
      return { text, language }
    } catch (err) {
      if (started) throw err
    }
  }

  const result = await client.audio.transcriptions.create(
    { ...shared, response_format: 'json' },
    { signal: options.signal },
  )
  return {
    text: result.text,
    durationSeconds: result.usage?.type === 'duration' ? result.usage.seconds : undefined,
    language: result.languages?.map((l) => l.code).join(', ') || undefined,
  }
}
