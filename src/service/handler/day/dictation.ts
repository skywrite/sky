import * as path from 'node:path'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import OpenAI from 'openai'
import type { DictationNames } from '#lib/dictation/names.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { MISSING_OPENAI_KEY, openaiKey } from '#shared/ai/llm/openaiProvider.ts'
import { apiErrorMessage } from '#shared/models/Chat/ChatEngine/turnErrorMessage.ts'
import { hasDaySummary } from '#shared/nbfs/daySummary.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import isDay from './isDay.ts'

const dictationClient = async () => new OpenAI({ apiKey: await openaiKey(), timeout: 15_000, maxRetries: 0 })

/** Dictation belongs to the day page: the refusal for a request from anywhere else, else null. */
function refusal(c: Context): Response | null {
  const origin = c.req.header('Origin')
  if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('Sec-Fetch-Site') === 'cross-site')
    return c.json({ error: 'Open the day from the Sky app to start dictation.' }, 403)
  if (!c.req.header('Content-Type')?.startsWith('application/json')) return c.json({ error: 'Expected JSON.' }, 400)
  return null
}

/**
 * The browser exchanges its own SDP and sends microphone audio directly to OpenAI.
 * `names` is what the notebook knows about its own names: the transcriber is told them before
 * the person speaks, and the finished text is checked against them once (lib/dictation/names.ts).
 * Without it dictation works as before and the check returns the text as it came.
 * `report` records a failed names step in the AI error log; a test collects it instead.
 */
export function createDictationRoutes(
  timeDir: string,
  getClient = dictationClient,
  names?: DictationNames,
  report: typeof logAIError = logAIError,
): Hono {
  const app = new Hono()
  app.post('/:ymd/item/dictation', bodyLimit({ maxSize: 1024 }), async (c) => {
    c.header('Cache-Control', 'no-store')
    const refused = refusal(c)
    if (refused) return refused
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return c.json({ error: 'Choose a valid day to start dictation.' }, 400)
    if (await hasDaySummary(path.join(timeDir, dayFile(new PlainDate(ymd)))))
      return c.json({ error: 'This day has a saved summary. Reopen the day before dictating.' }, 409)
    // A list that cannot be read must not stop dictation: the check after Stop still covers the names.
    const keywords = names
      ? await names.keywords().catch(async (error: unknown) => {
          await report({ source: 'day:dictation', stage: 'keywords', message: (error as Error).message })
          return []
        })
      : []
    try {
      const client = await getClient()
      const { value } = await client.realtime.clientSecrets.create(
        {
          expires_after: { anchor: 'created_at', seconds: 60 },
          session: {
            type: 'transcription',
            audio: {
              input: {
                transcription: { model: 'gpt-live-transcribe', delay: 'low', ...(keywords.length > 0 && { keywords }) },
                turn_detection: null,
              },
            },
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

  // Once, on the finished text: misheard names are put right before the draft becomes editable.
  app.post('/:ymd/item/dictation/names', bodyLimit({ maxSize: 32 * 1024 }), async (c) => {
    c.header('Cache-Control', 'no-store')
    const refused = refusal(c)
    if (refused) return refused
    if (!isDay(c.req.param('ymd'))) return c.json({ error: 'Choose a valid day to start dictation.' }, 400)
    const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null
    if (typeof body?.text !== 'string') return c.json({ error: 'Expected the dictated text.' }, 400)
    if (!names) return c.json({ text: body.text })
    try {
      return c.json({ text: await names.correct(body.text, c.req.raw.signal) })
    } catch (error) {
      await report({ source: 'day:dictation:names', stage: 'check', message: apiErrorMessage(error) })
      return c.json({ error: 'Sky could not check the names in this text. Review them before saving.' }, 502)
    }
  })
  return app
}
