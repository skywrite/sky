import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { MockLanguageModelV4 } from 'ai/test'
import type { ModelProfile } from '#shared/ai/models.ts'
import { loadSkyConfig } from '#shared/config/loader.ts'
import type { SkyConfig } from '#shared/config/types.ts'
import { setConfigValue } from '#shared/config/write.ts'
import { assert, test } from '#test'
import { createVoiceIntelligence } from './intelligence.ts'
import { createWritingVoiceModel } from './model.ts'
import { EditSchema } from './types.ts'

const baseAI: SkyConfig['ai'] = {
  models: { strong: 'mock/strong', fast: 'mock/fast', transcription: 'mock/transcription' },
}

test('An existing writing agent uses the current model selection and definition for every operation', async () => {
  let ai = { ...baseAI }
  let response: unknown = { draft: 'Ready.' }
  const seen: ModelProfile[] = []
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: JSON.stringify(response) }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  })
  const resolve = createWritingVoiceModel(
    () => ({ ai }),
    (profile) => {
      seen.push(profile)
      return { model }
    },
  )
  const writer = createVoiceIntelligence(resolve)
  await writer.draft({ meaning: 'Ready.', rules: '', lessons: [], examples: [] })
  ai = {
    ...baseAI,
    writingVoiceProfile: 'my-writer',
    profiles: {
      'my-writer': { provider: 'ollama', model: 'synthetic-writer-one', options: { temperature: 0.2 } },
    },
  }
  const example = EditSchema.parse({
    source: 'settings',
    medium: 'Email',
    original: 'It is ready.',
    revised: 'Ready.',
    id: 'Sample-Draft:2',
    created: '2025-03-15',
    updated: '2025-03-15',
  })
  response = {
    before: 'It is ready.',
    after: 'Ready.',
    question: 'Why shorten this?',
    options: ['I prefer short updates.', 'Only for this recipient.'],
  }
  await writer.question(example)
  ai = {
    ...ai,
    profiles: { 'my-writer': { provider: 'ollama', model: 'synthetic-writer-two', options: { temperature: 0.4 } } },
  }
  response = { scope: 'Email', text: 'Prefer short updates.' }
  await writer.learn(example)
  ai = {
    ...ai,
    writingVoiceProfile: 'default-fable-5.1-high',
    profiles: {
      ...ai.profiles,
      'default-fable-5.1-high': { provider: 'ollama', model: 'synthetic-override' },
    },
  }
  response = { lessons: [], covered: [] }
  await writer.compact('', [])
  assert({
    given: 'a writer constructed before changing its selection and editing a custom configuration',
    should:
      'use the default initially and resolve the current definition for drafting, questions, learning, and compaction',
    actual: seen.map(({ model, options }) => [model, options?.temperature ?? null]),
    expected: [
      ['claude-fable-5-1', null],
      ['synthetic-writer-one', 0.2],
      ['synthetic-writer-two', 0.4],
      ['synthetic-override', null],
    ],
  })
})

test('An unavailable writing model reports the setting to repair without substituting another model', () => {
  const configurations: Array<NonNullable<SkyConfig['ai']['profiles']>> = [
    {},
    { missing: { provider: 'unknown', model: 'synthetic' } },
  ]
  for (const profiles of configurations) {
    let resolved = false
    const model = createWritingVoiceModel(
      () => ({ ai: { ...baseAI, writingVoiceProfile: 'missing', profiles } }),
      () => {
        resolved = true
        throw new Error('Must not resolve an unavailable configuration')
      },
    )
    let message = ''
    try {
      model()
    } catch (error) {
      message = (error as Error).message
    }
    assert({
      given: 'a missing or invalid selected model configuration',
      should: 'direct the user to Writing Voice settings',
      actual: [resolved, message.includes('Settings > Writing Voice')],
      expected: [false, true],
    })
  }
})

test('The persisted writing model selection and custom definition are reloaded together', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-voice-model-'))
  const configPath = path.join(root, 'config.jsonc')
  try {
    const seen: string[] = []
    const resolve = createWritingVoiceModel(
      () => loadSkyConfig(configPath),
      (profile) => {
        seen.push(profile.model)
        return { model: new MockLanguageModelV4() }
      },
    )
    resolve()
    setConfigValue(['ai', 'profiles', 'my-writer'], { provider: 'ollama', model: 'synthetic-one' }, configPath)
    setConfigValue(['ai', 'writingVoiceProfile'], 'my-writer', configPath)
    resolve()
    setConfigValue(['ai', 'profiles', 'my-writer', 'model'], 'synthetic-two', configPath)
    resolve()
    assert({
      given: 'model selections and profile edits saved through the actual config writer',
      should: 'load the saved selection and current definition without rebuilding the writing agent',
      actual: seen,
      expected: ['claude-fable-5-1', 'synthetic-one', 'synthetic-two'],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
