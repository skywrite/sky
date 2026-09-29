import { createHash } from 'node:crypto'
import { access, chmod, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { z } from 'zod'
import { withProcessLock } from '#lib/jobs/files.ts'
import { getCommandPath, runCommand } from '#lib/sys/mod.ts'
import { CredentialError, credentialCall } from './errors.ts'

export interface OnePasswordAccount {
  id: string
  label: string
}

const VERSION = '2.39.0'
// Vendor archives are pinned and the extracted executable must also carry 1Password's Apple signature.
const MAC_RELEASES = {
  arm64: { arch: 'arm64', sha256: '05391d3388a0c0b4f602691bedc1ab368541c487b6f14d2e3399743b4682af67' },
  x64: { arch: 'amd64', sha256: '753fbf56b00996426edbb8439d2f3c0be9227b9557cdff468fb144cd3621aa6e' },
} as const
const SIGNATURE =
  '=anchor apple generic and identifier "com.1password.op" and certificate leaf[subject.OU] = "2BUA8C4S2C"'
const MAX_DOWNLOAD = 40 * 1024 * 1024
type Runner = typeof runCommand

export interface DesktopDiscoveryOptions {
  helperDir: string
  run?: Runner
  findCli?: () => Promise<string | null>
  platform?: string
  arch?: string
  download?: (url: string) => Promise<Uint8Array>
}

async function present(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  )
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'error' })
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_DOWNLOAD)
    throw new CredentialError('helper-unavailable')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_DOWNLOAD) throw new CredentialError('helper-unavailable')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  return Buffer.concat(chunks)
}

/** Installs privately on an explicit Connect only; never changes PATH or runs a system installer. */
export async function ensureOnePasswordCli(options: DesktopDiscoveryOptions): Promise<string> {
  const run = options.run ?? runCommand
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const verify = async (file: string) =>
    platform !== 'darwin' ||
    (await run('/usr/bin/codesign', ['--verify', '--strict', '-R', SIGNATURE, file], { timeout: 10000 })).success
  const found = await (options.findCli ?? (() => getCommandPath('op')))()
  if (found && (await verify(found))) return found
  if (platform !== 'darwin' || (arch !== 'arm64' && arch !== 'x64')) throw new CredentialError('helper-unavailable')
  const release = MAC_RELEASES[arch]
  const directory = path.join(options.helperDir, `${VERSION}-${release.arch}`)
  const executable = path.join(directory, 'op')
  try {
    if ((await present(executable)) && (await verify(executable))) return executable
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = await mkdtemp(path.join(directory, '.download-'))
    try {
      const bytes = await (options.download ?? download)(
        `https://cache.agilebits.com/dist/1P/op2/pkg/v${VERSION}/op_darwin_${release.arch}_v${VERSION}.zip`,
      )
      if (bytes.byteLength > MAX_DOWNLOAD || createHash('sha256').update(bytes).digest('hex') !== release.sha256)
        throw new CredentialError('helper-unavailable')
      const archive = path.join(temporary, 'op.zip')
      await writeFile(archive, bytes, { mode: 0o600 })
      const extracted = path.join(temporary, 'extracted')
      if (!(await run('/usr/bin/ditto', ['-xk', archive, extracted], { timeout: 30000 })).success)
        throw new CredentialError('helper-unavailable')
      const candidate = path.join(extracted, 'op')
      await chmod(candidate, 0o700)
      if (!(await verify(candidate))) throw new CredentialError('helper-unavailable')
      // Download outside the short lock; another process may finish preparing the same version first.
      return await withProcessLock(`${directory}.lock`, async () => {
        if ((await present(executable)) && (await verify(executable))) return executable
        await rename(candidate, executable)
        return executable
      })
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  } catch {
    throw new CredentialError('helper-unavailable')
  }
}

const accountsSchema = z
  .array(
    z.object({
      account_uuid: z.string().regex(/^[a-z0-9]{26}$/i),
      email: z.string().min(1).max(320),
      url: z.string().min(1).max(512),
    }),
  )
  .max(20)

/** Projects only account identity; CLI output and native errors never enter logs or API responses. */
export function parseOnePasswordAccounts(raw: string): OnePasswordAccount[] {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new CredentialError('unavailable')
  }
  const parsed = accountsSchema.safeParse(value)
  if (!parsed.success) throw new CredentialError('unavailable')
  const accounts = new Map<string, OnePasswordAccount>()
  for (const account of parsed.data) {
    const id = account.account_uuid
    accounts.set(id, { id, label: `${account.email} · ${account.url}`.slice(0, 512) })
  }
  return [...accounts.values()]
}

/** Account discovery uses the official helper; secret operations stay on the passkey-preserving SDK. */
export async function discoverOnePasswordAccounts(options: DesktopDiscoveryOptions): Promise<OnePasswordAccount[]> {
  return credentialCall(async () => {
    const run = options.run ?? runCommand
    if ((options.platform ?? process.platform) === 'darwin') {
      if (
        !(await present('/Applications/1Password.app')) &&
        !(await present(path.join(homedir(), 'Applications/1Password.app')))
      )
        throw new CredentialError('app-required')
      await run('/usr/bin/open', ['-a', '1Password'], { timeout: 10000 })
    }
    const executable = await ensureOnePasswordCli(options)
    // Empty values still enable Connect/service-account auth in op. Remove those variables entirely.
    const result = await run(
      '/usr/bin/env',
      [
        '-u',
        'OP_SERVICE_ACCOUNT_TOKEN',
        '-u',
        'OP_CONNECT_HOST',
        '-u',
        'OP_CONNECT_TOKEN',
        '-u',
        'OP_ACCOUNT',
        executable,
        'account',
        'list',
        '--format=json',
      ],
      {
        timeout: 20000,
        maxBuffer: 1024 * 1024,
        env: {
          OP_BIOMETRIC_UNLOCK_ENABLED: 'true',
        },
      },
    )
    if (!result.success) {
      if (/desktop app|integration|no accounts configured/i.test(result.stderr))
        throw new CredentialError('integration-required')
      throw new CredentialError('unavailable')
    }
    const accounts = parseOnePasswordAccounts(result.stdout)
    if (!accounts.length) throw new CredentialError('no-accounts')
    return accounts
  })
}
