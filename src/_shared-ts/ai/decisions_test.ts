import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { JEV_MODEL } from '#shared/ai/typesafe/client.ts'
import type { AIUsageRecord } from '#shared/ai/usageLog.ts'
import type { SkyConfig } from '#shared/config/types.ts'
import { assert, test } from '#test'
import {
  DECISION_PROFILES,
  DECISION_ROLES,
  decisionModel,
  decisionModelByProfile,
  decisionRoleProfile,
  getAllDecisionProfiles,
  getDecisionProfile,
  getDecisionRoles,
  isDecisionAuthError,
  isDecisionMissingKeyError,
  missingDecisionKeyError,
  noul,
  resolveDecisionProfile,
} from './decisions.ts'

const EMPTY_AI: SkyConfig['ai'] = { models: { strong: '', fast: '', transcription: '' } }

test('default decision role resolves to the built-in TypeSafe Jev profile', () => {
  const role = decisionRoleProfile('default', EMPTY_AI)
  const profile = getDecisionProfile(role, EMPTY_AI)
  assert({
    given: 'no decision overrides in config',
    should: 'resolve default to default-typesafe-jev on the pinned Jev release',
    actual: [role, DECISION_ROLES.default, profile],
    expected: [
      'default-typesafe-jev',
      'default-typesafe-jev',
      {
        provider: 'typesafe',
        model: JEV_MODEL,
        label: 'TypeSafe Jev',
        contextWindow: 64_000,
      },
    ],
  })
})

test('custom decision profiles and role overrides win over built-ins and skip invalid entries', () => {
  const config: SkyConfig['ai'] = {
    ...EMPTY_AI,
    decisionProfiles: {
      'custom-jev': { provider: 'typesafe', model: 'jev-1.14.0', baseUrl: 'https://example.com/typesafe' },
      'invalid-provider': { provider: 'unknown', model: 'something' },
      'blank-model': { provider: 'typesafe', model: '   ' },
    },
    decisionRoles: { default: 'custom-jev' },
  }
  const all = getAllDecisionProfiles(config)
  const roles = getDecisionRoles(config)
  const resolved = getDecisionProfile(roles.default, config)
  assert({
    given: 'valid and invalid user decisionProfiles with a default role override',
    should: 'expose built-ins plus valid custom profiles and resolve the overridden role',
    actual: [Object.keys(all).sort(), roles.default, resolved],
    expected: [
      ['custom-jev', 'default-typesafe-jev'],
      'custom-jev',
      {
        provider: 'typesafe',
        model: 'jev-1.14.0',
        baseUrl: 'https://example.com/typesafe',
        contextWindow: undefined,
        label: undefined,
      },
    ],
  })
})

test('resolveDecisionProfile sends the profile model and baseUrl, checks key presence, and meters usage', async () => {
  const secrets = new TestSecretsProvider()
  const sent: Array<{ url: string; model: string }> = []
  const usage: AIUsageRecord[] = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model: string }
    sent.push({ url: String(input), model: body.model })
    return Response.json({
      model: body.model,
      answers: { ok: { type: 'noul', noul: 0.91 } },
      usage: { input_tokens: 42, output_tokens: 0 },
    })
  }) as typeof fetch

  const model = resolveDecisionProfile(
    { provider: 'typesafe', model: 'jev-1.14.0', baseUrl: 'https://example.com/decision-api' },
    { secrets, fetch: fetchFn },
  )
  const beforeKey = await model.hasKey()
  let missingError: unknown
  try {
    await model.ask({ state: { text: 'hello' }, questions: { ok: noul('Is this a greeting?') } }, { sink: () => {} })
  } catch (error) {
    missingError = error
  }

  await secrets.set('typesafe', 'main', createSecret('tsk-synthetic'))
  const afterKey = await model.hasKey()
  const answer = await model.ask(
    { state: { text: 'hello' }, questions: { ok: noul('Is this a greeting?') } },
    { sink: (record) => void usage.push(record) },
  )

  assert({
    given: 'a custom TypeSafe decision profile before and after storing a key',
    should: 'report key presence, surface missing-key errors, send the profile model and baseUrl, and log usage',
    actual: [
      beforeKey,
      isDecisionMissingKeyError(missingError),
      isDecisionAuthError(missingError),
      isDecisionMissingKeyError(missingDecisionKeyError('typesafe')),
      afterKey,
      sent,
      answer.answers.ok.noul,
      usage.map((r) => [r.provider, r.model, r.input, r.output]),
    ],
    expected: [
      false,
      true,
      true,
      true,
      true,
      [{ url: 'https://example.com/decision-api/v1/systemone', model: 'jev-1.14.0' }],
      0.91,
      [['typesafe', 'jev-1.14.0', 42, 0]],
    ],
  })
})

test('decisionModel and decisionModelByProfile resolve the default profile and reject unknown names', () => {
  const secrets = new TestSecretsProvider()
  const byRole = decisionModel('default', { secrets })
  const byName = decisionModelByProfile('default-typesafe-jev', { secrets })
  let unknownMessage = ''
  try {
    getDecisionProfile('nonexistent', EMPTY_AI)
  } catch (error) {
    unknownMessage = (error as Error).message
  }
  assert({
    given: 'role and profile lookups, plus an unknown profile name',
    should: 'resolve the configured TypeSafe Jev profile and throw a descriptive error for unknown names',
    actual: [
      byRole.provider,
      byRole.model,
      byName.profile,
      unknownMessage.includes('Unknown decision profile: "nonexistent"'),
    ],
    expected: ['typesafe', JEV_MODEL, DECISION_PROFILES['default-typesafe-jev'], true],
  })
})
