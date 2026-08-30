/**
 * Voice over the web — the service's side of a browser voice session.
 *
 * The browser talks to the Realtime API directly over WebRTC; audio never
 * comes here. What does: the client secret the browser connects with,
 * minted around the session configuration ai:voice uses (persona, opening
 * line, tools), and every tool call the model makes — the browser relays
 * the call, the service runs it, the browser hands the output back over
 * the data channel. A thread is one browser session; it lives in memory
 * until the page ends it.
 */

import { Hono } from 'hono'
import type { RealtimeFunctionTool, RealtimeSessionCreateRequest } from 'openai/resources/realtime/realtime'
import { logger } from '#shared/log.ts'
import truncate from '#shared/strings/truncate.ts'

const log = logger('voice')

export interface VoiceTool {
  definition: RealtimeFunctionTool
  /** Runs one call; the returned string goes back to the model verbatim. */
  run: (input: Record<string, unknown>) => Promise<string>
}

/** One browser session's configuration and tools — the host's wiring. */
export interface VoiceThread {
  session: RealtimeSessionCreateRequest
  /** Instructions for the greeting response — see openingInstructions. */
  opening: string
  tools: Map<string, VoiceTool>
}

export type VoiceThreadFactory = (id: string) => Promise<VoiceThread>

export interface ClientSecret {
  value: string
  /** Unix seconds after which the secret can no longer start a session. */
  expiresAt: number
}

/** Mints the short-lived secret a browser connects with, for one session configuration. */
export type ClientSecretMinter = (session: RealtimeSessionCreateRequest) => Promise<ClientSecret>

/** What the audition page shows before any voice speaks. */
export interface AuditionInfo {
  /** The default passage, its name slot already filled */
  passage: string
  groups: Readonly<Record<'male' | 'female', readonly string[]>>
  /** The voice sessions use unless told otherwise */
  current: string
  model: string
}

/** The audition — every voice saying one passage — as the host wires it. */
export interface AuditionHost {
  describe: () => Promise<AuditionInfo>
  /** The speaking-only session for one voice and the response instructions for a passage; null for a voice that does not exist */
  prepare: (
    voice: string,
    passage: string,
  ) => Promise<{ session: RealtimeSessionCreateRequest; opening: string } | null>
}

export interface VoiceRoutesOptions {
  createThread: VoiceThreadFactory
  mint: ClientSecretMinter
  /** Absent, /voice/_api/audition is not served */
  audition?: AuditionHost
}

/** Mirrors ai:chat's tool-boundary clamp: an error must never carry megabytes. */
const MAX_TOOL_OUTPUT_ERROR_CHARS = 2000

export function createVoiceRoutes(options: VoiceRoutesOptions): Hono {
  const threads = new Map<string, VoiceThread>()
  const opening = new Map<string, Promise<VoiceThread>>()
  const app = new Hono()

  // A thread exists from its first session request. Two racing for the
  // same id share one thread rather than each building their own.
  const open = (id: string): Promise<VoiceThread> => {
    const existing = threads.get(id)
    if (existing) return Promise.resolve(existing)
    let pending = opening.get(id)
    if (!pending) {
      pending = options
        .createThread(id)
        .then((thread) => {
          threads.set(id, thread)
          return thread
        })
        .finally(() => opening.delete(id))
      opening.set(id, pending)
    }
    return pending
  }

  // The audition: the passage and the voices by group, and a speaking-only
  // session per voice. Under _api so no thread id can shadow it.
  app.get('/_api/audition', async (c) => {
    if (!options.audition) return c.json({ message: 'no audition host' }, 404)
    return c.json(await options.audition.describe())
  })

  app.post('/_api/audition/session', async (c) => {
    if (!options.audition) return c.json({ message: 'no audition host' }, 404)
    const body = (await c.req.json().catch(() => null)) as { voice?: unknown; passage?: unknown } | null
    if (typeof body?.voice !== 'string') return c.json({ message: 'expected { voice, passage? }' }, 400)
    const passage = typeof body.passage === 'string' && body.passage.trim() ? body.passage.trim() : null
    const prepared = await options.audition.prepare(body.voice, passage ?? (await options.audition.describe()).passage)
    if (!prepared) return c.json({ message: `no such voice: ${body.voice}` }, 400)
    let secret: ClientSecret
    try {
      secret = await options.mint(prepared.session)
    } catch (err) {
      return c.json({ message: (err as Error).message }, 502)
    }
    return c.json({
      clientSecret: secret.value,
      expiresAt: secret.expiresAt,
      voice: body.voice,
      opening: prepared.opening,
    })
  })

  // The secret a browser connects with. Minted per press of Talk, so a
  // reconnect on the same thread mints again; the session it configures
  // lives on past the secret's expiry.
  app.post('/:id/session', async (c) => {
    const thread = await open(c.req.param('id'))
    let secret: ClientSecret
    try {
      secret = await options.mint(thread.session)
    } catch (err) {
      return c.json({ message: (err as Error).message }, 502)
    }
    return c.json({
      clientSecret: secret.value,
      expiresAt: secret.expiresAt,
      model: thread.session.model ?? null,
      voice: thread.session.audio?.output?.voice ?? null,
      opening: thread.opening,
      tools: [...thread.tools.keys()],
    })
  })

  // One tool call as the model made it: the arguments arrive as the JSON
  // string the model wrote, and the output leaves as the string it reads.
  // The thread is built on demand here too: the call lives in the browser,
  // so a service restart mid-conversation loses the thread and nothing
  // else — the next tool call simply rebuilds it.
  app.post('/:id/tools', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { name?: unknown; arguments?: unknown } | null
    if (typeof body?.name !== 'string') return c.json({ message: 'expected { name, arguments }' }, 400)
    const thread = await open(c.req.param('id'))

    const tool = thread.tools.get(body.name)
    if (!tool) return c.json({ output: `Unknown tool: ${body.name}` })

    let input: Record<string, unknown> = {}
    if (typeof body.arguments === 'string') {
      try {
        input = JSON.parse(body.arguments) as Record<string, unknown>
      } catch {
        // Malformed arguments — run the tool with none and let it complain.
      }
    }

    const t0 = performance.now()
    let output: string
    try {
      output = await tool.run(input)
    } catch (err) {
      // Failures cross this boundary as strings only, clamped — the same
      // rule ai:chat's tool runner enforces.
      output = truncate(`Tool failed: ${(err as Error).message}`, MAX_TOOL_OUTPUT_ERROR_CHARS)
    }
    log.info('tool {tool} · {ms}ms · {chars} chars', {
      tool: body.name,
      ms: Math.round(performance.now() - t0),
      chars: output.length,
    })
    return c.json({ output })
  })

  // The page is done with the thread; nothing is filed yet.
  app.post('/:id/end', (c) => {
    if (!threads.delete(c.req.param('id'))) return c.json({ message: 'no such voice thread' }, 404)
    return c.json({ ended: true })
  })

  return app
}
