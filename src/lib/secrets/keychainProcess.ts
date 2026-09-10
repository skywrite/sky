import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  KEYCHAIN_INTERACTIVE_TIMEOUT_MS,
  KEYCHAIN_TIMEOUT_MS,
  KeychainAccessError,
  type KeychainReply,
  type KeychainRequest,
} from './keychainProtocol.ts'

/** Credentials travel through pipes, never command arguments, files, or error messages. */
export function runKeychainProcess(
  request: KeychainRequest,
  options: { worker?: string; timeoutMs?: number } = {},
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    // The VS Code extension runs in Node/Electron; the helper always needs Bun.
    const installed = path.join(homedir(), '.bun', 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun')
    const executable = process.versions.bun ? process.execPath : existsSync(installed) ? installed : 'bun'
    const child = spawn(
      executable,
      [options.worker ?? fileURLToPath(new URL('./keychainWorker.ts', import.meta.url))],
      {
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    )
    let output = ''
    let failure: KeychainAccessError | undefined
    const timeout = setTimeout(
      () => {
        failure = new KeychainAccessError('timeout', undefined, 30_000)
        child.kill('SIGKILL')
      },
      options.timeoutMs ?? (request.interactive ? KEYCHAIN_INTERACTIVE_TIMEOUT_MS : KEYCHAIN_TIMEOUT_MS),
    )
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (output.length + chunk.length > 1_048_576) {
        failure = new KeychainAccessError('unavailable')
        child.kill('SIGKILL')
      } else output += chunk
    })
    child.stdin.on('error', () => {})
    child.on('error', () => {
      clearTimeout(timeout)
      reject(new KeychainAccessError('unavailable', undefined, 30_000))
    })
    // Wait for close after killing: another attempt must not overlap the native call.
    child.on('close', (code, signal) => {
      clearTimeout(timeout)
      if (failure) return reject(failure)
      if (signal === 'SIGALRM') return reject(new KeychainAccessError('timeout', undefined, 30_000))
      if (code !== 0) return reject(new KeychainAccessError('unavailable', undefined, 30_000))
      try {
        const reply = JSON.parse(output) as KeychainReply
        if (reply.ok === false && ['access', 'timeout', 'busy', 'unavailable'].includes(reply.kind))
          reject(new KeychainAccessError(reply.kind, reply.status, reply.retryAfterMs))
        else if (reply.ok === true && (reply.value === null || typeof reply.value === 'string')) resolve(reply.value)
        else reject(new KeychainAccessError('unavailable'))
      } catch {
        reject(new KeychainAccessError('unavailable', undefined, 30_000))
      }
    })
    child.stdin.end(JSON.stringify(request))
  })
}
