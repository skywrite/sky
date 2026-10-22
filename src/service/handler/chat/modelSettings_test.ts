import { assert, test } from '#test'
import type { ChatSettingsHost, ThreadRestore } from './mod.ts'
import { restoredModelPrefs } from './modelSettings.ts'

const catalog = {
  defaultModel: 'default-opus-5.5',
  defaultContextTokens: 100_000,
  choices: () => [{ name: 'default-opus-5.5' }, { name: 'default-sonnet-5.5' }],
} as unknown as ChatSettingsHost

/** A saved chat with one exchange, whose recovery record names a profile and an effort. */
function savedUnder(profile: string, effort = 'high', modelConfig?: unknown): ThreadRestore {
  return {
    id: 'demo',
    state: {
      conversation: [
        { role: 'user', content: 'Summarize the Atlas notes.' },
        { role: 'assistant', content: 'Done.' },
      ],
      contextLog: [],
    },
    resume: { recovery: { host: { profile, effort, modelConfig } } },
  } as unknown as ThreadRestore
}

test('restoredModelPrefs - a chat saved under a retired profile opens on the default model', () => {
  const prefs = restoredModelPrefs({}, savedUnder('default-haiku-4.5'), catalog)
  assert({
    given: 'a saved chat set to a profile the catalog no longer has, with no configuration of its own',
    should: 'open on the default model at its default effort, still locked to the conversation',
    actual: [prefs.profile, prefs.effort, prefs.modelSettingsLocked],
    expected: ['default-opus-5.5', 'default', true],
  })
})

test('restoredModelPrefs - known profiles and saved configurations stay as they were', () => {
  const known = restoredModelPrefs({}, savedUnder('default-sonnet-5.5'), catalog)
  const config = { provider: 'anthropic', model: 'claude-haiku-4-5' }
  const configured = restoredModelPrefs({}, savedUnder('default-haiku-4.5', 'default', config), catalog)
  assert({
    given: 'a chat on a profile the catalog has, and one on a retired profile that kept its configuration',
    should: 'keep both as saved',
    actual: [known.profile, known.effort, configured.profile, configured.modelConfig],
    expected: ['default-sonnet-5.5', 'high', 'default-haiku-4.5', config],
  })
})

test('restoredModelPrefs - a new chat asked for a retired profile starts on the default model', () => {
  assert({
    given: 'a new chat whose pending settings name a retired profile',
    should: 'start on the default model',
    actual: restoredModelPrefs({ profile: 'default-haiku-4.5', effort: 'low' }, undefined, catalog),
    expected: { profile: 'default-opus-5.5', effort: 'default' },
  })
})

/** A saved chat whose recovery record holds its budget as the estimate the session read within. */
function savedEstimate(contextTokens: number, profile = 'default-opus-5.5'): ThreadRestore {
  return {
    id: 'demo',
    state: {
      conversation: [
        { role: 'user', content: 'Summarize the Atlas notes.' },
        { role: 'assistant', content: 'Done.' },
      ],
      contextLog: [],
    },
    resume: { recovery: { version: 1, contextTokens, host: { profile } } },
  } as unknown as ThreadRestore
}

/** The catalog with each profile's ratio: Opus 5.5 counts 1.803 tokens per estimated one. */
const counted = { ...catalog, tokenRatio: (profile: string) => (profile === 'default-opus-5.5' ? 1.803 : 1.25) }

test("restoredModelPrefs - a saved budget comes back in the model's tokens", () => {
  assert({
    given:
      'a 500k budget saved as its 277,315 estimate on Opus 5.5, a 300k saved before the slider counted the model’s tokens, and a host with no ratio',
    should: 'return 500k, the old 300k at the 540,900 it reads, and the estimate as it was',
    actual: [
      restoredModelPrefs({}, savedEstimate(277_315), counted).contextTokens,
      restoredModelPrefs({}, savedEstimate(300_000), counted).contextTokens,
      restoredModelPrefs({}, savedEstimate(300_000), catalog).contextTokens,
    ],
    expected: [500_000, 540_900, 300_000],
  })
})

test('restoredModelPrefs - a saved budget converts at the ratio of the model the chat now runs on', () => {
  const restored = restoredModelPrefs({}, savedEstimate(300_000, 'default-haiku-4.5'), counted)
  assert({
    given: 'a 300k estimate saved under a retired profile, which opens on the default model',
    should: 'read the same text on the default model: 300k at its 1.803',
    actual: [restored.profile, restored.contextTokens],
    expected: ['default-opus-5.5', 540_900],
  })
})

test('restoredModelPrefs - a saved configuration keeps its name, or takes its profile’s name back', () => {
  const unnamed = {
    provider: 'openai',
    model: 'gpt-6.1-sol',
    contextWindow: 1_050_000,
    options: { reasoningEffort: 'high', serviceTier: 'ultrafast' },
  }
  const ultrafast = { ...unnamed, label: 'GPT 6.1 Sol (Ultrafast)' }
  const named = {
    ...catalog,
    resolve: (name: string) => {
      if (name !== 'default-gpt-6.1-sol-ultrafast') throw new Error(`Unknown model profile: "${name}"`)
      return { config: { ...ultrafast, options: { ...ultrafast.options, reasoningEffort: 'low' } } }
    },
  } as unknown as ChatSettingsHost
  const kept = restoredModelPrefs({}, savedUnder('default-gpt-6.1-sol-ultrafast', 'default', ultrafast), catalog)
  const renamed = restoredModelPrefs({}, savedUnder('default-gpt-6.1-sol-ultrafast', 'default', unnamed), named)
  const standard = { ...unnamed, options: { reasoningEffort: 'high' } }
  const different = restoredModelPrefs({}, savedUnder('default-gpt-6.1-sol-ultrafast', 'default', standard), named)
  assert({
    given: 'a saved configuration with its name, the same one saved without it, and one that runs differently',
    should: 'keep the name, take the profile’s name back whatever the effort, and leave the different one unnamed',
    actual: [
      kept.modelConfig?.label,
      renamed.modelConfig?.label,
      renamed.modelConfig?.options,
      different.modelConfig?.label,
    ],
    expected: ['GPT 6.1 Sol (Ultrafast)', 'GPT 6.1 Sol (Ultrafast)', unnamed.options, undefined],
  })
})
