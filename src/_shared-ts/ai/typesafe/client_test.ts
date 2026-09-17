import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { checkPastedTypeSafeKey, checkTypeSafeKey, createTypeSafeClient, MISSING_TYPESAFE_KEY } from './client.ts'

const MODELS = JSON.stringify({
  models: [{ name: 'jev-1.13.0', description: 'The first System One model.', release_date: '2026-09-16' }],
})
const REFUSAL = JSON.stringify({
  detail: { error_type: 'authentication_error', message: 'Cannot authenticate with the server.' },
})
const JSON_HEADERS = { 'content-type': 'application/json' }

/** A host that answers every request the same way, and remembers what it was asked. */
function host(answer: () => Response | Error): { calls: { url: string; auth: string | null }[]; fetch: typeof fetch } {
  const calls: { url: string; auth: string | null }[] = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), auth: new Headers(init?.headers).get('authorization') })
    const result = answer()
    if (result instanceof Error) throw result
    return result
  }) as typeof fetch
  return { calls, fetch: fetchFn }
}

test('a keychain client lists the models the stored key may use', async () => {
  const secrets = new TestSecretsProvider({ 'typesafe/main': createSecret('tsk-test-key') })
  const recorder = host(() => new Response(MODELS, { status: 200, headers: JSON_HEADERS }))

  const check = await checkTypeSafeKey(createTypeSafeClient({ secrets, fetch: recorder.fetch }))
  assert({
    given: 'a key in the keychain and a host that lists one model',
    should: 'sign the models request with the keychain key and read the names back',
    actual: [recorder.calls[0]?.url, recorder.calls[0]?.auth, check],
    expected: ['https://api.typesafe.ai/v1/models', 'Bearer tsk-test-key', { ok: true, models: ['jev-1.13.0'] }],
  })
})

test('a missing key fails the check with where the key goes, without a request', async () => {
  const recorder = host(() => new Response(MODELS, { status: 200, headers: JSON_HEADERS }))

  const check = await checkTypeSafeKey(
    createTypeSafeClient({ secrets: new TestSecretsProvider(), fetch: recorder.fetch }),
  )
  assert({
    given: 'no typesafe/main entry in the keychain',
    should: 'fail naming the settings page and the command, and never reach the network',
    actual: [check, recorder.calls.length],
    expected: [{ ok: false, refused: false, message: MISSING_TYPESAFE_KEY }, 0],
  })
})

test('a stored key TypeSafe no longer takes reads as refused', async () => {
  const secrets = new TestSecretsProvider({ 'typesafe/main': createSecret('tsk-revoked-key') })
  const recorder = host(() => new Response(REFUSAL, { status: 401, headers: JSON_HEADERS }))

  const check = await checkTypeSafeKey(createTypeSafeClient({ secrets, fetch: recorder.fetch }))
  assert({
    given: 'a host answering 401',
    should: 'say the key was refused, after one attempt',
    actual: [check, recorder.calls.length],
    expected: [{ ok: false, refused: true, message: 'TypeSafe refused the key.' }, 1],
  })
})

test('a pasted key is checked with TypeSafe before it is stored', async () => {
  const accepted = host(() => new Response(MODELS, { status: 200, headers: JSON_HEADERS }))
  const refused = host(() => new Response(REFUSAL, { status: 401, headers: JSON_HEADERS }))
  const down = host(() => new Error('ECONNREFUSED'))
  const broken = host(() => new Response('overloaded', { status: 529 }))

  assert({
    given: 'the same pasted key against four hosts',
    should: 'sign with the pasted key, and answer accepted, refused, unreachable, or the host’s status',
    actual: [
      accepted.calls.length,
      await checkPastedTypeSafeKey('tsk-pasted-key', accepted.fetch),
      accepted.calls[0]?.auth,
      await checkPastedTypeSafeKey('tsk-pasted-key', refused.fetch),
      await checkPastedTypeSafeKey('tsk-pasted-key', down.fetch),
      await checkPastedTypeSafeKey('tsk-pasted-key', broken.fetch),
    ],
    expected: [
      0,
      { ok: true, models: ['jev-1.13.0'] },
      'Bearer tsk-pasted-key',
      { ok: false, refused: true, message: 'TypeSafe refused the key.' },
      { ok: false, refused: false, message: 'TypeSafe could not be reached.' },
      { ok: false, refused: false, message: 'TypeSafe answered 529 overloaded' },
    ],
  })
})
