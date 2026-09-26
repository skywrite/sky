export const TRANSCRIPTION_MODELS = [
  {
    value: 'openai/gpt-transcribe',
    provider: 'openai',
    label: 'OpenAI',
    model: 'gpt-transcribe',
    apiKeyEnv: 'OPENAI_API_KEY',
    maxUploadMb: 25,
    docsUrl: 'https://developers.openai.com/api/docs/guides/speech-to-text#longer-inputs',
  },
  {
    value: 'mistral/voxtral-mini-latest',
    provider: 'mistral',
    label: 'Mistral',
    model: 'voxtral-mini-latest',
    apiKeyEnv: 'MISTRAL_API_KEY',
    maxUploadMb: 500,
    docsUrl: 'https://docs.mistral.ai/resources/known-limitations#audio-transcription',
  },
] as const

export type TranscriptionModel = (typeof TRANSCRIPTION_MODELS)[number]

export function transcriptionModelValue(value: string | undefined): string {
  // This old config default was unused; recognition already used gpt-transcribe.
  return !value || value === 'openai/gpt-4o-transcribe' ? TRANSCRIPTION_MODELS[0].value : value
}

export function resolveTranscriptionModel(value?: string, provider?: string): TranscriptionModel {
  const model = TRANSCRIPTION_MODELS.find((entry) =>
    provider ? entry.provider === provider : entry.value === transcriptionModelValue(value),
  )
  if (!model) throw new Error('Choose OpenAI or Mistral in Settings → AI → Audio transcription.')
  return model
}

export interface TranscriptionSettings {
  value: string
  choices: Array<TranscriptionModel & { configured: boolean }>
}
