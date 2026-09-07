import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { GoogleClient } from './client.ts'

test('GoogleClient has no report-delivery bypass around the Gmail send guard', () => {
  const client = new GoogleClient({
    secrets: new TestSecretsProvider(),
    email: 'jane@example.com',
    client: { clientId: 'fake-client', clientSecret: 'fake-secret' },
  })
  assert({
    given: 'a caller looking for the former separately authorized report-send method',
    should: 'expose no callable send capability',
    actual: typeof Reflect.get(client, 'sendAuthorizedMessage'),
    expected: 'undefined',
  })
})

test('GoogleClient blocks Gmail sends through every request helper before authentication', async () => {
  let requests = 0
  const client = new GoogleClient({
    secrets: new TestSecretsProvider(),
    email: 'jane@example.com',
    client: { clientId: 'fake-client', clientSecret: 'fake-secret' },
    fetchFn: (async (_url: unknown, _init?: RequestInit): Promise<Response> => {
      requests++
      throw new Error('No request should leave.')
    }) as typeof fetch,
  })
  const helpers = [
    (url: string) => client.request(url, { method: 'POST', body: '{}' }),
    (url: string) => client.getJson(url),
    (url: string) => client.postJson(url, {}),
    (url: string) => client.putJson(url, {}),
    (url: string) => client.getText(url),
    (url: string) => client.getBytes(url),
  ]
  const refused: boolean[] = []
  for (const url of [
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send',
    'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media',
  ]) {
    for (const run of helpers) {
      try {
        await run(url)
        refused.push(false)
      } catch (error) {
        refused.push(error instanceof Error && error.message.includes('Gmail send endpoint'))
      }
    }
  }
  assert({
    given: 'message-send, draft-send, and upload-send URLs through all six request entry points without stored tokens',
    should: 'reject sending itself before attempting authentication or a network request',
    actual: [refused.length, refused.every(Boolean), requests],
    expected: [18, true, 0],
  })
})
