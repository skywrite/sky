import { loadSkyConfig } from '#shared/config/loader.ts'
import { transcribeWithMacWhisper } from './macwhisper.ts'
import { transcribeWithMistral } from './mistral.ts'
import { resolveTranscriptionModel } from './models.ts'
import { transcribeWithOpenAI, type TranscribeOptions, type Transcription } from './transcribe.ts'

export interface AudioTranscriptionOptions extends TranscribeOptions {
  model?: string
  diarize?: boolean
}

/** Read the saved choice for each new recording, including in the running service. */
export async function transcribeAudio(
  audioData: Uint8Array,
  fileName: string,
  options: AudioTranscriptionOptions = {},
): Promise<Transcription> {
  options.signal?.throwIfAborted()
  const selected = resolveTranscriptionModel(options.model ?? loadSkyConfig().ai.models.transcription)
  if (selected.provider === 'macwhisper')
    return transcribeWithMacWhisper(audioData, fileName, { ...options, model: selected.value })
  if (selected.provider === 'mistral') return transcribeWithMistral(audioData, fileName, options)
  return transcribeWithOpenAI(audioData, fileName, options)
}
