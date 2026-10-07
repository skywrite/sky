import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { exists, makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { type ImportEvent, type ImportJob, JobStore } from './jobs.ts'
import { readDocument } from './readback.ts'

class DelayedJobStore extends JobStore {
  gate: Promise<void> | null = null

  override async persist(job: ImportJob): Promise<void> {
    const snapshot = structuredClone(job)
    if (this.gate) await this.gate
    await super.persist(snapshot)
  }
}

test('state readers wait through queued transitions and each event keeps its own fields', async () => {
  const store = new DelayedJobStore(await makeTempDir())
  const record = await store.add(runningJob())
  const firstGate = Promise.withResolvers<void>()
  const secondGate = Promise.withResolvers<void>()
  store.gate = firstGate.promise
  const first = store.setState(record, 'needs-you', { line: 'Choose a category.' })
  let ready = false
  const read = store.waitForState(record).then(() => {
    ready = true
  })
  store.gate = secondGate.promise
  const second = store.setState(record, 'running', { line: 'Writing…' })
  let listed = false
  const list = store.list().then((jobs) => {
    listed = true
    return jobs
  })
  firstGate.resolve()
  await first
  const betweenSaves = [ready, listed]
  secondGate.resolve()
  await Promise.all([second, read])
  const jobs = await list
  assert({
    given: 'an answer queues a new state while a reader is waiting for the question state to save',
    should: 'wait for both writes and keep the question and progress lines on their respective events',
    actual: {
      betweenSaves,
      events: record.events.map((event) => (event.type === 'state' ? [event.state, event.line] : null)),
      listed: jobs.map((job) => [job.state, job.line]),
    },
    expected: {
      betweenSaves: [false, false],
      events: [
        ['needs-you', 'Choose a category.'],
        ['running', 'Writing…'],
      ],
      listed: [['running', 'Writing…']],
    },
  })
})

test('a failed state save cannot announce or expose completion', async () => {
  const store = new DelayedJobStore(await makeTempDir())
  const record = await store.add(runningJob())
  store.gate = Promise.reject(new Error('Synthetic storage failure.'))
  const changeError = await store.setState(record, 'done').then(() => null, String)
  const readError = await store.waitForState(record).then(() => null, String)
  const listError = await store.list().then(() => null, String)
  const saved = JSON.parse(await readFile(path.join(store.jobDir(record.job.id), 'job.json'), 'utf8'))
  assert({
    given: 'saving the completed state fails',
    should: 'propagate the save failure and leave the saved state and event stream without a completion',
    actual: [changeError, readError, listError, saved.state, record.events],
    expected: Array(3).fill('Error: Synthetic storage failure.').concat(['running', []]),
  })
})

test('removing an import waits for its state save so the writer cannot recreate the directory', async () => {
  const store = new DelayedJobStore(await makeTempDir())
  const record = await store.add(runningJob())
  const gate = Promise.withResolvers<void>()
  store.gate = gate.promise
  const change = store.setState(record, 'cancelled')
  let removed = false
  const remove = store.remove(record.job.id).then(() => {
    removed = true
  })
  const beforeSave = removed
  gate.resolve()
  await Promise.all([change, remove])
  assert({
    given: 'a cancelled import is removed while its final state is saving',
    should: 'finish the state write before deleting the import and its directory',
    actual: [beforeSave, removed, store.get(record.job.id), await exists(store.jobDir(record.job.id))],
    expected: [false, true, undefined, false],
  })
})

function runningJob(): ImportJob {
  return {
    id: 'atlas-import',
    file: { name: 'atlas.pdf', size: 100, lastModified: null },
    readback: readDocument('atlas.pdf'),
    listen: null,
    calendar: null,
    suggestedWhen: '2031-03-16 08:00',
    runKey: null,
    resume: null,
    fields: null,
    state: 'running',
    plan: null,
    stage: null,
    tick: null,
    line: 'Working…',
    title: 'Atlas document',
    result: null,
    error: null,
    created: '2031-03-16T08:00:00.000Z',
  }
}

for (const state of ['done', 'failed', 'cancelled'] as const) {
  test(`${state} is saved before notification, including an immediate restart`, async () => {
    const store = new DelayedJobStore(await makeTempDir())
    const record = await store.add(runningJob())
    const gate = Promise.withResolvers<void>()
    store.gate = gate.promise
    const notifications: ImportEvent[] = []
    const savedAtNotification: Promise<ImportJob>[] = []
    store.subscribe(record, (event) => {
      notifications.push(event)
      savedAtNotification.push(
        readFile(path.join(store.jobDir(record.job.id), 'job.json'), 'utf8').then((text) => JSON.parse(text)),
      )
    })
    const result = state === 'done' ? { file: 'time/2031/W11/03-16/notes/Atlas.md' } : null
    const error = state === 'done' ? null : `Synthetic ${state} outcome.`
    const change = store.setState(record, state, { result, error, line: error ?? 'Filed · Atlas' })
    const beforeSave = [...notifications]
    const savedBefore = JSON.parse(await readFile(path.join(store.jobDir(record.job.id), 'job.json'), 'utf8'))
    gate.resolve()
    await change
    const [saved] = await Promise.all(savedAtNotification)
    const restarted = new JobStore(store.dir)
    await restarted.load()
    assert({
      given: `a ${state} transition while its disk write is held, then a restart as soon as it is announced`,
      should: 'announce only the saved outcome and never restore it as an interrupted run',
      actual: {
        beforeSave,
        savedBefore: savedBefore.state,
        events: notifications.map((event) =>
          event.type === 'state' ? [event.state, event.result, event.error] : null,
        ),
        saved: [saved?.state, saved?.result, saved?.error, typeof saved?.settled],
        restarted: restarted.get(record.job.id)?.job.state ?? null,
        restartError: restarted.get(record.job.id)?.job.error ?? null,
      },
      expected: {
        beforeSave: [],
        savedBefore: 'running',
        events: [[state, result, error]],
        saved: [state, result, error, 'string'],
        restarted: state === 'done' ? null : state,
        restartError: error,
      },
    })
  })
}
