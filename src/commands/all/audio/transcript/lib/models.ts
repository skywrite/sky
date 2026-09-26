export interface TranscriptionModel {
  value: string
  provider: 'openai' | 'mistral' | 'macwhisper'
  label: string
  model: string
  apiKeyEnv: string | null
  /** null for local engines, which have no provider upload cap. */
  maxUploadMb: number | null
  docsUrl: string
}

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
  {
    value: 'macwhisper/default',
    provider: 'macwhisper',
    label: 'MacWhisper (local)',
    model: 'default',
    apiKeyEnv: null,
    maxUploadMb: null,
    docsUrl: 'https://docs.macwhisper.com/article/57-macwhisper-command-line-tool',
  },
] as const satisfies readonly TranscriptionModel[]

export interface MacWhisperModel {
  id: string
  name: string
  size: string | null
  current: boolean
}

export interface MacWhisperModels {
  available: boolean
  models: MacWhisperModel[]
  error: string | null
}

/** Only local engines: a cloud selection must never inherit the uncapped local upload path. */
export function isLocalMacWhisperModel(id: string): boolean {
  return /^(whisper-cpp|whisperkit|parakeet|parakeet-pro|qwen3-asr|apple):[a-zA-Z0-9][a-zA-Z0-9._/+\-]*$/.test(id)
}

export function transcriptionModelValue(value: string | undefined): string {
  // This old config default was unused; recognition already used gpt-transcribe.
  return !value || value === 'openai/gpt-4o-transcribe' ? TRANSCRIPTION_MODELS[0].value : value
}

export function resolveTranscriptionModel(value?: string, provider?: string): TranscriptionModel {
  const saved = transcriptionModelValue(value)
  if (provider === 'macwhisper' || (!provider && saved.startsWith('macwhisper/'))) {
    const id = saved.startsWith('macwhisper/') ? saved.slice('macwhisper/'.length) : 'default'
    if (id === 'default' || isLocalMacWhisperModel(id)) {
      return { ...TRANSCRIPTION_MODELS[2], value: `macwhisper/${id}`, model: id }
    }
  }
  const model = TRANSCRIPTION_MODELS.find((entry) => (provider ? entry.provider === provider : entry.value === saved))
  if (!model) throw new Error('Choose OpenAI, Mistral, or MacWhisper in Settings → AI → Audio transcription.')
  return model
}

export function transcriptionUploadLimit(value?: string): number {
  return (resolveTranscriptionModel(value).maxUploadMb ?? Infinity) * 1024 * 1024
}

export interface TranscriptionSettings {
  value: string
  choices: Array<TranscriptionModel & { configured: boolean }>
}
