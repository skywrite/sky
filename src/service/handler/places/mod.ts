import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { hold } from '../../activity.ts'
import { SavePlaceSchema } from './schema.ts'
import type { createPlacesStore } from './store.ts'
import { PlaceError, type PlacesOptions } from './types.ts'

export function createPlacesRoutes(places: ReturnType<typeof createPlacesStore> | null, options: PlacesOptions): Hono {
  const app = new Hono()
  app.use('*', bodyLimit({ maxSize: 256 * 1024 }))
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin')
    if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('Sec-Fetch-Site') === 'cross-site')
      return c.json({ message: 'Open Places directly in Sky.' }, 403)
    if (!places) return c.json({ message: 'Your notebook is still loading. Try again in a moment.' }, 503)
    c.header('Cache-Control', 'no-store')
    const release = c.req.method !== 'GET' ? hold('places') : () => {}
    try {
      await next()
    } finally {
      release()
    }
  })
  app.onError((error, c) =>
    c.json(
      {
        message: error instanceof z.ZodError ? (error.issues[0]?.message ?? 'Check the place fields.') : error.message,
      },
      error instanceof PlaceError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 500,
    ),
  )
  app.get('/', async (c) =>
    c.json({
      places: places!.index(),
      maps: options.maps
        ? await options.maps.config()
        : { browserKey: '', mapId: '', searchAvailable: false, configurable: false },
    }),
  )
  app.get('/place', async (c) => {
    const id = c.req.query('id') || places!.resolveRef(z.string().min(1).parse(c.req.query('ref')))
    return c.json(await places!.detail(id))
  })
  app.post('/place', async (c) => c.json(await places!.save(SavePlaceSchema.parse(await c.req.json()))))
  const record = z.object({ id: z.string().min(1).max(2048), revision: z.string().length(64) })
  app.post('/note', async (c) => {
    const input = record.extend({ text: z.string().trim().min(1).max(80_000) }).parse(await c.req.json())
    return c.json(await places!.addNote(input.id, input.revision, input.text))
  })
  app.post('/archive', async (c) => {
    const input = record.extend({ archived: z.boolean() }).parse(await c.req.json())
    return c.json(await places!.archive(input.id, input.revision, input.archived))
  })
  const maps = () => {
    if (!options.maps)
      throw new PlaceError('Google Maps is not configured on this server. You can still add places manually.', 503)
    return options.maps
  }
  app.post('/google/search', async (c) => {
    const { query } = z.object({ query: z.string().trim().min(2).max(300) }).parse(await c.req.json())
    const results = await maps().search(query)
    const saved = places!.index()
    return c.json(
      results.map((result) => ({ ...result, savedRef: saved.find((p) => p.googlePlaceId === result.id)?.ref })),
    )
  })
  app.post('/google/detail', async (c) => {
    const { id } = z
      .object({
        id: z
          .string()
          .min(1)
          .max(300)
          .regex(/^[A-Za-z0-9_-]+$/),
      })
      .parse(await c.req.json())
    return c.json(await maps().detail(id))
  })
  app.post('/maps', async (c) => {
    const key = z
      .string()
      .trim()
      .min(1)
      .max(300)
      .regex(/^[A-Za-z0-9_-]+$/)
    const input = z
      .object({ browserKey: key.optional(), serverKey: key.optional(), mapId: key.optional() })
      .parse(await c.req.json())
    return c.json(await maps().configure(input))
  })
  return app
}
