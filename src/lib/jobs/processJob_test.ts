import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { assert, test } from '#test'
import { createProcessJob, type JobRecord } from './mod.ts'

interface Input {
  dir: string
  value: string
}

const api = new URL('./mod.ts', import.meta.url).href
const files = new URL('./files.ts', import.meta.url).href
const worker = new URL('./worker.ts', import.meta.url).pathname

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-process-job-test-'))
  const dir = path.join(root, 'state')
  const module = path.join(root, 'task.ts')
  await writeFile(
    module,
    `import { access, appendFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
export default async ({ dir, value }) => {
  await appendFile(dir + '/executions', 'started\\n')
  await writeFile(dir + '/started', String(process.pid))
  while (!(await access(dir + '/release').then(() => true, () => false))) await delay(20)
  return value
}
`,
  )
  const options = { dir, module }
  const client = createProcessJob<Input, string>(options)
  const children: ChildProcess[] = []
  const script = async (name: string, code: string): Promise<ChildProcess> => {
    const file = path.join(root, `${name}.ts`)
    await writeFile(file, `import { createProcessJob } from ${JSON.stringify(api)}\n${code}`)
    const child = spawn(process.execPath, [file], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    return child
  }
  return {
    root,
    dir,
    module,
    options,
    client,
    script,
    input: { dir: root, value: 'completed' },
    release: () => writeFile(path.join(root, 'release'), ''),
    dispose: async () => {
      await writeFile(path.join(root, 'release'), '')
      for (const child of children) child.kill('SIGKILL')
      const active = await client.status()
      if (active?.status === 'running') {
        process.kill(active.owner, 'SIGKILL')
        await delay(100)
      }
      await rm(root, { recursive: true, force: true })
    },
  }
}

async function untilFile(file: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await access(file).then(
        () => true,
        () => false,
      )
    )
      return
    await delay(25)
  }
  throw new Error('Timed out waiting for worker progress.')
}

async function output(child: ChildProcess): Promise<string> {
  let stdout = ''
  let stderr = ''
  child.stdout!.on('data', (chunk) => (stdout += chunk))
  child.stderr!.on('data', (chunk) => (stderr += chunk))
  const [code] = await once(child, 'close')
  if (code !== 0) throw new Error(`Fixture exited with ${code}: ${stderr}`)
  return stdout
}

test('detached jobs survive the launching process group and reconnect from a new client process', async () => {
  const f = await fixture()
  try {
    const launched = path.join(f.root, 'launched.json')
    const parent = await f.script(
      'parent',
      `import { writeFile } from 'node:fs/promises'
const job = createProcessJob(${JSON.stringify(f.options)})
await writeFile(${JSON.stringify(launched)}, JSON.stringify(await job.start(${JSON.stringify(f.input)})))
setInterval(() => {}, 1000)
`,
    )
    await untilFile(launched)
    await untilFile(path.join(f.root, 'started'))
    const record = JSON.parse(await readFile(launched, 'utf8')) as JobRecord<string>
    const exited = once(parent, 'close')
    process.kill(-parent.pid!, 'SIGKILL')
    await exited
    const reconnect = await f.script(
      'reconnect',
      `import { writeFile } from 'node:fs/promises'
const job = createProcessJob(${JSON.stringify(f.options)})
const active = await job.status()
await writeFile(${JSON.stringify(path.join(f.root, 'reconnected'))}, '')
console.log(JSON.stringify({ id: active.id, status: active.status, result: await job.wait(active.id) }))
`,
    )
    const result = output(reconnect)
    await untilFile(path.join(f.root, 'reconnected'))
    await f.release()
    assert({
      given: 'the entire launcher process group was killed',
      should: 'keep the worker running and expose its completion to another process',
      actual: JSON.parse(await result),
      expected: { id: record.id, status: 'running', result: 'completed' },
    })
  } finally {
    await f.dispose()
  }
})

test('death during startup handoff fences obsolete children and recovers abandoned locks', async () => {
  const f = await fixture()
  try {
    const launched = path.join(f.root, 'handoff')
    const parent = await f.script(
      'handoff',
      `import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { withProcessLock, writeJson } from ${JSON.stringify(files)}
const dir = ${JSON.stringify(f.dir)}
await withProcessLock(dir + '/lock', async () => {
  const id = randomUUID()
  await writeJson(dir + '/runs/' + id + '.json', { id, owner: process.pid, status: 'running', input: ${JSON.stringify(f.input)} })
  await writeJson(dir + '/current.json', { id })
  const child = spawn(process.execPath, [${JSON.stringify(worker)}, dir, id, ${JSON.stringify(new URL(`file://${f.module}`).href)}], { detached: true, stdio: 'ignore' })
  child.unref()
  await writeFile(${JSON.stringify(launched)}, '')
  await new Promise(() => { setInterval(() => {}, 1000) })
})
`,
    )
    await untilFile(launched)
    const exited = once(parent, 'close')
    process.kill(-parent.pid!, 'SIGKILL')
    await exited
    const records = await Promise.all(
      Array.from({ length: 6 }, async (_, index) => {
        const child = await f.script(
          `recover-${index}`,
          `console.log(JSON.stringify(await createProcessJob(${JSON.stringify(f.options)}).start(${JSON.stringify(f.input)})))`,
        )
        return JSON.parse(await output(child)) as JobRecord<string>
      }),
    )
    await untilFile(path.join(f.root, 'started'))
    await f.release()
    await f.client.wait(records[0].id)
    assert({
      given: 'the launcher dies after spawning but before recording the child PID',
      should: 'recover the stale lock and let exactly one worker produce a result',
      actual: {
        ids: new Set(records.map((record) => record.id)).size,
        executions: await readFile(path.join(f.root, 'executions'), 'utf8'),
      },
      expected: { ids: 1, executions: 'started\n' },
    })
  } finally {
    await f.dispose()
  }
})

test('spawn failures settle and inherited environment is never copied into job files', async () => {
  const f = await fixture()
  try {
    const bad = createProcessJob<Input, string>({ ...f.options, cwd: path.join(f.root, 'missing-cwd') })
    const failed = await bad.start(f.input)
    assert({
      given: 'the worker cannot be spawned',
      should: 'return a durable failure',
      actual: (await bad.status())?.status,
      expected: 'failed',
    })
    assert({
      given: 'spawn failed before a worker existed',
      should: 'settle the start request',
      actual: Boolean(failed.error),
      expected: true,
    })

    await writeFile(f.module, 'export default async () => process.env.SKY_SYNTHETIC_JOB_TOKEN === "synthetic-token"')
    const job = createProcessJob<Input, boolean>({
      ...f.options,
      module: new URL(`file://${f.module}`).href,
      env: { SKY_SYNTHETIC_JOB_TOKEN: 'synthetic-token' },
    })
    const record = await job.start(f.input)
    assert({
      given: 'an environment override and a file URL string',
      should: 'reach the worker',
      actual: await job.wait(record.id),
      expected: true,
    })
    assert({
      given: 'environment is passed to a worker',
      should: 'persist only task input and output',
      actual: (await readFile(path.join(f.dir, 'runs', `${record.id}.json`), 'utf8')).includes('synthetic-token'),
      expected: false,
    })
  } finally {
    await f.dispose()
  }
})

test('concurrent processes start one producer and retain prior results after another run starts', async () => {
  const f = await fixture()
  try {
    const records = await Promise.all(
      Array.from({ length: 8 }, async (_, index) => {
        const child = await f.script(
          `start-${index}`,
          `console.log(JSON.stringify(await createProcessJob(${JSON.stringify(f.options)}).start(${JSON.stringify(f.input)})))`,
        )
        return JSON.parse(await output(child)) as JobRecord<string>
      }),
    )
    await untilFile(path.join(f.root, 'started'))
    assert({
      given: 'eight clients race to start a job',
      should: 'acknowledge the same durable job and execute once',
      actual: {
        ids: new Set(records.map((record) => record.id)).size,
        executions: await readFile(path.join(f.root, 'executions'), 'utf8'),
      },
      expected: { ids: 1, executions: 'started\n' },
    })
    await f.release()
    await f.client.wait(records[0].id)
    const next = await f.client.start({ ...f.input, value: 'second result' })
    assert({
      given: 'a completed job is followed by another job',
      should: 'retain the original result for reconnecting clients',
      actual: [await f.client.wait(records[0].id), await f.client.wait(next.id)],
      expected: ['completed', 'second result'],
    })
  } finally {
    await f.dispose()
  }
})

test('worker import and execution errors are persisted and permit a retry', async () => {
  const f = await fixture()
  try {
    for (const source of [null, 'export default async () => { throw new Error("Synthetic task failed") }']) {
      const module = source === null ? path.join(f.root, 'missing.ts') : path.join(f.root, 'throws.ts')
      if (source) await writeFile(module, source)
      const job = createProcessJob<Input, string>({ ...f.options, module })
      const record = await job.start(f.input)
      const message = await job.wait(record.id).then(
        () => '',
        (error: unknown) => String(error),
      )
      const state = await job.status()
      assert({
        given: source === null ? 'a worker module cannot be imported' : 'the worker task throws',
        should: 'persist a useful failure that reconnecting clients can read',
        actual: { status: state?.status, hasError: Boolean(state?.error), rejected: message.length > 0 },
        expected: { status: 'failed', hasError: true, rejected: true },
      })
    }
    await f.release()
    const retry = await f.client.start(f.input)
    assert({
      given: 'the previous job failed',
      should: 'allow a fresh worker',
      actual: await f.client.wait(retry.id),
      expected: 'completed',
    })
  } finally {
    await f.dispose()
  }
})

test('a killed worker becomes failed and a later start recovers', async () => {
  const f = await fixture()
  try {
    const record = await f.client.start(f.input)
    await untilFile(path.join(f.root, 'started'))
    process.kill(record.owner, 'SIGKILL')
    let state = await f.client.status()
    for (let attempt = 0; state?.status === 'running' && attempt < 100; attempt++) {
      await delay(25)
      state = await f.client.status()
    }
    assert({
      given: 'a worker dies',
      should: 'report an actionable terminal failure',
      actual: state?.status,
      expected: 'failed',
    })
    await f.release()
    const retry = await f.client.start(f.input)
    assert({
      given: 'the dead worker has been detected',
      should: 'run another worker',
      actual: await f.client.wait(retry.id),
      expected: 'completed',
    })
  } finally {
    await f.dispose()
  }
})
