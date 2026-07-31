import { assert, test } from '#test'
import { startLoopback } from './loopback.ts'

type Settled = { code?: string; err?: Error; status?: number }

/** Await the code and fire the callback together so the promise always has handlers attached. */
async function callback(server: Awaited<ReturnType<typeof startLoopback>>, query: string): Promise<Settled> {
  const [settled, res] = await Promise.all([
    server.waitForCode({ timeoutMs: 5000 }).then(
      (code) => ({ code }) as Settled,
      (err) => ({ err: err as Error }) as Settled,
    ),
    fetch(`${server.redirectUri}?${query}`),
  ])
  return { ...settled, status: res.status }
}

test('startLoopback resolves the code', async () => {
  const server = await startLoopback('state-1')
  try {
    const settled = await callback(server, 'state=state-1&code=the-code')

    assert({
      given: 'the browser callback with matching state',
      should: 'answer 200 and resolve with the authorization code',
      expected: [200, 'the-code', undefined],
      actual: [settled.status, settled.code, settled.err],
    })
  } finally {
    server.close()
  }
})

test('startLoopback rejects on state mismatch', async () => {
  const server = await startLoopback('expected-state')
  try {
    const settled = await callback(server, 'state=wrong-state&code=x')

    assert({
      given: 'a callback with the wrong state',
      should: 'reject mentioning the state mismatch',
      expected: true,
      actual: settled.err?.message.includes('state') ?? false,
    })
  } finally {
    server.close()
  }
})

test('startLoopback rejects on provider error', async () => {
  const server = await startLoopback('state-2')
  try {
    const settled = await callback(server, 'error=access_denied&state=state-2')

    assert({
      given: 'a callback carrying an OAuth error',
      should: 'reject with that error',
      expected: true,
      actual: settled.err?.message.includes('access_denied') ?? false,
    })
  } finally {
    server.close()
  }
})
