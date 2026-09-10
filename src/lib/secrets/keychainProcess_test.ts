import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { assert, test } from '#test'
import { runKeychainProcess } from './keychainProcess.ts'
import { KeychainAccessError, type KeychainRequest } from './keychainProtocol.ts'

test('a blocked Keychain helper cannot freeze its caller and exits before rejection', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-keychain-process-'))
  try {
    const worker = path.join(dir, 'blocked.ts')
    const pidFile = path.join(dir, 'pid')
    await writeFile(
      worker,
      `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000)`,
    )
    let responsive = false
    const heartbeat = setTimeout(() => {
      responsive = true
    }, 10)
    const request: KeychainRequest = { operation: 'get', service: 'sky-test', account: 'main', stateDir: dir }
    const error = await runKeychainProcess(request, { worker, timeoutMs: 250 }).catch((err: unknown) => err)
    clearTimeout(heartbeat)
    let alive = true
    try {
      process.kill(Number(await readFile(pidFile, 'utf8')), 0)
    } catch {
      alive = false
    }
    assert({
      given: 'a helper blocks its JS thread',
      should: 'keep the parent responsive and reap the helper on timeout',
      actual: [responsive, error instanceof KeychainAccessError && error.kind, alive],
      expected: [true, 'timeout', false],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Keychain process passes values through stdin and suppresses unexpected worker output', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-keychain-pipes-'))
  try {
    const worker = path.join(dir, 'echo.ts')
    await writeFile(
      worker,
      `let input=''; for await (const c of process.stdin) input += c; const r=JSON.parse(input); console.log(JSON.stringify({ok:true,value:process.argv.includes(r.value)?'leaked':r.value}));`,
    )
    const value = await runKeychainProcess(
      { operation: 'set', service: 'sky-test', account: 'main', value: 'synthetic-secret', stateDir: dir },
      { worker },
    )
    assert({
      given: 'a value sent to a worker',
      should: 'transmit it without a command argument',
      actual: value,
      expected: 'synthetic-secret',
    })
    await writeFile(worker, `console.log('sensitive unexpected output')`)
    const error = await runKeychainProcess(
      { operation: 'get', service: 'sky-test', account: 'main', stateDir: dir },
      { worker },
    ).catch((err: unknown) => err)
    assert({
      given: 'a malformed worker reply',
      should: 'hide its contents from the error',
      actual: error instanceof Error && !error.message.includes('sensitive'),
      expected: true,
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test(
  'the macOS helper kernel deadline works while JavaScript is blocked',
  { ignore: process.platform !== 'darwin' },
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-keychain-alarm-'))
    try {
      const worker = path.join(dir, 'alarm.ts')
      const module = new URL('./keychainDarwin.ts', import.meta.url).href
      await writeFile(
        worker,
        `import {armKeychainDeadline} from ${JSON.stringify(module)}; armKeychainDeadline(1000); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000)`,
      )
      const started = performance.now()
      const error = await runKeychainProcess(
        { operation: 'get', service: 'sky-test', account: 'main', stateDir: dir },
        { worker, timeoutMs: 4000 },
      ).catch((err: unknown) => err)
      assert({
        given: 'the helper cannot run JS timers',
        should: 'terminate by itself before the parent deadline',
        actual: [error instanceof KeychainAccessError, performance.now() - started < 3000],
        expected: [true, true],
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)

test(
  'macOS helper locks serialize different processes and release on death',
  { ignore: process.platform !== 'darwin' },
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-keychain-lock-'))
    try {
      const worker = path.join(dir, 'lock.ts')
      const marker = path.join(dir, 'acquired')
      const module = new URL('./keychainDarwin.ts', import.meta.url).href
      await writeFile(
        worker,
        `import {lockKeychain} from ${JSON.stringify(module)}; import {writeFileSync} from 'node:fs'; const release=await lockKeychain(${JSON.stringify(dir)}); writeFileSync(${JSON.stringify(marker)}, 'yes'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);`,
      )
      const request: KeychainRequest = { operation: 'get', service: 'sky-test', account: 'main', stateDir: dir }
      const first = runKeychainProcess(request, { worker, timeoutMs: 1500 }).catch(() => null)
      for (let attempt = 0; attempt < 50; attempt++) {
        if ((await readFile(marker, 'utf8').catch(() => '')) === 'yes') break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      const following = path.join(dir, 'following.ts')
      await writeFile(
        following,
        `import {lockKeychain} from ${JSON.stringify(module)}; const release=await lockKeychain(${JSON.stringify(dir)}); release(); console.log(JSON.stringify({ok:true,value:'acquired'}));`,
      )
      let resolved = false
      const second = runKeychainProcess(request, { worker: following, timeoutMs: 4000 }).then((value) => {
        resolved = true
        return value
      })
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert({
        given: 'another helper holds the lock',
        should: 'wait without entering Keychain',
        actual: resolved,
        expected: false,
      })
      await first
      assert({
        given: 'the holder is killed',
        should: 'release the OS lock to the waiting helper',
        actual: await second,
        expected: 'acquired',
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)
