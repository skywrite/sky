/**
 * The day view's writes to one list item: the checkbox that strikes or
 * un-strikes it, the × (or the phone's swipe) that takes it out, and the
 * Undo that puts it back. Each answers with the fresh view so the page
 * renders what the file now says. The edits are the Day model's, beside
 * `isItemDone`: completion changes one line, then groups finished tasks first.
 * Reordering carries whole task blocks; the rest of the file stays intact.
 */

import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { Hono, type MiddlewareHandler } from 'hono'
import { hash, withLock } from '#lib/outbox/files.ts'
import { writeTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { createEditingRoutes } from './editing.ts'
import { bodyOf, dayFileOf, type ItemRoutesOptions } from './itemContext.ts'
import { orderPlanList } from './order.ts'
import { createPlanningRoutes } from './planning.ts'

type ItemAddress = Record<string, unknown> & { list: string; raw: string }

function isItemAddress(body: Record<string, unknown> | null): body is ItemAddress {
  return body !== null && typeof body.list === 'string' && typeof body.raw === 'string'
}

export function createItemRoutes(options: ItemRoutesOptions): Hono {
  const app = new Hono()
  const guard: MiddlewareHandler = async (c, next) => {
    if (c.req.method !== 'POST' || !/\/item(?:\/(?:delete|restore|add|pull|undo|edit(?:\/undo)?))?$/.test(c.req.path))
      return next()
    const origin = c.req.header('Origin')
    if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('Sec-Fetch-Site') === 'cross-site')
      return c.json({ error: 'Open the day from the Sky app.' }, 403)
    if (!c.req.header('Content-Type')?.startsWith('application/json'))
      return c.json({ error: 'Expected a JSON request.' }, 400)
    const stateDir = options.stateDir ?? path.join(tmpdir(), `sky-day-${hash(options.timeDir)}`)
    // Next lists are shared across days; keep these locks outside the synced notebook.
    await withLock(path.join(stateDir, 'planning.lock'), next)
  }
  app.use('*', guard)

  // The checkbox: mark one item done (strike) or not (un-strike).
  app.post('/:ymd/item', async (c) => {
    const body = await bodyOf(c)
    if (!isItemAddress(body) || typeof body.done !== 'boolean')
      return c.json({ error: 'expected {list, raw, done}' }, 400)
    const day = await dayFileOf(c, options)
    if (day instanceof Response) return day
    const result = DayDocument.toggleItem(day.content, body.list, body.raw, body.done)
    if (result.kind === 'missing') return c.json({ error: 'no such item — the day changed under the view' }, 404)
    const content = orderPlanList(result.kind === 'written' ? result.content : day.content, body.list)
    if (content !== day.content) await writeTextFile(day.file, content)
    return c.json(await options.view(day.ymd))
  })

  // The × on a row, or a swipe on the phone: the item leaves the day file.
  // The answer carries where it was, so Undo can put it back there.
  app.post('/:ymd/item/delete', async (c) => {
    const body = await bodyOf(c)
    if (!isItemAddress(body)) return c.json({ error: 'expected {list, raw}' }, 400)
    const day = await dayFileOf(c, options)
    if (day instanceof Response) return day
    const result = DayDocument.deleteItem(day.content, body.list, body.raw)
    if (result.kind === 'missing') return c.json({ error: 'no such item — the day changed under the view' }, 404)
    await writeTextFile(day.file, result.content)
    return c.json({ at: result.at, view: await options.view(day.ymd) })
  })

  // Undo of a delete: the item goes back at the place the delete reported.
  app.post('/:ymd/item/restore', async (c) => {
    const body = await bodyOf(c)
    if (!isItemAddress(body) || typeof body.at !== 'number' || !Number.isInteger(body.at) || body.at < 0) {
      return c.json({ error: 'expected {list, raw, at}' }, 400)
    }
    const day = await dayFileOf(c, options)
    if (day instanceof Response) return day
    const result = DayDocument.restoreItem(day.content, body.list, body.raw, body.at)
    if (result.kind === 'missing') return c.json({ error: 'no such list — the day changed under the view' }, 404)
    const content = orderPlanList(result.kind === 'written' ? result.content : day.content, body.list)
    if (content !== day.content) await writeTextFile(day.file, content)
    return c.json(await options.view(day.ymd))
  })

  app.route('/', createPlanningRoutes(options))
  app.route('/', createEditingRoutes(options))
  return app
}
