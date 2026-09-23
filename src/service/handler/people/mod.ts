import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { linkedInUrl } from '#lib/linkedin/types.ts'
import { hold } from '../../activity.ts'
import { SaveProfileSchema } from './schema.ts'
import type { createPeopleStore } from './store.ts'
import { ProfileError, type PeopleOptions } from './types.ts'

export function createPeopleRoutes(
  profiles: ReturnType<typeof createPeopleStore> | null,
  options: PeopleOptions,
): Hono {
  const app = new Hono()
  app.use('*', bodyLimit({ maxSize: 256 * 1024 }))
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin')
    if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('Sec-Fetch-Site') === 'cross-site')
      return c.json({ message: 'Open People & Orgs directly in Sky.' }, 403)
    if (!profiles) return c.json({ message: 'Your notebook is still loading. Try again in a moment.' }, 503)
    const release = c.req.method !== 'GET' ? hold('people') : () => {}
    try {
      await next()
    } finally {
      release()
    }
  })
  app.onError((error, c) =>
    c.json(
      {
        message:
          error instanceof z.ZodError ? (error.issues[0]?.message ?? 'Check the profile fields.') : error.message,
      },
      error instanceof ProfileError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 500,
    ),
  )
  app.get('/', async (c) => c.json(await profiles!.index()))
  const type = z.enum(['person', 'org'])
  app.get('/profile', async (c) => {
    const kind = type.parse(c.req.query('type'))
    const slug = c.req.query('slug')
    const id = slug ? (await profiles!.resolveRoute(kind, slug))?.id : c.req.query('id')
    if (!id) throw new ProfileError('This profile could not be found.', 404)
    return c.json(await profiles!.detail(kind, id))
  })
  app.post('/profile', async (c) => c.json(await profiles!.save(SaveProfileSchema.parse(await c.req.json()))))
  app.post('/note', async (c) => {
    const input = z
      .object({
        type,
        id: z.string().min(1),
        revision: z.string().length(64),
        text: z.string().trim().min(1).max(80_000),
      })
      .parse(await c.req.json())
    return c.json(await profiles!.addNote(input.type, input.id, input.revision, input.text))
  })
  app.get('/linkedin', async (c) => c.json(options.linkedIn ? await options.linkedIn.status() : null))
  app.post('/linkedin', async (c) => {
    if (!options.linkedIn) throw new ProfileError('LinkedIn import is not available on this server.', 503)
    const { url } = z.object({ url: z.string().max(2048) }).parse(await c.req.json())
    try {
      linkedInUrl(url)
    } catch (error) {
      throw new ProfileError((error as Error).message)
    }
    return c.json(await options.linkedIn.start(url))
  })
  app.post('/linkedin/cancel', async (c) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(await c.req.json())
    await options.linkedIn?.cancel(id)
    return c.json({ ok: true })
  })
  return app
}
