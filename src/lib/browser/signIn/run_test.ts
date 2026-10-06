import { assert, test } from '#test'
import { PrivateBrowserRun, type PrivateBrowserClient } from './run.ts'

function fixture() {
  const calls: string[] = []
  let fail = false
  const start = async (): Promise<PrivateBrowserClient> => {
    calls.push('spawn')
    return {
      listTools: async () => [],
      callTool: async (name) => {
        calls.push(name)
        return { content: [], isError: fail && name === 'sky_start' }
      },
      close: async () => {
        calls.push('exit')
      },
    }
  }
  return {
    calls,
    start,
    fail: () => {
      fail = true
    },
  }
}

test('bounded tasks share a worker while task tabs and file scopes finish in sequence', async () => {
  const f = fixture()
  const run = new PrivateBrowserRun()
  const first = await run.acquire(f.start, {})
  const queued = run.acquire(f.start, {})
  await first.callTool('browser_snapshot', {})
  await first.close()
  const second = await queued
  await second.callTool('browser_snapshot', {})
  await second.close()
  await run.close()
  let stale = false
  try {
    await first.callTool('browser_snapshot', {})
  } catch {
    stale = true
  }
  assert({
    given: 'two requested tasks and a completed run',
    should: 'reuse one worker, isolate tasks, stop the worker once, and invalidate old task handles',
    actual: [f.calls, stale],
    expected: [
      ['spawn', 'sky_start', 'browser_snapshot', 'sky_finish', 'sky_start', 'browser_snapshot', 'sky_finish', 'exit'],
      true,
    ],
  })
})

test('stopping a run cancels active and queued leases; resuming starts a new credential worker', async () => {
  const f = fixture()
  const run = new PrivateBrowserRun()
  const first = await run.acquire(f.start, {})
  const queued = run.acquire(f.start, {}).then(
    () => false,
    () => true,
  )
  await run.close()
  await first.close()
  const refused = await queued
  const resumed = await run.acquire(f.start, {})
  await resumed.close()
  await run.close()
  assert({
    given: 'an explicit pause with another task waiting',
    should: 'end credential access immediately, reject pending work, and use a fresh process after resume',
    actual: [refused, f.calls],
    expected: [true, ['spawn', 'sky_start', 'exit', 'spawn', 'sky_start', 'sky_finish', 'exit']],
  })
})

test('aborting an active task or failing to start closes the credential worker', async () => {
  for (const failing of [false, true]) {
    const f = fixture()
    const run = new PrivateBrowserRun()
    const signal = new AbortController()
    if (failing) f.fail()
    try {
      const task = await run.acquire(f.start, {}, signal.signal)
      signal.abort()
      await task.close()
    } catch {
      /* expected start failure */
    }
    await run.close()
    assert({
      given: failing ? 'a failed task start' : 'a cancelled task',
      should: 'discard its worker and authorization',
      actual: f.calls.filter((call) => call === 'exit').length,
      expected: 1,
    })
  }
})
