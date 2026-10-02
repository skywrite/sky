import { AccountResolutionError } from '#lib/google/mod.ts'
import { saveAccountTokens, saveOAuthClient } from '#lib/google/tokens.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { missionAccount, missionApprovalKey, missionNeedsApproval } from './approval.ts'

const DOC_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd'

test('missionNeedsApproval', async (t) => {
  await t.step('a create-only mission runs without a go', () => {
    assert({
      given: 'a mission with no target and no import',
      should: 'need no approval',
      actual: missionNeedsApproval({ mission: 'Create a doc titled Atlas Q3 Plan with: ...' }),
      expected: false,
    })
  })
  await t.step('a mission aimed at an existing file asks', () => {
    assert({
      given: 'a mission with a target file',
      should: 'need approval',
      actual: missionNeedsApproval({ mission: 'Tighten the Outlook section', file: DOC_ID }),
      expected: true,
    })
  })
  await t.step('an import asks', () => {
    assert({
      given: 'a mission importing a local file',
      should: 'need approval',
      actual: missionNeedsApproval({ mission: 'Review this contract', import: '~/deals/atlas-msa.pdf' }),
      expected: true,
    })
  })
})

test('missionApprovalKey', async (t) => {
  await t.step('a targeted mission scopes to its file id', () => {
    assert({
      given: 'a target given as a Docs URL',
      should: 'key on the file id',
      actual: missionApprovalKey({ file: `https://docs.google.com/document/d/${DOC_ID}/edit` }),
      expected: DOC_ID,
    })
  })
  await t.step('a create mission has no key', () => {
    assert({
      given: 'no target',
      should: 'have no key',
      actual: missionApprovalKey({ mission: 'x' }),
      expected: undefined,
    })
  })
})

test('missionAccount', async (t) => {
  const keychain = async (...emails: string[]) => {
    const secrets = new TestSecretsProvider()
    await saveOAuthClient(secrets, { clientId: 'id', clientSecret: 'secret' })
    for (const email of emails) await saveAccountTokens(secrets, email, { refreshToken: 'rt', scopes: [] })
    return secrets
  }
  const mission = { mission: 'Review this contract', import: '~/deals/atlas-msa.pdf' }

  await t.step('an import with one connected account runs as it', async () => {
    assert({
      given: 'one connected account and no account named',
      should: 'name that account',
      actual: await missionAccount(mission, await keychain('jane@atlas.example')),
      expected: 'jane@atlas.example',
    })
  })
  await t.step('an import whose account is an open choice has none', async () => {
    const secrets = await keychain('jane@atlas.example', 'jane@cedar.example')
    const open = await missionAccount(mission, secrets).then(
      () => undefined,
      (err) => err,
    )
    assert({
      given: 'two work accounts, with no account named and with one named by a part of it',
      should: 'leave the choice open rather than guess, and take the named one',
      actual: [open instanceof AccountResolutionError, await missionAccount({ ...mission, account: 'cedar' }, secrets)],
      expected: [true, 'jane@cedar.example'],
    })
  })
})
