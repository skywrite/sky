import * as path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { generateText } from 'ai'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  defaultAvailabilityTemplate,
  defaultDayLineStyle,
  formatErrors,
  templateError,
} from '#lib/calendarScheduler/availabilityMessage.ts'
import { availabilityZone, findAvailableTimes, windowsSchema } from '#lib/calendarScheduler/findTime.ts'
import { interpretAvailability } from '#lib/calendarScheduler/interpretAvailability.ts'
import type { CalendarSchedulerHost } from '#lib/calendarScheduler/types.ts'
import { readJson, withProcessLock, writeJson } from '#lib/jobs/files.ts'
import { readOptional } from '#lib/outbox/files.ts'
import { aiModel } from '#shared/ai/models.ts'

const formatSchema = z.object({ template: z.string(), dayLine: z.string(), timeSeparator: z.string() })
const savedFormatSchema = formatSchema.extend({ version: z.number().int().optional() })
const editSchema = z.union([
  z.object({ previous: formatSchema, format: formatSchema }),
  z.object({ previous: z.string(), template: z.string().trim() }),
])

export function createFindTimeRoutes(host: CalendarSchedulerHost) {
  const app = new Hono()
  const file = path.join(host.dir, 'availability-template.json')
  const legacyFile = path.join(host.dir, 'availability-template.txt')
  const readFormat = async () => {
    const saved = await readJson<unknown>(file)
    if (saved === null)
      return { template: (await readOptional(legacyFile)) ?? defaultAvailabilityTemplate, ...defaultDayLineStyle }
    const { version, ...format } = savedFormatSchema.parse(saved)
    // Only the original stock line follows the new default. A subsequent explicit edit is always literal.
    if (version === undefined && format.dayLine === '• {{day}} — {{times}}')
      format.dayLine = defaultDayLineStyle.dayLine
    return format
  }
  app.onError((error, c) =>
    c.json({ message: error instanceof z.ZodError ? error.issues[0]?.message : error.message }, 400),
  )
  app.post('/interpret', async (c) => {
    const { query, timezone } = z
      .object({ query: z.string().trim().min(1).max(4000), timezone: availabilityZone })
      .parse(await c.req.json())
    return c.json(await interpretAvailability(query, timezone, c.req.raw.signal))
  })
  app.post('/windows', async (c) => {
    if (!host.readCalendars)
      return c.json({ message: 'Calendar availability is unavailable. Check your calendar connection and retry.' }, 503)
    const search = windowsSchema.parse(await c.req.json())
    return c.json(await findAvailableTimes(search, host.readCalendars))
  })
  app.get('/template', async (c) => c.json(await readFormat()))
  app.post('/template', async (c) => {
    const edit = editSchema.parse(await c.req.json())
    return withProcessLock(legacyFile + '.lock', async () => {
      const current = await readFormat()
      // A browser opened before day styles were introduced can still edit just the email body.
      const previous = 'format' in edit ? edit.previous : { ...current, template: edit.previous }
      const next = 'format' in edit ? edit.format : { ...current, template: edit.template }
      const problem = Object.values(formatErrors(next)).find(Boolean)
      if (problem) return c.json({ message: problem }, 400)
      if (isDeepStrictEqual(current, next)) return c.json(current)
      if (!isDeepStrictEqual(current, previous))
        return c.json(
          {
            message:
              'The saved template changed in another window. Review the latest version before saving your edits.',
          },
          409,
        )
      await writeJson(file, { version: 2, ...next }, 2)
      return c.json(next)
    })
  })
  app.post('/wording', async (c) => {
    const { template } = await readFormat()
    if (templateError(template))
      throw new Error('Edit the saved availability template to include {{days}} on a line of its own.')
    try {
      const rules = await host.writingRules?.()
      const { text, finishReason } = await generateText({
        ...aiModel('fast'),
        abortSignal: AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(12_000)]),
        maxRetries: 0,
        maxOutputTokens: 1200,
        instructions:
          'Lightly polish the opening and closing of this short scheduling email in the owner’s voice. Keep their template, tone and meaning. Preserve {{days}} exactly once on its own line. Keep {{timezone}} only if it appears in the original. Sky formats the day lines. Do not add names, dates, times, availability claims, greetings, signatures or commitments. Return only the plain-text template. If it already reads naturally, return it verbatim.',
        prompt: JSON.stringify({ template, writingStyle: rules }),
      })
      const wording = text.trim()
      if (
        finishReason === 'stop' &&
        wording &&
        !templateError(wording) &&
        wording.includes('{{timezone}}') === template.includes('{{timezone}}')
      )
        return c.json({ template, wording })
    } catch {
      c.req.raw.signal.throwIfAborted()
    }
    return c.json({ template, wording: template })
  })
  return app
}
