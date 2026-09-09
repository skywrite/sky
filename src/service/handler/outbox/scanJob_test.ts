import type { ScanProgress } from '#lib/outbox/types.ts'
import { assert, test } from '#test'
import { createTestScanExecution } from '../../../test/scanExecution.ts'
import { createScanJob } from './scanJob.ts'

function fixtureProgress(status: ScanProgress['status']): ScanProgress {
  return {
    id: 'sample-check',
    date: '2025-03-15',
    at: '2025-03-15 12:00',
    owner: 1,
    status,
    outcome: status === 'complete' ? 'acted' : 'nothing',
    total: 12,
    completed: status === 'complete' ? 12 : 3,
    considered: 12,
    prepared: 3,
    ignored: 9,
    stale: 0,
    failed: 0,
    pending: status === 'complete' ? 0 : 9,
    checks: [],
  }
}

const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

test('Check now acknowledges immediately and reconnects a new server host to the same execution', async () => {
  let release!: () => void
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  let progress: ScanProgress | null = null
  const execution = createTestScanExecution(
    async () => {
      calls++
      progress = fixtureProgress('running')
      await hold
      progress = fixtureProgress('complete')
      return { outcome: 'acted', message: 'The selected range is checked.' }
    },
    async () => progress,
  )
  const job = createScanJob(execution, async () => progress)
  const replies = await Promise.all([job.start(), job.start()])
  const running = await job.status()
  const reloaded = createScanJob(execution, async () => progress)
  const duplicate = await reloaded.start()
  release()
  await turn()
  const done = await job.status()
  const restored = await reloaded.status()
  assert({
    given: 'duplicate clicks, an in-progress request, then a new server host',
    should: 'return before completion and expose the same persisted progress and final result',
    actual: [
      calls,
      replies.every((reply) => reply.running),
      running.running,
      running.progress?.completed,
      duplicate.running,
      done.running,
      done.result?.outcome,
      restored.running,
      restored.result?.message?.includes('The selected range is checked.'),
    ],
    expected: [1, true, true, 3, true, false, 'acted', false, true],
  })
})

test('Check now exposes command failures even before a progress file can be written', async () => {
  const job = createScanJob(
    createTestScanExecution(
      async () => {
        throw new Error('Could not read saved messages.')
      },
      async () => null,
    ),
    async () => null,
  )
  await job.start()
  await turn()
  const status = await job.status()
  assert({
    given: 'an asynchronous command fails before discovering messages',
    should: 'stop checking and show its actual error',
    actual: [status.running, status.result],
    expected: [false, { outcome: 'failed', message: 'Could not read saved messages.' }],
  })
})

test('A starting worker hides the previous completed or failed check while loading', async () => {
  for (const status of ['complete', 'failed'] as const) {
    const progress = fixtureProgress(status)
    if (status === 'failed') progress.error = 'The previous worker stopped.'
    const job = createScanJob(
      {
        start: async () => {},
        status: async () => ({ running: true, previousScanId: progress.id, result: null }),
      },
      async () => progress,
    )
    assert({
      given: `an accepted worker has not replaced the previous ${status} progress file`,
      should: 'report a fresh check in progress without stale counts or errors',
      actual: await job.status(),
      expected: { running: true, progress: null, result: null },
    })
  }
})

test('A new worker failure before progress takes precedence over the previous successful check', async () => {
  const progress = fixtureProgress('complete')
  const result = { outcome: 'failed' as const, message: 'Could not load the check command.' }
  const job = createScanJob(
    {
      start: async () => {},
      status: async () => ({ running: false, previousScanId: progress.id, result }),
    },
    async () => progress,
  )
  const status = await job.status()
  assert({
    given: 'the worker fails before creating its progress file',
    should: 'show the new execution error even though an older completed check exists',
    actual: [status.running, status.result],
    expected: [false, result],
  })
})

test('A later scheduled check supersedes an old failed manual worker result', async () => {
  const progress = { ...fixtureProgress('complete'), id: 'later-scheduled-check' }
  const job = createScanJob(
    {
      start: async () => {},
      status: async () => ({
        running: false,
        previousScanId: 'earlier-check',
        result: { outcome: 'failed', message: 'The previous worker stopped.' },
      }),
    },
    async () => progress,
  )
  const status = await job.status()
  assert({
    given: 'a scheduled check completed after a manual worker failed',
    should: 'display the latest completed progress and its successful result',
    actual: [
      status.running,
      status.progress?.id,
      status.result?.outcome,
      status.result?.message?.includes('The selected range is checked.'),
    ],
    expected: [false, 'later-scheduled-check', 'acted', true],
  })
})
