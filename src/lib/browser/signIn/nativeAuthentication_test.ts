import type { Page } from 'playwright'
import { assert, test } from '#test'
import { NativeAuthentication, type NativeAuthenticationApproval } from './nativeAuthentication.ts'

test('native authentication approval expires and cannot be reused after cancellation or completion', async () => {
  for (const stop of ['expired', 'cancelled', 'completed'] as const) {
    let now = 0
    let providerReads = 0
    const approval: NativeAuthenticationApproval = {
      method: async () => 'browser',
      begin: async () => true,
      provider: async () => {
        providerReads++
        return true
      },
      finish: async () => {
        if (stop === 'expired') now = 240001
        if (stop === 'cancelled') flow.stop()
        return true
      },
    }
    const flow = new NativeAuthentication(approval, () => now)
    const page = { url: () => 'https://atlas.example/login', bringToFront: async () => {} } as unknown as Page
    const completed = await flow.run(page, async () => {
      await Promise.all([flow.permit('https://id.example'), flow.permit('https://id.example')])
    })
    assert({
      given: `${stop} native authentication`,
      should: 'deduplicate concurrent prompts and leave no origin grant after the handoff',
      actual: [completed, flow.active, await flow.permit('https://id.example'), providerReads],
      expected: [stop === 'completed', false, false, 1],
    })
  }
})

test('native authentication rechecks the page after approval and rejects insecure or unbounded provider chains', async () => {
  let url = 'https://atlas.example/login'
  const page = { url: () => url, bringToFront: async () => {} } as unknown as Page
  const approval: NativeAuthenticationApproval = {
    method: async () => 'browser',
    begin: async () => true,
    provider: async () => true,
    finish: async () => true,
  }
  const flow = new NativeAuthentication(approval)
  const allowed: boolean[] = []
  await flow.run(page, async () => {
    allowed.push(await flow.permit('http://id.example'))
    for (let index = 0; index < 9; index++) allowed.push(await flow.permit(`https://id${index}.example`))
  })
  approval.begin = async () => {
    url = 'https://elsewhere.example'
    return true
  }
  const changed = await flow.run(page, async () => {
    throw new Error('Should not run')
  })
  assert({
    given: 'an insecure provider, an excessive chain, and a changed page during approval',
    should: 'deny them without inheriting the earlier grant',
    actual: [allowed, changed],
    expected: [[false, ...Array(8).fill(true), false], false],
  })
})
