/**
 * Extensions over HTTP, for the web app's extension surfaces: the list of
 * installed extensions, switching one on or off, a reload, and a way for an
 * extension's screens to run the extension's own commands. A command
 * outside an installed extension's prefix is refused; everything else
 * about running it is the command's.
 */

import { Hono } from 'hono'

export interface ExtensionRow {
  /** `author/slug` */
  id: string
  author: string
  slug: string
  /** The display name */
  name: string
  version: string
  description: string
  categories: string[]
  authorName: string
  /** Where it is loaded from */
  from: string
  /** Switched on */
  enabled: boolean
  /** Why it could not be loaded, when it could not */
  problem?: string
  /** It has screens: a ui/ folder */
  ui: boolean
}

export interface ExtensionRunAnswer {
  status: 'success' | 'fail' | 'error'
  data?: unknown
  message?: string
  /** What the command printed, line by line */
  log: string[]
}

export interface ExtensionRoutesOptions {
  list(): Promise<ExtensionRow[]>
  /** Run a command; null when no installed extension owns its name */
  run(command: string, args: Record<string, unknown>): Promise<ExtensionRunAnswer | null>
  /** Switch an extension on or off; a refusal says why */
  enable(id: string, enabled: boolean): Promise<{ ok: true } | { ok: false; reason: string }>
  /** Read the extensions folder again: the command manifest and the web bundle rebuild */
  reload(): Promise<void>
}

const COMMAND = /^[a-z0-9][a-z0-9-]*(:[a-z0-9][a-z0-9-]*)+$/
const ID = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/

export function createExtensionRoutes(host: ExtensionRoutesOptions): Hono {
  const app = new Hono()

  app.get('/list', async (c) => c.json({ extensions: await host.list() }))

  app.post('/run', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { command?: unknown; args?: unknown } | null
    const command = typeof body?.command === 'string' ? body.command.trim() : ''
    if (!COMMAND.test(command)) return c.json({ message: 'A command name like hubspot:contact:show is needed.' }, 400)
    const args =
      body?.args && typeof body.args === 'object' && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {}
    const answer = await host.run(command, args)
    if (!answer) return c.json({ message: `${command} is not a command of an installed extension.` }, 404)
    return c.json(answer)
  })

  app.post('/enable', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { id?: unknown; enabled?: unknown } | null
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    if (!ID.test(id) || typeof body?.enabled !== 'boolean')
      return c.json({ message: 'An extension id like author/name and on or off are needed.' }, 400)
    const outcome = await host.enable(id, body.enabled)
    if (!outcome.ok) return c.json({ message: outcome.reason }, 404)
    return c.json({ id, enabled: body.enabled })
  })

  app.post('/reload', async (c) => {
    await host.reload()
    return c.json({ reloaded: true })
  })

  return app
}
