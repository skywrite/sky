import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { ExistingBrowserError } from '#lib/browser/existing/settings.ts'
import { credentialError, CredentialError } from '#lib/credentials/errors.ts'
import { localRequestsOnly } from '../../localRequest.ts'
import type { BrowserAutomationHost } from './host.ts'
import { identifier } from './state.ts'

const schemas = {
  connect: z.object({}).strict(),
  refresh: z.object({ id: identifier }).strict(),
  disconnect: z.object({ id: identifier }).strict(),
  vaults: z.object({ id: identifier, excludedVaultIds: z.array(identifier).max(1000) }).strict(),
  'open-settings': z.object({}).strict(),
  'native-browser': z.object({ browser: z.literal('brave'), applePasswords: z.boolean() }).strict(),
  'bundled-browser': z.object({}).strict(),
  'autofill-settings': z.object({}).strict(),
  'existing-browser': z
    .object({
      token: z.string().min(1).max(300),
      profileDirName: z
        .string()
        .regex(/^(Default|Profile \d+)$/)
        .optional(),
    })
    .strict(),
  'disconnect-browser': z.object({}).strict(),
}

/** Setup metadata only. Credential use and browser execution must never be routed through this API. */
export function createBrowserAutomationRoutes(host: BrowserAutomationHost): Hono {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    await next()
  })
  app.use('*', localRequestsOnly())
  app.use('*', bodyLimit({ maxSize: 512 * 1024 }))
  app.use('*', async (c, next) => {
    if (
      c.req.method === 'POST' &&
      c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
    )
      return c.json({ message: 'Send a JSON setup request.' }, 415)
    await next()
  })
  app.onError((error, c) => {
    if (error instanceof ExistingBrowserError) return c.json({ message: error.message }, 400)
    const failure = credentialError(error)
    const status =
      failure.code === 'invalid-input'
        ? 400
        : failure.code === 'not-found'
          ? 404
          : failure.code === 'conflict'
            ? 409
            : 503
    return c.json(failure.toJSON(), status)
  })
  app.get('/', async (c) => c.json(await host.snapshot()))
  for (const [name, schema] of Object.entries(schemas)) {
    app.post(`/${name}`, async (c) => {
      const raw: unknown = await c.req.json().catch(() => null)
      if (!schema.safeParse(raw).success) throw new CredentialError('invalid-input')
      switch (name) {
        case 'existing-browser': {
          const input = schemas['existing-browser'].parse(raw)
          await host.connectExistingBrowser(input.token, input.profileDirName)
          break
        }
        case 'disconnect-browser':
          await host.disconnectExistingBrowser()
          break
        case 'connect':
          await host.connect()
          break
        case 'refresh':
          await host.refresh(schemas.refresh.parse(raw).id)
          break
        case 'disconnect':
          await host.disconnect(schemas.disconnect.parse(raw).id)
          break
        case 'vaults': {
          const input = schemas.vaults.parse(raw)
          await host.setVaults(input.id, input.excludedVaultIds)
          break
        }
        case 'open-settings':
          await host.openSettings()
          break
        case 'native-browser':
          await host.setNativeBrowser(schemas['native-browser'].parse(raw).applePasswords)
          break
        case 'bundled-browser':
          await host.useBundledBrowser()
          break
        case 'autofill-settings':
          await host.openAutofillSettings()
          break
      }
      return c.json({ ok: true })
    })
  }
  // Do not let an unknown API operation fall through to the Settings HTML shell.
  app.all('*', (c) => c.json({ message: 'Unknown browser setup operation.' }, 404))
  return app
}
