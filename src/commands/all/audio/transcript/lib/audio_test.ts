import { spyOn } from 'bun:test'
import * as loader from '#shared/config/loader.ts'
import { assert, test } from '#test'
import { transcribeAudio } from './audio.ts'
import * as mistral from './mistral.ts'
import { resolveTranscriptionModel } from './models.ts'
import * as openai from './transcribe.ts'

test('saved transcription changes reach the next call and explicit choices win', async () => {
  const config = loader.loadSkyConfig('/tmp/sky-transcription-config-not-present.jsonc')
  const read = spyOn(loader, 'loadSkyConfig').mockImplementation(() => config)
  const calls: string[] = []
  const openaiCall = spyOn(openai, 'transcribeWithOpenAI').mockImplementation(async () => {
    calls.push('openai')
    return { text: 'OpenAI words' }
  })
  const mistralCall = spyOn(mistral, 'transcribeWithMistral').mockImplementation(async () => {
    calls.push('mistral')
    return { text: 'Mistral words' }
  })
  try {
    const audio = new Uint8Array([1, 2, 3])
    await transcribeAudio(audio, 'sample.wav')
    config.ai.models.transcription = 'mistral/voxtral-mini-latest'
    await transcribeAudio(audio, 'sample.wav')
    const override = resolveTranscriptionModel(config.ai.models.transcription, 'openai')
    await transcribeAudio(audio, 'sample.wav', { model: override.value })
    config.ai.models.transcription = 'openai/gpt-4o-transcribe'
    await transcribeAudio(audio, 'sample.wav')
    let cancelled = false
    try {
      await transcribeAudio(audio, 'sample.wav', { signal: AbortSignal.abort() })
    } catch {
      cancelled = true
    }
    let refused = false
    try {
      await transcribeAudio(audio, 'sample.wav', { model: 'unknown/model' })
    } catch {
      refused = true
    }
    assert({
      given: 'a provider change, a CLI override, a legacy setting, cancellation, and an unknown model',
      should: 'route each fresh call correctly without sending cancelled or invalid requests',
      actual: [calls, override.model, cancelled, refused],
      expected: [['openai', 'mistral', 'openai', 'openai'], 'gpt-transcribe', true, true],
    })
  } finally {
    read.mockRestore()
    openaiCall.mockRestore()
    mistralCall.mockRestore()
  }
})
