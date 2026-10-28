import * as path from 'node:path'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { hash } from '#lib/outbox/files.ts'
import type { TrackingStore } from '#lib/tracking/store.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { hold } from '../../../activity.ts'
import type { ThreadSummary } from '../../chat/mod.ts'
import type { StreaksStore } from '../../streaks/store.ts'
import isDay from '../isDay.ts'
import { buildDayView, type DayRoutesOptions } from '../mod.ts'
import { dayItemKey } from '../organizingTypes.ts'
import { buildReviewRecords } from '../reviewRecords.ts'
import type { ScheduleHost } from '../schedule.ts'
import { DayReviewStore } from './store.ts'
import { REVIEW_STEPS, type ReviewItem, type ReviewRuntime } from './types.ts'

interface Options {
  day: DayRoutesOptions
  dayRoutes: Hono
  stateDir: string
  runtime: ReviewRuntime
  tracking?: TrackingStore
  streaks?: StreaksStore
  imports?: () => Promise<import('../../import/jobs.ts').ImportJob[]>
  schedule?: ScheduleHost
  chats?: { list: () => Promise<ThreadSummary[]>; close: (id: string) => Promise<void> }
}
const fingerprint = (kind: string, value: unknown) => `${kind}:${hash(JSON.stringify(value))}`
const reviewDay = (c: Context) =>
  z.string().refine(isDay, 'Use a real date in YYYY-MM-DD format.').parse(c.req.param('day'))
const ItemId = z.string().regex(/^(carry|streak|tracking|meeting|check):[a-f0-9]{64}$/)
const scheduled = (date: PlainDate, rule: { start: string | null; end: string | null; schedule: string }) =>
  (!rule.start || rule.start <= date.ymd) &&
  (!rule.end || rule.end >= date.ymd) &&
  rule.schedule !== 'manual' &&
  (rule.schedule !== 'weekdays' || !['Saturday', 'Sunday'].includes(date.dayLong))
const href = (file: string) => `/explorer/${file.split('/').map(encodeURIComponent).join('/')}`
const operationId = (key: string) => {
  const h = hash(key)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export function createReviewRoutes(options: Options) {
  // Calendar reads can be remote; reuse a short-lived snapshot while the dialog polls jobs.
  const calendars = new Map<string, { at: number; value: ReturnType<ScheduleHost> }>()
  const inventory = async (ymd: string) => {
    const date = new PlainDate(ymd)
    const view = await buildDayView(options.day, ymd)
    const items: ReviewItem[] = []
    const hasDay = Boolean(view.day.dayRelativePath)
    const summarized = view.record.summarized
    if (hasDay) {
      for (const item of [...view.record.todos, ...view.record.reminders].filter((item) => !item.done)) {
        if (!item.revision) continue
        items.push({
          id: fingerprint('carry', [dayItemKey(item), item.revision]),
          kind: 'carry',
          title: item.text,
          detail: item.list,
          address: { list: item.list, raw: item.raw, occurrence: item.occurrence, revision: item.revision },
          href: item.workstream ? `/workstreams/${encodeURIComponent(item.workstream.id)}` : `/${ymd}?view=record`,
          blocked: summarized
            ? 'This day has a saved summary. Remove its summary to move tasks again.'
            : item.workstream
              ? 'Move this activity from its workstream.'
              : undefined,
        })
      }
      const warning = (title: string, message: string, link: string) =>
        items.push({
          id: fingerprint('check', [title, message]),
          kind: 'check',
          title,
          detail: message,
          href: link,
        })
      if (options.streaks) {
        try {
          const report = await options.streaks.review(date)
          for (const streak of report.streaks.filter((s) => !s.done))
            items.push({
              id: fingerprint('streak', [streak.name, streak.revision]),
              kind: 'streak',
              name: streak.name,
              title: streak.title,
              detail: streak.rule,
              href: `/streaks/${encodeURIComponent(streak.name)}`,
              blocked: summarized
                ? 'This day has a saved summary. Remove its summary to edit streaks again.'
                : undefined,
            })
          for (const message of report.warnings) warning('Check streaks', message, '/streaks')
        } catch (error) {
          warning('Could not read streaks', (error as Error).message, '/streaks')
        }
      }
      if (options.tracking) {
        try {
          const report = await options.tracking.report(ymd, ymd)
          for (const metric of report.metrics.filter(
            (m) => scheduled(date, m.tracker) && m.tracker.ask !== 'anytime' && !m.entries.length,
          ))
            items.push({
              id: fingerprint('tracking', [metric.tracker.name, metric.tracker.revision]),
              kind: 'tracking',
              title: metric.tracker.title,
              detail: metric.tracker.question,
              name: metric.tracker.name,
              tracker: metric.tracker,
              href: `/tracking/${encodeURIComponent(metric.tracker.name)}`,
              blocked: summarized
                ? 'This day has a saved summary; open Tracking to make a historical correction.'
                : undefined,
            })
          for (const error of report.errors) warning(`Could not read ${error.name}`, error.message, '/tracking')
          for (const metric of report.metrics)
            for (const message of metric.warnings) warning(metric.tracker.title, message, '/tracking')
        } catch (error) {
          warning('Could not read tracking', (error as Error).message, '/tracking')
        }
      }
      if (options.imports) {
        for (const job of await options.imports()) {
          const kind = job.fields?.kind ?? (job.calendar ? 'meeting' : null)
          const date = (job.fields?.when ?? job.suggestedWhen).slice(0, 10)
          if (kind === 'meeting' && date === ymd && job.state !== 'done')
            items.push({
              id: fingerprint('meeting', job.id),
              kind: 'meeting',
              title: job.title,
              detail: job.error ?? job.line ?? 'Finish filing these meeting notes.',
              href: `/import/${job.id}`,
            })
        }
      }
      const records = await buildReviewRecords({
        dayDirPath: path.join(options.day.timeDir, dayDir(date)),
        markdownBaseDir: options.day.markdownBaseDir,
      })
      for (const item of records.endless)
        items.push({
          id: fingerprint('meeting', item),
          kind: 'meeting',
          title: item.title,
          detail: `Started at ${item.start}; add an end time or duration.`,
          href: href(item.path),
        })
      // Inline meeting notes are not filed meeting records yet.
      for (const item of view.record.meetings.filter((m) => m.inline))
        items.push({
          id: fingerprint('meeting', [item.path, item.title, item.when]),
          kind: 'meeting',
          title: item.title,
          detail: 'Inline notes are still on the day. Open them to review or import a transcript to file the meeting.',
          href: href(item.path),
          meeting: item.when ? { title: item.title, when: `${ymd} ${item.when.split(' ')[0]}` } : undefined,
        })
      if (options.schedule) {
        let cached = calendars.get(ymd)
        if (!cached || performance.now() - cached.at > 30_000) {
          cached = { at: performance.now(), value: options.schedule(date) }
          calendars.set(ymd, cached)
          if (calendars.size > 20) calendars.delete(calendars.keys().next().value!)
        }
        const schedule = await cached.value
        for (const meeting of schedule.meetings.filter((m) => !m.allDay && !m.record))
          items.push({
            id: fingerprint('meeting', [meeting.classification?.key, meeting.title, meeting.start]),
            kind: 'meeting',
            title: meeting.title,
            detail: `${meeting.start}–${meeting.end} · No filed notes`,
            href: `/${ymd}?view=record`,
            meeting: { title: meeting.title, when: `${ymd} ${meeting.start}` },
          })
        for (const message of schedule.errors) warning('Check meeting notes', message, `/${ymd}?view=record`)
      }
    }
    return {
      items,
      hasDay,
      summarized,
      today: view.planningToday ?? PlainDate.today().ymd,
      summaryHref: view.summary ? `/${ymd}?view=summary` : null,
      chats: ((await options.chats?.list()) ?? [])
        .filter((thread) => !thread.id.startsWith('day-') && thread.day <= ymd)
        .map((thread) => ({
          id: thread.id,
          title: thread.title ?? 'Untitled chat',
          started: thread.day,
          lastActive:
            Object.keys(thread.activity ?? {})
              .sort()
              .at(-1) ?? null,
          saves: thread.saves,
          busy: thread.busy,
        })),
    }
  }
  const store = new DayReviewStore(options.stateDir, {
    inventory,
    runtime: options.runtime,
    move: async (ymd, items, date) => {
      const response = await options.dayRoutes.request(`/${ymd}/item/organize/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((item) => item.address),
          date,
          requestId: operationId(`${ymd}:${items.map((item) => item.id).join(':')}:${date}`),
        }),
      })
      if (!response.ok) {
        const body = (await response.json()) as { error?: string }
        throw new Error(
          `${items.map((item) => item.title).join(', ')}: ${body.error ?? 'Could not move these items. Refresh and try again.'}`,
        )
      }
    },
    apply: async (ymd, item, values) => {
      if (item.kind === 'streak' && item.name && options.streaks) {
        await options.streaks.completion(item.name, { date: ymd, done: true, expectedDone: false })
      } else if (item.kind === 'tracking' && item.tracker && options.tracking) {
        await options.tracking.saveEntry(item.tracker.name, {
          date: ymd,
          values: values ?? {},
          revision: item.tracker.revision,
          operationId: operationId(`${ymd}:${item.id}:${JSON.stringify(values)}`),
        })
      } else throw new Error('Open this item to finish it, or skip it for this review.')
    },
  })
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.method === 'POST') {
      const origin = c.req.header('origin')
      if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('sec-fetch-site') === 'cross-site')
        return c.json({ message: 'Open the review in Sky to make this change.' }, 403)
      if (!c.req.header('content-type')?.includes('application/json')) return c.json({ message: 'Expected JSON.' }, 415)
      const release = hold('saving day review')
      try {
        await next()
      } finally {
        release()
      }
      return
    }
    await next()
  })
  app.onError((error, c) => c.json({ message: error.message }, error instanceof z.ZodError ? 400 : 409))
  app.get('/status', async (c) => c.json(await options.runtime.status()))
  app.post('/:day/acknowledge', async (c) => {
    await options.runtime.acknowledge(reviewDay(c))
    return c.json({ ok: true })
  })
  app.get('/:day', async (c) => c.json(await store.refresh(reviewDay(c))))
  app.post('/:day/open', async (c) => {
    const body = z.object({ prompted: z.boolean().optional() }).parse(await c.req.json())
    return c.json(await store.open(reviewDay(c), body))
  })
  app.post('/:day/close', async (c) => {
    await store.close(reviewDay(c))
    return c.json({ ok: true })
  })
  app.post('/:day/refresh', async (c) => {
    calendars.delete(reviewDay(c))
    return c.json(await store.open(reviewDay(c)))
  })
  app.post('/:day/step', async (c) => {
    const body = z
      .object({ step: z.enum(REVIEW_STEPS), skipIds: z.array(ItemId).max(1000).optional() })
      .parse(await c.req.json())
    return c.json(await store.goToStep(reviewDay(c), body.step, body.skipIds))
  })
  app.post('/:day/chat/close', async (c) => {
    const day = reviewDay(c)
    const { id } = z.object({ id: z.string().min(1).max(200) }).parse(await c.req.json())
    const chat = (await store.view(day)).chats.find((chat) => chat.id === id)
    if (!options.chats || !chat) throw new Error('This chat is no longer open. Refresh the review.')
    if (!chat.saves) throw new Error('Open this temporary chat to decide whether to keep it.')
    try {
      await options.chats.close(id)
    } catch (error) {
      throw new Error(`Could not save and close “${chat.title}”: ${(error as Error).message}`)
    }
    return c.json(await store.refresh(day))
  })
  app.post('/:day/move', async (c) => {
    const body = z
      .object({
        ids: z
          .array(ItemId)
          .min(1)
          .max(100)
          .refine((ids) => new Set(ids).size === ids.length),
      })
      .parse(await c.req.json())
    return c.json(await store.move(reviewDay(c), body.ids))
  })
  app.post('/:day/answer', async (c) => {
    const body = z
      .object({
        id: ItemId,
        action: z.enum(['skip', 'apply', 'restore']),
        values: z.record(z.string().max(100), z.string().max(10_000)).optional(),
      })
      .parse(await c.req.json())
    return c.json(await store.answer(reviewDay(c), body.id, body.action, body.values))
  })
  app.post('/:day/draft', async (c) => {
    const body = z
      .object({ id: ItemId, values: z.record(z.string().max(100), z.string().max(10_000)) })
      .parse(await c.req.json())
    await store.draft(reviewDay(c), body.id, body.values)
    return c.json({ ok: true })
  })
  app.post('/:day/retry', async (c) => {
    const body = z.object({ id: z.string().max(100) }).parse(await c.req.json())
    return c.json(await store.retry(reviewDay(c), body.id))
  })
  return app
}
