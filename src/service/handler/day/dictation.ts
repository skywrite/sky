import * as path from 'node:path'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import OpenAI from 'openai'
import { MISSING_OPENAI_KEY, openaiKey } from '#shared/ai/llm/openaiProvider.ts'
import { hasDaySummary } from '#shared/nbfs/daySummary.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import isDay from './isDay.ts'

const dictationClient = async () => new OpenAI({ apiKey: await openaiKey(), timeout: 15_000, maxRetries: 0 })

/** The browser exchanges its own SDP and sends microphone audio directly to OpenAI. */
export function createDictationRoutes(timeDir: string, getClient = dictationClient): Hono {
  const app = new Hono()
  app.post('/:ymd/item/dictation', bodyLimit({ maxSize: 1024 }), async (c) => {
    c.header('Cache-Control', 'no-store')
    const origin = c.req.header('Origin')
    if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('Sec-Fetch-Site') === 'cross-site')
      return c.json({ error: 'Open the day from the Sky app to start dictation.' }, 403)
    if (!c.req.header('Content-Type')?.startsWith('application/json')) return c.json({ error: 'Expected JSON.' }, 400)
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return c.json({ error: 'Choose a valid day to start dictation.' }, 400)
    if (await hasDaySummary(path.join(timeDir, dayFile(new PlainDate(ymd)))))
      return c.json({ error: 'This day has a saved summary. Reopen the day before dictating.' }, 409)
    try {
      const client = await getClient()
      const { value } = await client.realtime.clientSecrets.create(
        {
          expires_after: { anchor: 'created_at', seconds: 60 },
          session: {
            type: 'transcription',
            audio: { input: { transcription: { model: 'gpt-live-transcribe', delay: 'low' }, turn_detection: null } },
          },
        },
        { signal: c.req.raw.signal },
      )
      return c.json({ value })
    } catch (error) {
      if (
        (error instanceof Error && error.message === MISSING_OPENAI_KEY) ||
        (error instanceof OpenAI.APIError && error.status === 401)
      )
        return c.json(
          {
            error: 'Check your OpenAI API key in Settings › Connections › OpenAI, then tap the mic again.',
            connection: 'openai',
          },
          503,
        )
      if (error instanceof OpenAI.APIError && error.status === 429)
        return c.json(
          { error: 'OpenAI reached its usage limit for dictation. Check your OpenAI usage or type in the field.' },
          503,
        )
      return c.json({ error: 'OpenAI could not start dictation. Tap the mic to retry or type in the field.' }, 502)
    }
  })
  return app
}
