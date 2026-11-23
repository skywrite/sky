import { assert, test } from '#test'
import type { ChatSettingsHost, ThreadRestore } from './mod.ts'
import { restoredModelPrefs } from './modelSettings.ts'

const catalog = {
  defaultModel: 'default-opus-5.5',
  readingBudget: () => 100_000,
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
  for (const profile of ['default-haiku-4.5', 'default-fable-5.1', 'default-fable-5.1-high']) {
    const prefs = restoredModelPrefs({}, savedUnder(profile), catalog)
    assert({
      given: 'a saved chat set to a profile the catalog no longer has, with no configuration of its own',
      should: 'open on the default model at its default effort, still locked to the conversation',
      actual: [prefs.profile, prefs.effort, prefs.modelSettingsLocked],
      expected: ['default-opus-5.5', 'default', true],
    })
  }
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

test('restoredModelPrefs - a budget a chat was saved with is not restored', () => {
  const saved = {
    ...savedUnder('default-opus-5.5'),
    resume: {
      recovery: { version: 1, contextTokens: 277_315, host: { profile: 'default-opus-5.5', contextTokens: 500_000 } },
    },
  } as unknown as ThreadRestore
  assert({
    given: 'a chat saved while it had a budget of its own, in its snapshot and in its saved file',
    should: 'open with its model and effort alone: what it reads is what that model holds',
    actual: restoredModelPrefs({}, saved, catalog),
    expected: { modelSettingsLocked: true, modelConfig: undefined, profile: 'default-opus-5.5', effort: 'default' },
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
