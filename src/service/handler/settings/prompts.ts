import { Hono } from 'hono'
import { PromptCatalog, PromptError } from '#shared/prompts/catalog.ts'

/** Only catalog IDs cross the HTTP boundary, never arbitrary filesystem paths. */
export function createPromptRoutes(catalog: PromptCatalog): Hono {
  const app = new Hono()
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin')
    if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('Sec-Fetch-Site') === 'cross-site') {
      return c.json({ message: 'Open prompts from the Sky app.' }, 403)
    }
    await next()
  })
  app.onError((error, c) => c.json({ message: error.message }, error instanceof PromptError ? error.status : 400))
  app.get('/list', async (c) => c.json({ prompts: await catalog.list() }))
  app.get('/document', async (c) => c.json(await catalog.get(c.req.query('id') ?? '')))
  app.post('/preview', async (c) => {
    const data = (await c.req.json()) as Record<string, unknown>
    if (
      typeof data.id !== 'string' ||
      typeof data.content !== 'string' ||
      !data.values ||
      typeof data.values !== 'object' ||
      Array.isArray(data.values)
    )
      throw new PromptError('Provide a prompt and sample values.')
    if (JSON.stringify(data.values).length > 512_000) throw new PromptError('Sample values are too large.')
    return c.json(await catalog.preview(data.id, data.content, data.values as Record<string, unknown>))
  })
  app.put('/document', async (c) => {
    const data = (await c.req.json()) as Record<string, unknown>
    if (typeof data.id !== 'string' || typeof data.content !== 'string' || typeof data.version !== 'string')
      throw new PromptError('Provide the prompt, content, and saved version.')
    return c.json(await catalog.save(data.id, data.content, data.version))
  })
  app.post('/restore', async (c) => {
    const data = (await c.req.json()) as Record<string, unknown>
    if (typeof data.id !== 'string' || typeof data.version !== 'string')
      throw new PromptError('Provide the prompt and saved version.')
    return c.json(await catalog.restore(data.id, data.version))
  })
  app.post('/new', async (c) => {
    const data = (await c.req.json()) as Record<string, unknown>
    if (typeof data.name !== 'string') throw new PromptError('Provide a prompt name.')
    return c.json(await catalog.create(data.name), 201)
  })
  return app
}
