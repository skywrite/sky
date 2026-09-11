import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { assert, test } from '#test'
import { runWorker } from './worker.ts'

async function withWorker(run: (file: URL) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sky-worker-test-'))
  const file = path.join(dir, 'task.mjs')
  try {
    await writeFile(
      file,
      `import { parentPort, workerData } from 'node:worker_threads'
if (workerData.mode === 'error') throw new Error('Sample parsing failure')
if (workerData.mode === 'empty') {
  parentPort.close()
} else {
  if (workerData.mode === 'busy') {
    const progress = new Int32Array(workerData.progress)
    Atomics.store(progress, 0, 1)
    const started = performance.now()
    while (performance.now() - started < 5000) {}
    Atomics.store(progress, 0, 2)
  }
  parentPort.postMessage(workerData.payload)
}
`,
    )
    await run(pathToFileURL(file))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('runWorker returns structured results and reports failures', async () => {
  await withWorker(async (file) => {
    const payload = { conversation: [{ role: 'user', content: 'Sample request\n  with spacing' }] }
    const result = await runWorker(file, { data: { payload }, timeoutMs: 2000 })
    const error = await runWorker(file, { data: { mode: 'error' }, timeoutMs: 2000 }).catch((err) => err.message)
    const empty = await runWorker(file, { data: { mode: 'empty' }, timeoutMs: 2000 }).catch((err) => err.message)
    assert({
      given: 'a worker that returns data, throws, or exits without answering',
      should: 'deliver the data or reject instead of leaving a pending read',
      actual: { result, error, empty },
      expected: {
        result: payload,
        error: 'Sample parsing failure',
        empty: 'Worker exited without a result (code 0)',
      },
    })
  })
})

test('runWorker keeps the caller responsive and terminates a CPU-bound task', async () => {
  await withWorker(async (file) => {
    const progress = new Int32Array(new SharedArrayBuffer(4))
    let settled = false
    const pending = runWorker(file, {
      data: { mode: 'busy', progress: progress.buffer },
      timeoutMs: 1000,
    })
      .catch((error) => error.message)
      .finally(() => {
        settled = true
      })

    while (Atomics.load(progress, 0) === 0 && !settled) await delay(5)
    const started = performance.now()
    await delay(20)
    const responsive = performance.now() - started < 500 && !settled
    const error = await pending
    assert({
      given: 'a worker spending five seconds in synchronous computation',
      should: 'let the caller run timers and stop the worker at its own deadline',
      actual: { responsive, error, progress: Atomics.load(progress, 0) },
      expected: { responsive: true, error: 'Worker timed out after 1000 ms', progress: 1 },
    })
    assert({
      given: 'another read after the timed-out worker',
      should: 'still complete',
      actual: await runWorker(file, { data: { payload: 'ready' }, timeoutMs: 2000 }),
      expected: 'ready',
    })
  })
})
