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
import { priorityContextSources, readPriorityContext } from './priorityContext.ts'
import { PrioritySnapshot, prioritySnapshot, reusePrioritySnapshot, samePriorityOverrides } from './prioritySnapshot.ts'

const Receipt = z.object({
  fingerprint: z.string(),
  model: z.string().optional(),
  scores: z.array(z.object({ key: z.string(), score: z.number().min(0).max(4) })),
  snapshot: PrioritySnapshot.optional(),
  order: z.array(z.string()).optional(),
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
  const fingerprintOf = (content: string, context: PriorityEvidence['context']) =>
    hash(JSON.stringify(['day-priority-v5', JEV_MODEL, group, content, context]))
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
  const contextLinks = (view: DayView) =>
    [...view.record.mostImportant, ...view.record.commitments, ...view.record.todos, ...view.record.reminders].flatMap(
      (item) => (!item.done && item.link ? [item.link.path] : []),
    )
  const inputs = async (view: DayView, content: string) => {
    const date = new PlainDate(view.day.ymd)
    const links = contextLinks(view)
    const context = await (options.context?.(date, links) ??
      readPriorityContext(options.markdownBaseDir, options.timeDir, date, links))
    const sources = [
      ...new Set([
        ...priorityContextSources(options.markdownBaseDir, options.timeDir, date, links),
        ...context.map((document) => document.path),
      ]),
    ]
    return { context, sources, revision: fingerprintOf(content, context), snapshot: prioritySnapshot(content, context) }
  }
  const reuse = (saved: Receipt | null, input: { snapshot?: PrioritySnapshot; sources: string[] }) =>
    saved?.model === JEV_MODEL && saved.snapshot && saved.order && input.snapshot
      ? reusePrioritySnapshot(saved.snapshot, input.snapshot, input.sources)
      : null
  const orderItems = (
    view: DayView,
    content: string,
    saved: Receipt,
    identities?: Map<string, string> | null,
    snapshot?: PrioritySnapshot,
  ) => {
    const rows = new Map(
      priorityOrderRows(content, group).map((row) => [priorityAddressKey(row), JSON.stringify(row.entry)]),
    )
    const key = (item: ReturnType<typeof groupItems>[number]) => {
      const current = rows.get(priorityAddressKey(item)) ?? ''
      return identities?.get(current) ?? current
    }
    const scores = new Map(saved.scores.map((row) => [row.key, row.score]))
    const previous = new Map(saved.order?.map((key, index) => [key, index]))
    const byPrevious = (a: ReturnType<typeof groupItems>[number], b: ReturnType<typeof groupItems>[number]) =>
      (previous.get(key(a)) ?? Number.MAX_SAFE_INTEGER) - (previous.get(key(b)) ?? Number.MAX_SAFE_INTEGER)
    const items = [...groupItems(view)].sort((a, b) => a.priority! - b.priority!)
    let open = items.filter((item) => !item.done)
    if (
      identities &&
      snapshot &&
      saved.snapshot &&
      samePriorityOverrides(saved.snapshot, snapshot, group, identities)
    ) {
      // Filter the resolved order, including manual slots. Re-solving slots after a checkbox can move untouched rows.
      open.sort(byPrevious)
    } else if (!(identities && snapshot?.orders[group].length)) {
      const automatic = open
        .filter((item) => !item.priorityManual)
        .sort((a, b) => (scores.get(key(b)) ?? -1) - (scores.get(key(a)) ?? -1) || byPrevious(a, b))
      let index = 0
      open = open.map((item) => (item.priorityManual ? item : automatic[index++]))
    }
    // A new explicit override already carries the complete chosen order in the day file.
    open.forEach((item, priority) => {
      item.priority = priority
    })
    items
      .filter((item) => item.done)
      .forEach((item, index) => {
        item.priority = open.length + index
      })
    return [...open, ...items.filter((item) => item.done)].map((item) => rows.get(priorityAddressKey(item))!)
  }
  const apply = async (view: DayView): Promise<DayView> => {
    if (view.record.summarized) return view
    const saved = await read(view.day.ymd)
    view.record[statusKey] = { source: saved ? 'sky' : 'saved', ...warnings.get(view.day.ymd) }
    const content = await readOptional(file(view.day.ymd))
    if (!content) return view
    const input = await inputs(view, content).catch(() => {
      view.record[statusKey]!.warning =
        `Sky could not read the context for ${label} priorities. Your existing order is still available. Retry after the source files are readable.`
      return {
        revision: hash(JSON.stringify(['context-unavailable', content])),
        snapshot: undefined,
        sources: priorityContextSources(
          options.markdownBaseDir,
          options.timeDir,
          new PlainDate(view.day.ymd),
          contextLinks(view),
        ),
      }
    })
    const identities = reuse(saved, input)
    Object.assign(view.record[statusKey]!, {
      inputRevision: input.revision,
      revision: identities ? input.revision : saved?.fingerprint,
      sources: input.sources,
    })
    if (!saved) return view
    orderItems(view, content, saved, identities, input.snapshot)
    return view
  }
  const update = async (ymd: string, view: () => Promise<DayView>) => {
    if ((failures.get(ymd) ?? 0) > performance.now()) return
    const content = await readOptional(file(ymd))
    if (!content || (await hasDaySummary(file(ymd)))) return
    const current = await view()
    const input = await inputs(current, content)
    const fingerprint = input.revision
    const saved = await read(ymd)
    if (saved?.fingerprint === fingerprint || reuse(saved, input)) {
      warnings.delete(ymd)
      return
    }
    const rows = priorityOrderRows(content, group)
    const byAddress = new Map(rows.map((row) => [priorityAddressKey(row), row]))
    const tasks = [...groupItems(current)].filter((item) => !item.done).sort((a, b) => a.priority! - b.priority!)
    if (tasks.length < 2) return
    const evidence: PriorityEvidence = {
      group,
      day: ymd,
      time: current.today.ymd === ymd ? (options.time?.() ?? '') : '',
      context: input.context,
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
    if (!options.rank && !(await secrets.get(TYPESAFE_SECRET.category, TYPESAFE_SECRET.name)))
      throw new Error(MISSING_TYPESAFE_KEY)
    const scores = await rank(evidence, AbortSignal.timeout(20_000))
    if (scores.length !== tasks.length || scores.some((score) => !Number.isFinite(score) || score < 0 || score > 4))
      throw new Error('Priority suggestions were incomplete.')
    // A late answer cannot publish against edited tasks, new overrides or a closed day.
    if ((await readOptional(file(ymd))) !== content || (await hasDaySummary(file(ymd)))) return
    if ((await inputs(current, content)).revision !== fingerprint) return
    const receipt: Receipt = {
      fingerprint,
      model: JEV_MODEL,
      snapshot: input.snapshot,
      order: saved?.order,
      scores: tasks.map((item, index) => {
        const row = byAddress.get(priorityAddressKey(item))
        if (!row) throw new Error(`An item in ${label} changed while its priority was being suggested.`)
        return { key: JSON.stringify(row.entry), score: scores[index] }
      }),
    }
    receipt.order = orderItems(current, content, receipt)
    await writeJson(cache(ymd), receipt)
    warnings.delete(ymd)
  }
  const refresh = async (ymd: string, view: () => Promise<DayView>): Promise<void> => {
    let job = pending.get(ymd)
    const joined = Boolean(job)
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
    // The waiting request may represent a newer file revision; the cache makes unchanged joins cheap.
    if (joined) await refresh(ymd, view)
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
