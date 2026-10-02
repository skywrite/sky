import * as path from 'node:path'
import process from 'node:process'
import * as readline from 'node:readline'
import { z } from 'zod'
import { DIR_STATE } from '#config'
import { connectOnePassword } from '#lib/credentials/connect.ts'
import { PasswordManagerSettingsStore } from '#lib/credentials/passwordManagers.ts'
import { linkedInUrl } from '#lib/linkedin/types.ts'
import { SignInBroker } from './broker.ts'
import { nativeAuthenticationApproval, nativeSignInApproval } from './nativeApproval.ts'
import { PrivateBrowserSession } from './session.ts'

// Only the owning process's inherited pipes carry this protocol. There is no listener or approval RPC.
process.umask(0o077)
const startSchema = z
  .object({
    objective: z.string().min(1).max(20000),
    filesDir: z.string().min(1),
    headless: z.boolean().optional(),
    linkedInProfile: z
      .string()
      .max(8000)
      .transform((url) => linkedInUrl(url))
      .optional(),
  })
  .strict()
const controllers = new Map<number, AbortController>()
let session: PrivateBrowserSession | undefined
let starting = false
let queue = Promise.resolve()
let ended = false
const lifetime = new AbortController()

async function close() {
  if (ended) return
  ended = true
  lifetime.abort()
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
  if (call.name === 'sky_start' && !session && !starting) {
    starting = true
    const options = startSchema.parse(call.arguments)
    const settings = new PasswordManagerSettingsStore(path.join(DIR_STATE, 'credentials', 'sources.json'))
    const broker = new SignInBroker({
      sources: async () => (await settings.read()).sources,
      connect: connectOnePassword,
      approval: nativeSignInApproval(
        options.linkedInProfile ? `Import LinkedIn profile: ${options.linkedInProfile}` : options.objective,
        lifetime.signal,
      ),
    })
    const saved = await settings.read()
    session = await PrivateBrowserSession.launch({
      ...options,
      broker,
      hasSavedLogins: saved.sources.length > 0,
      ...(process.platform === 'darwin' && !options.headless
        ? {
            nativeApproval: nativeAuthenticationApproval(options.objective, lifetime.signal),
            offerNativeChoice: true,
          }
        : {}),
    })
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
    } catch {
      if (!ended)
        process.stdout.write(
          `${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: 'The private browser operation could not complete.' } })}\n`,
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
