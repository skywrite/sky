import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { WritingVoice } from '#lib/writingVoice/agent.ts'
import { DraftInputSchema, ExampleInputSchema, WritingVoiceError } from '#lib/writingVoice/types.ts'
import { runWithUsageSource } from '#shared/ai/usageLog.ts'

export function createWritingVoiceRoutes(voice: WritingVoice): Hono {
  const app = new Hono()
  app.use('*', bodyLimit({ maxSize: 256 * 1024 }))
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin')
    if (
      c.req.method !== 'GET' &&
      ((origin && origin !== new URL(c.req.url).origin) || c.req.header('Sec-Fetch-Site') === 'cross-site')
    )
      return c.json({ message: 'Open Sky directly to update your writing voice.' }, 403)
    await next()
  })
  app.onError((error, c) =>
    c.json(
      {
        message: error instanceof z.ZodError ? 'Check the writing voice fields and try again.' : error.message,
      },
      error instanceof WritingVoiceError ? error.status : error instanceof z.ZodError ? 400 : 500,
    ),
  )
  app.get('/', async (c) => c.json(await voice.status()))
  app.get('/examples', async (c) => c.json({ examples: await voice.store.list(c.req.query('source')) }))
  app.put('/rules', async (c) => {
    const input = z.object({ text: z.string().max(80_000), revision: z.string() }).parse(await c.req.json())
    return c.json(await voice.store.saveRules(input.text, input.revision))
  })
  app.post('/draft', async (c) => {
    const input = DraftInputSchema.parse(await c.req.json())
    return c.json(await runWithUsageSource('me:voice:draft', () => voice.draft(input)))
  })
  app.post('/examples', async (c) => {
    const input = ExampleInputSchema.omit({ source: true }).parse(await c.req.json())
    return c.json({
      example: await runWithUsageSource('me:voice:learn', () => voice.capture({ ...input, source: 'settings' })),
    })
  })
  app.post('/examples/:id/prepare', async (c) =>
    c.json({
      example: await runWithUsageSource('me:voice:learn', () => voice.prepare(c.req.param('id'))),
    }),
  )
  app.post('/examples/:id/answer', async (c) => {
    const input = z
      .object({
        revision: z.string(),
        option: z.number().int().min(0).max(1).optional(),
        text: z.string().max(4000).optional(),
      })
      .parse(await c.req.json())
    return c.json({
      example: await runWithUsageSource('me:voice:learn', () => voice.answer(c.req.param('id'), input.revision, input)),
    })
  })
  app.post('/compact', async (c) => c.json(await runWithUsageSource('me:voice:compact', () => voice.compact())))
  return app
}
