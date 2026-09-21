import * as path from 'node:path'
import { Hono } from 'hono'
import { appendTaskBlock } from '#lib/nbfs/fileTaskItems.ts'
import { blockRaw, ItemEditError } from '#lib/nbfs/listBlocks.ts'
import { writePlanningChanges as writeChanges, type PlanningChange as Change } from '#lib/nbfs/planningChanges.ts'
import { emptySchedule, scheduledBlock } from '#lib/nbfs/scheduledItems.ts'
import { taskDestination, taskFiling } from '#lib/nbfs/taskDestination.ts'
import { readOptional, withLock } from '#lib/outbox/files.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'
import { bodyOf, dayFileOf, type ItemRoutesOptions } from './itemContext.ts'
import {
  addPlanItem,
  moveItemMarkdown,
  nextEntries,
  removePlanItem,
  restorePlanItem,
  type NextEntry,
} from './planningText.ts'
import { normalizeDayTime, type DayPlanInput, type NextFile } from './planningTypes.ts'

const FILES: NextFile[] = ['next-professional.md', 'next-personal.md']
interface Added {
  file: string
  list: string
  raw: string
}
interface Removed {
  file: string
  list: string
  raw: string
  at: number
}
interface Operation {
  day: string
  request: string
  changes: Change[]
  added: Added[]
  removed: Removed[]
  message: string
  href?: string
  expires: number
  undone: boolean
}

class PlanningError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 409,
  ) {
    super(message)
  }
}

function inputOf(body: Record<string, unknown> | null): DayPlanInput | null {
  if (!body || !['todos', 'commitments', 'reminders'].includes(String(body.kind))) return null
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000) return null
  // A composer adds one item. Newlines cannot introduce another list or metadata.
  const text = body.text.trim().replace(/\s+/g, ' ')
  const category = body.category ?? 'Professional'
  if (typeof category !== 'string' || !category.trim() || category.length > 80 || /[\r\n#]/.test(category)) return null
  const kind = body.kind as DayPlanInput['kind']
  const time = typeof body.time === 'string' ? normalizeDayTime(body.time) : null
  if (kind === 'commitments' ? !time : body.time !== undefined && body.time !== '') return null
  return { kind, text, category: category.trim(), ...(time ? { time } : {}) }
}

export function createPlanningRoutes(options: ItemRoutesOptions): Hono {
  const app = new Hono()
  const operations = new Map<string, Operation>()
  // The outer item guard already owns the source/day lock. Schedule writers
  // use the same second lock as CLI carries and day:start imports.
  app.use('*', async (c, next) => {
    if (c.req.method === 'POST' && /\/item\/(?:add|pull|undo)$/.test(c.req.path) && options.workstreams)
      return withLock(path.join(options.workstreams.stateDir, 'schedule.lock'), next)
    await next()
  })
  const cleanup = () => {
    for (const [id, operation] of operations) if (operation.expires < performance.now()) operations.delete(id)
    while (operations.size > 200) operations.delete(operations.keys().next().value!)
  }
  const remember = (id: string, operation: Omit<Operation, 'expires' | 'undone'>) => {
    cleanup()
    operations.set(id, { ...operation, expires: performance.now() + 10 * 60_000, undone: false })
  }
  app.onError((error, c) =>
    c.json(
      { error: error.message },
      error instanceof PlanningError || error instanceof ItemEditError ? error.status : 500,
    ),
  )
  const readNext = async (content: string) => {
    const sources = new Map<string, string>()
    const entries: NextEntry[] = []
    for (const file of FILES) {
      const source = await readOptional(path.join(options.timeDir, file))
      if (source === undefined) continue
      sources.set(file, source)
      entries.push(...nextEntries(source, file, content))
    }
    return { sources, entries }
  }

  app.get('/:ymd/item/next', async (c) => {
    const day = await dayFileOf(c, options, true)
    if (day instanceof Response) return day
    const { entries } = await readNext(day.content)
    return c.json({
      items: entries.map(({ raw: _raw, item: _item, at: _at, ...entry }) => ({
        ...entry,
        path: path.relative(options.markdownBaseDir, path.join(options.timeDir, entry.file)),
      })),
    })
  })

  app.post('/:ymd/item/add', async (c) => {
    const body = await bodyOf(c)
    const input = inputOf(body)
    if (!input || typeof body?.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.requestId))
      return c.json({ error: 'Enter an item, its category, and a time for a commitment.' }, 400)
    const day = await dayFileOf(c, options, true)
    if (day instanceof Response) return day
    const id = body.requestId
    const request = JSON.stringify(input)
    cleanup()
    const previous = operations.get(id)
    if (previous) {
      if (previous.day !== day.ymd || previous.request !== request || previous.undone)
        throw new PlanningError('This request has already been used. Try again.')
      return c.json({ view: await options.view(day.ymd), undo: id, message: previous.message, href: previous.href })
    }
    const result = addPlanItem(day.content, input)
    if (
      DayDocument.fromMarkdown(day.content).lists.some(
        (list) => list.title === result.list && list.items.includes(result.raw),
      )
    )
      throw new PlanningError('That item is already on this day.')
    const date = new PlainDate(day.ymd)
    const destination = taskDestination({ DIR_TIME: options.timeDir }, date, options.today(), result.list)
    const before =
      destination.filed === 'day' ? (day.exists ? day.content : undefined) : await readOptional(destination.file)
    const after =
      destination.filed === 'day'
        ? result.content
        : appendTaskBlock(before ?? emptySchedule(result.list), date, result.list, `- ${result.raw}`, true)
    const changes = [{ file: destination.file, before, after }]
    await writeChanges(changes, options.writePlanning)
    const message =
      destination.filed === 'schedule'
        ? `Scheduled for ${day.ymd}`
        : input.kind === 'commitments'
          ? `Commitment added at ${input.time}`
          : input.kind === 'reminders'
            ? 'Reminder added'
            : 'To-do added'
    const href = destination.filed === 'schedule' ? `/week/${Week.of(date)}` : undefined
    remember(id, {
      day: day.ymd,
      request,
      changes,
      added: [
        {
          file: destination.file,
          list: destination.list,
          raw: destination.filed === 'schedule' ? blockRaw(scheduledBlock(`- ${result.raw}`, result.list)) : result.raw,
        },
      ],
      removed: [],
      message,
      href,
    })
    return c.json({ view: await options.view(day.ymd), undo: id, message, href })
  })

  app.post('/:ymd/item/pull', async (c) => {
    const body = await bodyOf(c)
    if (
      !body ||
      !['todos', 'reminders'].includes(String(body.kind)) ||
      !Array.isArray(body.ids) ||
      body.ids.length === 0 ||
      body.ids.length > 100 ||
      !body.ids.every((id) => typeof id === 'string') ||
      typeof body.requestId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(body.requestId) ||
      body.time !== undefined
    )
      return c.json({ error: 'Select untimed Next items to move into To-dos or Reminders.' }, 400)
    const day = await dayFileOf(c, options, true)
    if (day instanceof Response) return day
    const request = JSON.stringify({ kind: body.kind, ids: [...new Set(body.ids)].sort() })
    const id = body.requestId
    cleanup()
    const previous = operations.get(id)
    if (previous) {
      if (previous.day !== day.ymd || previous.request !== request || previous.undone)
        throw new PlanningError('This request has already been used. Try again.')
      return c.json({ view: await options.view(day.ymd), undo: id, message: previous.message, href: previous.href })
    }
    const { sources, entries } = await readNext(day.content)
    const selected = [...new Set(body.ids)].map((id) => entries.find((entry) => entry.id === id))
    if (selected.some((entry) => !entry || entry.already || entry.unavailable))
      throw new PlanningError('The lists changed. Review the items and select again.')
    let content = day.content
    const added: Added[] = []
    const removed: Removed[] = []
    const changedSources = new Map(sources)
    const destinations = new Map<string, Change>()
    const date = new PlainDate(day.ymd)
    for (const entry of selected as NextEntry[]) {
      const file = path.join(options.timeDir, entry.file)
      const text = moveItemMarkdown(entry.item, sources.get(entry.file)!, file, day.file)
      const result = addPlanItem(content, { text, category: entry.category, kind: body.kind as 'todos' | 'reminders' })
      if (
        DayDocument.fromMarkdown(content).lists.some(
          (list) => list.title === result.list && list.items.includes(result.raw),
        )
      )
        throw new PlanningError('The selection includes the same item more than once.')
      const deletion = removePlanItem(changedSources.get(entry.file)!, entry.list, entry.raw)
      if (deletion.kind === 'missing')
        throw new PlanningError('An item changed in its Next list. Refresh and try again.')
      changedSources.set(entry.file, deletion.content)
      const destination = taskDestination({ DIR_TIME: options.timeDir }, date, options.today(), result.list)
      if (destination.filed === 'day') content = result.content
      else {
        let change = destinations.get(destination.file)
        if (!change) {
          const before = await readOptional(destination.file)
          change = { file: destination.file, before, after: before ?? emptySchedule(result.list) }
          destinations.set(destination.file, change)
        }
        const movedText = moveItemMarkdown(entry.item, sources.get(entry.file)!, file, destination.file)
        change.after = appendTaskBlock(change.after!, date, result.list, `- ${movedText}`, true)
      }
      const raw =
        destination.filed === 'day'
          ? result.raw
          : blockRaw(
              scheduledBlock(
                `- ${moveItemMarkdown(entry.item, sources.get(entry.file)!, file, destination.file)}`,
                result.list,
              ),
            )
      added.push({ file: destination.file, list: destination.list, raw })
      removed.push({ file, list: entry.list, raw: entry.raw, at: entry.at })
    }
    const changes: Change[] = [...destinations.values()]
    if (content !== day.content)
      changes.push({ file: day.file, before: day.exists ? day.content : undefined, after: content })
    for (const [name, after] of changedSources) {
      const before = sources.get(name)!
      if (before !== after) changes.push({ file: path.join(options.timeDir, name), before, after })
    }
    await writeChanges(changes, options.writePlanning)
    const scheduled = taskFiling(date, options.today()) === 'schedule'
    const message = scheduled
      ? `Scheduled ${added.length} ${added.length === 1 ? 'item' : 'items'} for ${day.ymd}`
      : `Moved ${added.length} ${added.length === 1 ? 'item' : 'items'} to the day`
    const href = scheduled ? `/week/${Week.of(date)}` : undefined
    remember(id, { day: day.ymd, request, changes, added, removed, message, href })
    return c.json({ view: await options.view(day.ymd), undo: id, message, href })
  })

  app.post('/:ymd/item/undo', async (c) => {
    const body = await bodyOf(c)
    cleanup()
    const operation = typeof body?.id === 'string' ? operations.get(body.id) : undefined
    if (!operation || operation.day !== c.req.param('ymd')) throw new PlanningError('This undo has expired.', 404)
    const day = await dayFileOf(c, options, true)
    if (day instanceof Response) return day
    if (operation.undone) return c.json(await options.view(day.ymd))
    const changes: Change[] = []
    for (const change of operation.changes) {
      const current = await readOptional(change.file)
      if (current === undefined) throw new PlanningError('A file was removed. The move cannot be undone automatically.')
      let after = change.before
      if (current !== change.after) {
        after = current
        if (operation.added.some((item) => item.file === change.file)) {
          for (const item of operation.added.filter((item) => item.file === change.file)) {
            const list = DayDocument.fromMarkdown(after).lists.find((list) => list.title === item.list)
            if (!list?.items.includes(item.raw))
              throw new PlanningError('An added item changed. The move cannot be undone automatically.')
            const deletion = removePlanItem(after, item.list, item.raw)
            if (deletion.kind === 'missing') throw new PlanningError('An added item changed. Refresh the day.')
            after = deletion.content
          }
        } else {
          for (const item of operation.removed
            .filter((item) => item.file === change.file)
            .sort((a, b) => a.at - b.at)) {
            const original = moveItemMarkdown(item.raw, change.before!, change.file, change.file)
            if (original !== moveItemMarkdown(item.raw, current, change.file, change.file))
              throw new PlanningError('A source link changed. Open the source before undoing.')
            const restored = restorePlanItem(after, item.list, item.raw, item.at)
            if (restored.kind === 'missing')
              throw new PlanningError('A source list changed. The move cannot be undone automatically.')
            if (restored.kind === 'written') after = restored.content
          }
        }
      }
      changes.push({ file: change.file, before: current, after })
    }
    // Restore sources before removing the day's copies.
    await writeChanges(changes.reverse(), options.writePlanning)
    operation.undone = true
    return c.json(await options.view(day.ymd))
  })
  return app
}
