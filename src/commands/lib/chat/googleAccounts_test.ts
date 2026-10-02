import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { saveAccountTokens, saveOAuthClient } from '#lib/google/tokens.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { googleAccountsBlock, renderGoogleAccountsBlock } from './googleAccounts.ts'

test('the Google accounts block names each account, its side, and its organization', () => {
  assert({
    given: 'a work account on an organization domain and a personal account',
    should: 'give one line for each, the organization in brackets',
    actual: renderGoogleAccountsBlock([
      { email: 'jane@atlas.example', work: true, org: 'Atlas' },
      { email: 'jane@example.com', work: false },
    ]),
    expected: '- jane@atlas.example - work (Atlas)\n- jane@example.com - personal',
  })

  assert({
    given: 'a single connected account, and none',
    should: 'say nothing: there is no account to choose',
    actual: [renderGoogleAccountsBlock([{ email: 'jane@atlas.example', work: true }]), renderGoogleAccountsBlock([])],
    expected: ['', ''],
  })
})

test('the block is read from the keychain and the orgs folder, and is left out when either cannot be read', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-google-accounts-'))
  try {
    await mkdir(path.join(dir, 'orgs', 'tech'), { recursive: true })
    await writeFile(
      path.join(dir, 'orgs', 'tech', 'Atlas.md'),
      '---\nname: Atlas\nsites:\n  - https://atlas.example\n  - https://www.linkedin.com/company/atlas-example/\n---\n\n# Atlas\n',
    )
    const secrets = new TestSecretsProvider()
    await saveOAuthClient(secrets, { clientId: 'id', clientSecret: 'secret' })
    for (const email of ['jane@atlas.example', 'jane@cedar.example']) {
      await saveAccountTokens(secrets, email, { refreshToken: 'rt', scopes: [] })
    }

    assert({
      given: 'two connected accounts, one on the domain of an organization in the notebook',
      should: 'name that organization beside its account',
      actual: await googleAccountsBlock({ secrets, orgsDir: path.join(dir, 'orgs') }),
      expected: '- jane@atlas.example - work (Atlas)\n- jane@cedar.example - work',
    })

    const broken = { list: () => Promise.reject(new Error('keychain locked')) } as unknown as TestSecretsProvider
    assert({
      given: 'an orgs folder that is not there, and a keychain that cannot be read',
      should: 'still list the accounts without organizations, and leave the block out entirely',
      actual: [
        await googleAccountsBlock({ secrets, orgsDir: path.join(dir, 'missing') }),
        await googleAccountsBlock({ secrets: broken, orgsDir: path.join(dir, 'orgs') }),
      ],
      expected: ['- jane@atlas.example - work\n- jane@cedar.example - work', ''],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
