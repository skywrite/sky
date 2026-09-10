import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { calendarInstant, instantNow } from '#universal/dates/nbdt/mod.ts'
import {
  KEYCHAIN_INTERACTIVE_TIMEOUT_MS,
  KEYCHAIN_TIMEOUT_MS,
  type KeychainReply,
  type KeychainEntryRequest,
} from './keychainProtocol.ts'

interface AttemptState {
  failures: number
  retryAt: number
  access?: boolean
  status?: number
}

export function keychainBackoff(failures: number, random = Math.random()): number {
  return Math.min(300_000, 30_000 * 2 ** Math.min(4, Math.max(0, failures - 1))) * (0.8 + 0.2 * random)
}

async function save(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
  await rename(temporary, file)
}

/** Called under the machine lock; the failure reservation survives a hung/killed helper. */
export async function gatedKeychainAttempt(
  request: KeychainEntryRequest,
  access: () => KeychainReply | Promise<KeychainReply>,
  now: () => number = () => calendarInstant(instantNow()),
): Promise<KeychainReply> {
  const key = createHash('sha256')
    .update(JSON.stringify([request.service, request.account]))
    .digest('hex')
  const file = path.join(request.stateDir, `${key}.json`)
  let previous: AttemptState | undefined
  try {
    previous = JSON.parse(await readFile(file, 'utf8')) as AttemptState
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  const current = now()
  if (!request.interactive && previous?.access) return { ok: false, kind: 'access', status: previous.status }
  if (!request.interactive && previous && previous.retryAt > current) {
    return { ok: false, kind: 'timeout', retryAfterMs: previous.retryAt - current }
  }
  const failures = (previous?.failures ?? 0) + 1
  const delay = keychainBackoff(failures)
  const timeout = request.interactive ? KEYCHAIN_INTERACTIVE_TIMEOUT_MS : KEYCHAIN_TIMEOUT_MS
  await save(file, { failures, retryAt: current + timeout + delay, access: request.interactive === true })
  const reply = await access()
  if (reply.ok) {
    await save(file, { failures: 0, retryAt: 0 })
    if (request.operation !== 'get' || request.interactive) {
      await save(path.join(request.stateDir, 'revision.json'), randomUUID())
    }
  } else {
    await save(file, { failures, retryAt: now() + delay, access: reply.kind === 'access', status: reply.status })
    reply.retryAfterMs = delay
  }
  return reply
}

export async function prepareKeychainState(stateDir: string): Promise<void> {
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
}
