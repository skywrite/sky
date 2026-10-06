import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { GMAIL_SCOPE } from './gmail.ts'
import { listOwnAddresses } from './ownAddresses.ts'
import { saveAccountTokens, saveOAuthClient } from './tokens.ts'

async function twoAccounts(): Promise<TestSecretsProvider> {
  const secrets = new TestSecretsProvider()
  await saveOAuthClient(secrets, { clientId: 'id', clientSecret: 'sec' })
  await saveAccountTokens(secrets, 'jane@example.com', { refreshToken: 'rt', accessToken: 'at', scopes: [GMAIL_SCOPE] })
  // Connected before mail was asked for: Gmail cannot be asked about it.
  await saveAccountTokens(secrets, 'jane.doe@example.net', { refreshToken: 'rt', accessToken: 'at', scopes: [] })
  return secrets
}

function gmailAnswering(status: number, body: unknown, calls: string[]): typeof fetch {
  return (async (url: unknown) => {
    calls.push(String(url))
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
}

test('listOwnAddresses', async () => {
  const calls: string[] = []
  const sendAs = {
    sendAs: [
      { sendAsEmail: 'jane@example.com', isPrimary: true },
      { sendAsEmail: 'Jane@Example.org', verificationStatus: 'accepted' },
    ],
  }
  const addresses = await listOwnAddresses(await twoAccounts(), { fetchFn: gmailAnswering(200, sendAs, calls) })
  assert({
    given: 'an account whose Gmail sends as a second address, and an account without a mail grant',
    should: 'count both accounts and the alias, once each and lowercased, asking Gmail only where it can answer',
    expected: { addresses: ['jane.doe@example.net', 'jane@example.com', 'jane@example.org'], calls: 1 },
    actual: { addresses, calls: calls.length },
  })

  const refused = await listOwnAddresses(await twoAccounts(), { fetchFn: gmailAnswering(403, {}, []) })
  assert({
    given: 'Gmail refusing the question',
    should: 'still count each account as itself',
    expected: ['jane.doe@example.net', 'jane@example.com'],
    actual: refused,
  })

  assert({
    given: 'no connected accounts',
    should: 'know no addresses',
    expected: [],
    actual: await listOwnAddresses(new TestSecretsProvider()),
  })
})
