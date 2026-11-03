import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { readJson, writeJson } from '#lib/jobs/files.ts'
import { priorityAddressKey, priorityOrderRows, type PriorityGroup } from '#lib/nbfs/priorityOrder.ts'
import { hash, readOptional } from '#lib/outbox/files.ts'
import { KeychainSecretsProvider } from '#lib/secrets/KeychainSecretsProvider.ts'
import { createTypeSafeClient, JEV_MODEL, MISSING_TYPESAFE_KEY, TYPESAFE_SECRET } from '#shared/ai/typesafe/client.ts'
import { hasDaySummary } from '#shared/nbfs/daySummary.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { hold } from '../../activity.ts'
import isDay from './isDay.ts'
import type { DayView } from './mod.ts'
import { createDayPrioritizer, type PrioritizeDayItems, type PriorityEvidence } from './priorityAI.ts'
import { readPriorityContext } from './priorityContext.ts'

const Receipt = z.object({
  fingerprint: z.string(),
  scores: z.array(z.object({ key: z.string(), score: z.number().min(0).max(4) })),
})
type Receipt = z.infer<typeof Receipt>
export interface DayPriorityOptions {
  markdownBaseDir: string
  timeDir: string
  stateDir?: string
  rank?: PrioritizeDayItems
  context?: (day: PlainDate, links: string[]) => Promise<PriorityEvidence['context']>
  time?: () => string
}

/** Derived judgments are cached separately from human priorities in the day file. */
export function createDayPriority(options: DayPriorityOptions, group: PriorityGroup = 'todos') {
  const endpoint = group === 'todos' ? 'todo-priority' : 'reminder-priority'
  const label = group === 'todos' ? 'To-dos' : 'Reminders'
  const statusKey = group === 'todos' ? 'todoPriority' : 'reminderPriority'
  const groupItems = (view: DayView) =>
    group === 'todos' ? [...view.record.commitments, ...view.record.todos] : view.record.reminders
  const dir = options.stateDir ?? path.join(tmpdir(), `sky-day-${hash(options.timeDir)}`, endpoint)
  const secrets = new KeychainSecretsProvider()
  const rank = options.rank ?? createDayPrioritizer(createTypeSafeClient({ secrets }))
  const pending = new Map<string, Promise<void>>()
  const warnings = new Map<string, { warning: string; connection: boolean }>()
  const failures = new Map<string, number>()
  const file = (ymd: string) => path.join(options.timeDir, dayFile(new PlainDate(ymd)))
  const cache = (ymd: string) => path.join(dir, `${ymd}.json`)
  const read = async (ymd: string) => {
    const parsed = Receipt.safeParse(await readJson(cache(ymd)).catch(() => null))
    return parsed.success ? parsed.data : null
  }
  const apply = async (view: DayView): Promise<DayView> => {
    if (view.record.summarized) return view
    const saved = await read(view.day.ymd)
    view.record[statusKey] = { source: saved ? 'sky' : 'saved', ...warnings.get(view.day.ymd) }
    if (!saved) return view
    const content = await readOptional(file(view.day.ymd))
    if (!content) return view
    const rows = new Map(
      priorityOrderRows(content, group).map((row) => [priorityAddressKey(row), JSON.stringify(row.entry)]),
    )
    const scores = new Map(saved.scores.map((row) => [row.key, row.score]))
    const items = [...groupItems(view)].sort((a, b) => a.priority! - b.priority!)
    const open = items.filter((item) => !item.done)
    const automatic = open
      .filter((item) => !item.priorityManual)
      .sort(
        (a, b) =>
          (scores.get(rows.get(priorityAddressKey(b)) ?? '') ?? -1) -
          (scores.get(rows.get(priorityAddressKey(a)) ?? '') ?? -1),
      )
    let index = 0
    // A person's moved row keeps its chosen slot; Jev fills the remaining slots.
    open
      .map((item) => (item.priorityManual ? item : automatic[index++]))
      .forEach((item, priority) => {
        item.priority = priority
      })
    items
      .filter((item) => item.done)
      .forEach((item, index) => {
        item.priority = open.length + index
      })
    return view
  }
  const update = async (ymd: string, view: () => Promise<DayView>) => {
    if ((failures.get(ymd) ?? 0) > performance.now()) return
    const content = await readOptional(file(ymd))
    if (!content || (await hasDaySummary(file(ymd)))) return
    const current = await view()
    const rows = priorityOrderRows(content, group)
    const byAddress = new Map(rows.map((row) => [priorityAddressKey(row), row]))
    const tasks = [...groupItems(current)].filter((item) => !item.done).sort((a, b) => a.priority! - b.priority!)
    if (tasks.length < 2) return
    const date = new PlainDate(ymd)
    const links = [...tasks, ...current.record.mostImportant].flatMap((item) => (item.link ? [item.link.path] : []))
    const context = await (options.context?.(date, links) ??
      readPriorityContext(options.markdownBaseDir, options.timeDir, date, links))
    const clock = current.today.ymd === ymd ? (options.time?.() ?? '') : ''
    // Refresh urgency each quarter-hour without calling the provider on every poll.
    const time = clock.replace(
      /^(\d+):(\d{2}).*$/,
      (_, hour: string, minute: string) => `${hour}:${String(Math.floor(Number(minute) / 15) * 15).padStart(2, '0')}`,
    )
    const evidence: PriorityEvidence = {
      group,
      day: ymd,
      time,
      context,
      mostImportant: current.record.mostImportant.map((item) => item.raw),
      related: (group === 'reminders'
        ? [...current.record.commitments, ...current.record.todos]
        : current.record.reminders
      )
        .filter((item) => !item.done)
        .map((item) => item.raw),
      tasks: tasks.map((item) => ({
        text: item.text,
        notes: item.raw,
        time: item.time,
        category: item.category,
        manual: item.priorityManual ?? false,
      })),
    }
    const fingerprint = hash(JSON.stringify(['day-priority-v2', JEV_MODEL, evidence]))
    if ((await read(ymd))?.fingerprint === fingerprint) {
      warnings.delete(ymd)
      return
    }
    if (!options.rank && !(await secrets.get(TYPESAFE_SECRET.category, TYPESAFE_SECRET.name)))
      throw new Error(MISSING_TYPESAFE_KEY)
    const scores = await rank(evidence, AbortSignal.timeout(20_000))
    if (scores.length !== tasks.length || scores.some((score) => !Number.isFinite(score) || score < 0 || score > 4))
      throw new Error('Priority suggestions were incomplete.')
    const latestContext = await (options.context?.(date, links) ??
      readPriorityContext(options.markdownBaseDir, options.timeDir, date, links))
    if (JSON.stringify(latestContext) !== JSON.stringify(context)) return
    // A late answer cannot publish against edited tasks, new overrides or a closed day.
    if ((await readOptional(file(ymd))) !== content || (await hasDaySummary(file(ymd)))) return
    const receipt: Receipt = {
      fingerprint,
      scores: tasks.map((item, index) => {
        const row = byAddress.get(priorityAddressKey(item))
        if (!row) throw new Error(`An item in ${label} changed while its priority was being suggested.`)
        return { key: JSON.stringify(row.entry), score: scores[index] }
      }),
    }
    await writeJson(cache(ymd), receipt)
    warnings.delete(ymd)
  }
  const refresh = async (ymd: string, view: () => Promise<DayView>) => {
    let job = pending.get(ymd)
    if (!job) {
      const release = hold(`prioritizing ${group}`)
      job = update(ymd, view)
        .catch((error: unknown) => {
          const connection = error instanceof Error && error.message === MISSING_TYPESAFE_KEY
          warnings.set(ymd, {
            warning: connection
              ? `Connect TypeSafe to let Sky prioritize ${label}. Your saved order is still available.`
              : `Sky could not update ${label} priorities. Your existing order is still available.`,
            connection,
          })
          failures.set(ymd, performance.now() + 60_000)
        })
        .finally(release)
      pending.set(ymd, job)
    }
    try {
      await job
    } finally {
      if (pending.get(ymd) === job) pending.delete(ymd)
    }
  }
  const routes = (view: (ymd: string) => Promise<DayView>) => {
    const app = new Hono()
    app.post(`/:ymd/${endpoint}`, async (c) => {
      const origin = c.req.header('Origin')
      if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('Sec-Fetch-Site') === 'cross-site')
        return c.json({ error: `Open ${label} from the Sky app.` }, 403)
      if (!c.req.header('Content-Type')?.startsWith('application/json'))
        return c.json({ error: 'Expected a JSON request.' }, 400)
      const ymd = c.req.param('ymd')
      if (!isDay(ymd)) return c.json({ error: 'Choose a valid day.' }, 400)
      const body = await c.req.json().catch(() => null)
      if (body?.retry === true) failures.delete(ymd)
      await refresh(ymd, () => view(ymd))
      return c.json({ view: await apply(await view(ymd)) })
    })
    return app
  }
  return { apply, refresh, routes }
}
