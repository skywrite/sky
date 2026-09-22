import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { createMostImportantAI } from '#lib/mostImportant/ai.ts'
import { saveMostImportant } from '#lib/mostImportant/store.ts'
import {
  MAX_MI_QUESTIONS,
  MostImportantError,
  type MostImportantAI,
  type MIProgressReporter,
} from '#lib/mostImportant/types.ts'
import { hash } from '#lib/outbox/files.ts'
import { readOptional } from '#lib/outbox/files.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { hold, touch } from '../../activity.ts'
import { dayEnd } from './ended.ts'
import isDay from './isDay.ts'
import type { ItemRoutesOptions } from './itemContext.ts'

const singleLine = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((value) => !/[\r\n]/.test(value))
const suggestion = z.object({ summary: singleLine, reason: z.string().max(4000) })
const suggestions = z.object({
  previous: z.array(suggestion).max(100).default([]),
  feedback: z.string().max(12000).optional(),
})
const interview = z.object({
  statement: z.string().trim().min(1).max(12000),
  answers: z.array(z.object({ question: z.string().max(4000), answer: z.string().max(16000) })).max(MAX_MI_QUESTIONS),
})
const draft = z.object({
  summary: singleLine,
  dueBy: z.string().trim().max(160),
  body: z.string().trim().min(1).max(100000),
})
const synthesis = interview.extend({ previous: draft.optional(), feedback: z.string().max(12000).optional() })
const save = z.object({ draft, requestId: z.uuid() })
const activity = z.object({ id: z.uuid(), active: z.boolean() })

export function createMostImportantRoutes(options: ItemRoutesOptions & { ai?: MostImportantAI }): Hono {
  const app = new Hono()
  const ai = options.ai ?? createMostImportantAI()
  app.use('/:ymd/mi/*', bodyLimit({ maxSize: 256_000 }))
  app.use('/:ymd/mi/*', async (c, next) => {
    const origin = c.req.header('Origin')
    if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('Sec-Fetch-Site') === 'cross-site')
      return c.json({ error: 'Open the day from the Sky app.' }, 403)
    if (c.req.method !== 'POST' || !c.req.header('Content-Type')?.startsWith('application/json'))
      return c.json({ error: 'Expected a JSON request.' }, 400)
    await next()
  })
  app.onError((error, c) => c.json({ error: error.message }, error instanceof MostImportantError ? error.status : 500))

  app.post('/:ymd/mi/:action', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return c.json({ error: 'Choose a valid day.' }, 400)
    const date = new PlainDate(ymd)
    const body: unknown = await c.req.json().catch(() => null)
    if (c.req.param('action') === 'activity') {
      const input = activity.safeParse(body)
      if (!input.success) return c.json({ error: 'Invalid creation session.' }, 400)
      // Renewed while the composer is open, including time spent answering and reviewing.
      // A lost tab expires instead of preventing every future service reload.
      touch(`most-important:${ymd}:${input.data.id}`, 'creating a most important', input.data.active ? 120_000 : 0)
      return c.json({ active: input.data.active })
    }
    const content = await readOptional(path.join(options.timeDir, dayFile(date)))
    if (c.req.param('action') !== 'save' && content && dayEnd(DayDocument.fromMarkdown(content)).ended)
      return c.json({ error: 'This day has ended. Your draft is still available.' }, 409)
    const respond = async <T extends object>(run: (progress: MIProgressReporter) => Promise<T>) => {
      const release = hold('creating a most important')
      if (!c.req.header('Accept')?.includes('text/event-stream')) {
        try {
          return c.json(await run(() => {}))
        } finally {
          release()
        }
      }
      return streamSSE(c, async (stream) => {
        let chain = Promise.resolve()
        const send = (event: string, data: unknown) => {
          const json = JSON.stringify(data)
          chain = chain.then(() => stream.writeSSE({ event, data: json }))
        }
        send('started', {})
        // A quiet model is still working. A heartbeat lets the client detect a lost connection.
        const heartbeat = setInterval(() => send('heartbeat', {}), 10_000)
        try {
          send('result', await run((progress) => send('progress', progress)))
        } catch (error) {
          send('error', { error: error instanceof Error ? error.message : 'Sky could not finish that step.' })
        } finally {
          clearInterval(heartbeat)
          try {
            await chain
          } finally {
            release()
          }
        }
      })
    }
    switch (c.req.param('action')) {
      case 'suggest': {
        const input = suggestions.safeParse(body)
        if (!input.success) return c.json({ error: 'The suggestion request is invalid.' }, 400)
        return respond((progress) => ai.suggest(date, input.data, progress))
      }
      case 'question': {
        const input = interview.safeParse(body)
        if (!input.success) return c.json({ error: 'The interview is invalid.' }, 400)
        return respond(async (progress) => ({
          question:
            input.data.answers.length >= MAX_MI_QUESTIONS ? null : await ai.question(date, input.data, progress),
        }))
      }
      case 'draft': {
        const input = synthesis.safeParse(body)
        if (!input.success) return c.json({ error: 'The draft request is invalid.' }, 400)
        return respond(async (progress) => ({ draft: await ai.draft(date, input.data, progress) }))
      }
      case 'save': {
        const input = save.safeParse(body)
        if (!input.success) return c.json({ error: 'Give the task a title and description, then try again.' }, 400)
        return respond(async (progress) => {
          progress({ stage: 'thinking' })
          const enrichment = await ai.enrich?.(input.data.draft)
          progress({ stage: 'saving' })
          const saved = await saveMostImportant(
            {
              timeDir: options.timeDir,
              stateDir: options.stateDir ?? path.join(tmpdir(), `sky-day-${hash(options.timeDir)}`),
              dayStateDir: options.workstreams?.stateDir,
              write: options.writePlanning,
            },
            date,
            input.data.draft,
            input.data.requestId,
            enrichment,
          )
          return { saved, view: await options.view(ymd) }
        })
      }
      default:
        return c.json({ error: 'Unknown task action.' }, 404)
    }
  })
  return app
}
