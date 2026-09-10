import process from 'node:process'
import { gatedKeychainAttempt, prepareKeychainState } from './keychainGate.ts'
import {
  KEYCHAIN_INTERACTIVE_TIMEOUT_MS,
  KEYCHAIN_TIMEOUT_MS,
  type KeychainReply,
  type KeychainRequest,
} from './keychainProtocol.ts'

async function run(request: KeychainRequest): Promise<KeychainReply> {
  if (
    !['get', 'set', 'delete', 'restore'].includes(request.operation) ||
    !request.stateDir ||
    (request.operation === 'restore' ? request.interactive !== true : !request.service || !request.account)
  ) {
    return { ok: false, kind: 'unavailable' }
  }
  await prepareKeychainState(request.stateDir)
  if (process.platform === 'darwin') {
    const { accessDarwinKeychain, restoreDarwinKeychain, lockKeychain, armKeychainDeadline } =
      await import('./keychainDarwin.ts')
    armKeychainDeadline(request.interactive ? KEYCHAIN_INTERACTIVE_TIMEOUT_MS : KEYCHAIN_TIMEOUT_MS)
    const release = await lockKeychain(request.stateDir)
    try {
      if (request.operation === 'restore') return restoreDarwinKeychain()
      return await gatedKeychainAttempt(request, () => accessDarwinKeychain(request))
    } finally {
      release()
    }
  }
  if (request.operation === 'restore') return { ok: true, value: null }
  // A helper handles exactly one request, so backend initialization cannot race.
  const { getKeyring } = await import('cross-keychain')
  const backend = await getKeyring()
  return await gatedKeychainAttempt(request, async () => {
    if (request.operation === 'get')
      return { ok: true, value: await backend.getPassword(request.service, request.account) }
    if (request.operation === 'set') await backend.setPassword(request.service, request.account, request.value ?? '')
    else await backend.deletePassword(request.service, request.account)
    return { ok: true, value: null }
  })
}

if (import.meta.main) {
  let input = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) {
    input += chunk.toString()
    if (input.length > 1_048_576) process.exit(1)
  }
  let reply: KeychainReply
  try {
    reply = await run(JSON.parse(input) as KeychainRequest)
  } catch {
    reply = { ok: false, kind: 'unavailable', retryAfterMs: 30_000 }
  }
  process.stdout.write(JSON.stringify(reply))
}
