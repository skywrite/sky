import * as path from 'node:path'
import process from 'node:process'
import * as readline from 'node:readline'
import { z } from 'zod'
import { DIR_STATE } from '#config'
import { connectOnePassword } from '#lib/credentials/connect.ts'
import { PasswordManagerSettingsStore } from '#lib/credentials/passwordManagers.ts'
import { linkedInUrl } from '#lib/linkedin/types.ts'
import { connectExistingBrowser } from '../existing/connection.ts'
import { ExistingBrowserError, ExistingBrowserSettingsStore } from '../existing/settings.ts'
import { SignInBroker } from './broker.ts'
import { CredentialRun } from './credentialRun.ts'
import { nativeAuthenticationApproval, nativeRunApproval, nativeSignInApproval } from './nativeApproval.ts'
import { nativeBrowserAvailable, NATIVE_BROWSER } from './nativeBrowser.ts'
import { BrowserProfileError, SKY_PRIVATE_BROWSER_PROFILE } from './profile.ts'
import { RecoveringBrowserSession } from './recovery.ts'
import { PrivateBrowserSession } from './session.ts'

// Only the owning process’s inherited pipes carry task tools. Browser connections and grants stay inside this worker.
process.umask(0o077)
const startSchema = z
  .object({
    objective: z.string().min(1).max(20000),
    runObjective: z.string().min(1).max(20000).optional(),
    filesDir: z.string().min(1),
    uploads: z
      .object({
        origin: z.url(),
        files: z
          .array(z.object({ path: z.string().min(1), name: z.string().min(1) }).strict())
          .min(1)
          .max(50),
      })
      .strict()
      .optional(),
    headless: z.boolean().optional(),
    linkedInProfile: z
      .string()
      .max(8000)
      .transform((url) => linkedInUrl(url))
      .optional(),
  })
  .strict()
const controllers = new Map<number, AbortController>()
let session: RecoveringBrowserSession | undefined
let starting = false
let queue = Promise.resolve()
let ended = false
const lifetime = new AbortController()
const settings = new PasswordManagerSettingsStore(path.join(DIR_STATE, 'credentials', 'sources.json'))
let credentials: CredentialRun | undefined

async function close() {
  if (ended) return
  ended = true
  lifetime.abort()
  credentials?.close()
  for (const controller of controllers.values()) controller.abort()
  await session?.close()
}

async function request(method: string, params: unknown, signal: AbortSignal) {
  if (ended) throw new Error('Stopped')
  if (method === 'initialize')
    return {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'Sky private browser', version: '1' },
    }
  if (method === 'tools/list') return { tools: session ? await session.listTools() : [] }
  if (method !== 'tools/call') throw new Error('Unavailable')
  const call = z
    .object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) })
    .strict()
    .parse(params)
  // Host-only lifecycle operations are never listed among model tools.
  if (call.name === 'sky_finish' && Object.keys(call.arguments).length === 0) {
    await session?.close()
    session = undefined
    starting = false
    return { content: [], isError: false }
  }
  if (call.name === 'sky_start' && !session && !starting) {
    starting = true
    const options = startSchema.parse(call.arguments)
    const brokerOptions = {
      sources: async () => (await settings.read()).sources,
      connect: connectOnePassword,
    }
    if (!options.linkedInProfile)
      credentials ??= new CredentialRun({
        ...brokerOptions,
        approval: nativeRunApproval(options.runObjective ?? options.objective, lifetime.signal),
        signal: lifetime.signal,
      })
    const create = async () => {
      lifetime.signal.throwIfAborted()
      const broker = options.linkedInProfile
        ? new SignInBroker({
            ...brokerOptions,
            approval: nativeSignInApproval(`Import LinkedIn profile: ${options.linkedInProfile}`, lifetime.signal),
          })
        : credentials!.broker()
      const saved = await settings.read()
      const existingStore = new ExistingBrowserSettingsStore()
      const existing = process.env.SKY_USE_EXISTING_BROWSER === '1' ? await existingStore.read() : undefined
      if (process.env.SKY_USE_EXISTING_BROWSER === '1' && !existing)
        throw new ExistingBrowserError(
          'The Brave connection was removed. Choose a browser in Settings → Browser automation before retrying.',
        )
      if (saved.nativeBrowser && !existing && !(await nativeBrowserAvailable()))
        throw new Error('Native browser unavailable')
      const attached = existing
        ? await connectExistingBrowser(await existingStore.token(), existing, { signal: lifetime.signal })
        : undefined
      return PrivateBrowserSession.launch({
        ...options,
        profileDir: process.env.SKY_PRIVATE_BROWSER_PROFILE ?? SKY_PRIVATE_BROWSER_PROFILE,
        signal: lifetime.signal,
        attached,
        broker,
        hasSavedLogins: saved.sources.length > 0,
        ...(saved.nativeBrowser
          ? {
              executablePath: NATIVE_BROWSER.executablePath,
              ...(saved.nativeBrowser.applePasswords
                ? { appleExtensionArchive: path.join(DIR_STATE, 'credentials', 'helpers', 'apple-passwords.crx') }
                : {}),
            }
          : {}),
        ...(process.platform === 'darwin' && !options.headless && !attached
          ? {
              nativeApproval: nativeAuthenticationApproval(options.objective, lifetime.signal),
              offerNativeChoice: !!options.linkedInProfile,
            }
          : {}),
      })
    }
    session = new RecoveringBrowserSession(await create(), create)
    if (ended || signal.aborted) {
      await session.close()
      throw new Error('Stopped')
    }
    return { content: [{ type: 'text', text: 'Private browser ready.' }], isError: false }
  }
  if (!session) throw new Error('Unavailable')
  return session.callTool(call.name, call.arguments, { signal })
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', (line) => {
  let message: { id?: number; method: string; params?: unknown }
  try {
    if (line.length > 100000) return
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.method === 'notifications/cancelled') {
    const cancelled = message.params as { requestId?: number } | undefined
    if (typeof cancelled?.requestId === 'number') controllers.get(cancelled.requestId)?.abort()
    // Revocation closes the context even if a provider or native dialog is still waiting.
    void close()
    return
  }
  if (typeof message.id !== 'number') return
  const id = message.id
  const controller = new AbortController()
  controllers.set(id, controller)
  queue = queue.then(async () => {
    try {
      const result = await request(message.method, message.params, controller.signal)
      if (!ended) process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
    } catch (error) {
      if (!ended)
        process.stdout.write(
          `${JSON.stringify({ jsonrpc: '2.0', id, error: { code: error instanceof BrowserProfileError || error instanceof ExistingBrowserError ? -32010 : -32000, message: error instanceof BrowserProfileError || error instanceof ExistingBrowserError ? error.message : 'The private browser operation could not complete.' } })}\n`,
        )
    } finally {
      controllers.delete(id)
    }
  })
})
input.on('close', () => {
  void close().finally(() => process.exit(0))
})
for (const event of ['SIGTERM', 'SIGINT'] as const)
  process.on(event, () => {
    void close().finally(() => process.exit(0))
  })
// Never emit native exceptions, Playwright parameters, or provider failures on a model-visible stream.
process.on('uncaughtException', () => {
  void close().finally(() => process.exit(1))
})
process.on('unhandledRejection', () => {
  void close().finally(() => process.exit(1))
})
