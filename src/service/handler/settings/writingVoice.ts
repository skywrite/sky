import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { WritingDraftStore } from '#lib/writingVoice/drafts.ts'
import { DraftInputSchema, EditInputSchema, WritingVoiceError } from '#lib/writingVoice/types.ts'
import { runWithUsageSource } from '#shared/ai/usageLog.ts'

export function createWritingVoiceRoutes(drafts: WritingDraftStore): Hono {
  const { voice, learning } = drafts
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
  app.get('/edits', async (c) => c.json({ edits: await learning.edits(c.req.query('source')) }))
  app.put('/rules', async (c) => {
    const input = z.object({ text: z.string().max(80_000), revision: z.string() }).parse(await c.req.json())
    return c.json(await voice.store.saveRules(input.text, input.revision))
  })
  app.post('/draft', async (c) => {
    const input = DraftInputSchema.parse(await c.req.json())
    return c.json(await runWithUsageSource('me:voice:draft', () => voice.draft(input)))
  })
  app.post('/edits', async (c) => {
    const input = EditInputSchema.omit({ source: true }).parse(await c.req.json())
    // The pane shows the question next, so this request waits for it.
    const edit = await runWithUsageSource('me:voice:learn', async () => {
      const captured = await learning.capture({ ...input, source: 'settings' })
      return captured ? learning.prepare(captured.edit) : null
    })
    return c.json({ edit })
  })
  app.post('/edits/:id/prepare', async (c) =>
    c.json({
      edit: await runWithUsageSource('me:voice:learn', () => learning.prepare(c.req.param('id'))),
    }),
  )
  app.post('/edits/:id/answer', async (c) => {
    const input = z
      .object({
        revision: z.string(),
        option: z.number().int().min(0).max(1).optional(),
        text: z.string().max(4000).optional(),
      })
      .parse(await c.req.json())
    return c.json({
      edit: await runWithUsageSource('me:voice:learn', () => learning.answer(c.req.param('id'), input.revision, input)),
    })
  })
  app.post('/compact', async (c) => c.json(await runWithUsageSource('me:voice:compact', () => voice.compact())))
  return app
}
