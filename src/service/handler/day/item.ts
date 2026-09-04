/**
 * The day view's writes to one list item: the checkbox that strikes or
 * un-strikes it, the × (or the phone's swipe) that takes it out, and the
 * Undo that puts it back. Each answers with the fresh view so the page
 * renders what the file now says. The edits are the Day model's, beside
 * `isItemDone`: a line in the day file changes, every other byte stays.
 */

import * as path from 'node:path'
import { type Context, Hono } from 'hono'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import isDay from './isDay.ts'
import type { DayView } from './mod.ts'

export interface ItemRoutesOptions {
  /** Notebook time root — where the day files are */
  timeDir: string
  /** The view to answer with once the file is written */
  view: (ymd: string) => Promise<DayView>
}

/** The day file the request addresses, read — or the refusal to send instead. */
async function dayFileOf(
  c: Context,
  timeDir: string,
): Promise<{ ymd: string; file: string; content: string } | Response> {
  const ymd = c.req.param('ymd') ?? ''
  if (!isDay(ymd)) return c.json({ error: `not a day: ${ymd}` }, 404)
  const file = path.join(timeDir, dayFile(new PlainDate(ymd)))
  if (!(await exists(file))) return c.json({ error: `no day file for ${ymd}` }, 404)
  return { ymd, file, content: await readTextFile(file) }
}

/** The body as an object, or null when it is not one. */
async function bodyOf(c: Context): Promise<Record<string, unknown> | null> {
  const body = (await c.req.json().catch(() => null)) as unknown
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
}

type ItemAddress = Record<string, unknown> & { list: string; raw: string }

function isItemAddress(body: Record<string, unknown> | null): body is ItemAddress {
  return body !== null && typeof body.list === 'string' && typeof body.raw === 'string'
}

export function createItemRoutes(options: ItemRoutesOptions): Hono {
  const app = new Hono()

  // The checkbox: mark one item done (strike) or not (un-strike).
  app.post('/:ymd/item', async (c) => {
    const body = await bodyOf(c)
    if (!isItemAddress(body) || typeof body.done !== 'boolean')
      return c.json({ error: 'expected {list, raw, done}' }, 400)
    const day = await dayFileOf(c, options.timeDir)
    if (day instanceof Response) return day
    const result = DayDocument.toggleItem(day.content, body.list, body.raw, body.done)
    if (result.kind === 'missing') return c.json({ error: 'no such item — the day changed under the view' }, 404)
    if (result.kind === 'written') await writeTextFile(day.file, result.content)
    return c.json(await options.view(day.ymd))
  })

  // The × on a row, or a swipe on the phone: the item leaves the day file.
  // The answer carries where it was, so Undo can put it back there.
  app.post('/:ymd/item/delete', async (c) => {
    const body = await bodyOf(c)
    if (!isItemAddress(body)) return c.json({ error: 'expected {list, raw}' }, 400)
    const day = await dayFileOf(c, options.timeDir)
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
    const day = await dayFileOf(c, options.timeDir)
    if (day instanceof Response) return day
    const result = DayDocument.restoreItem(day.content, body.list, body.raw, body.at)
    if (result.kind === 'missing') return c.json({ error: 'no such list — the day changed under the view' }, 404)
    if (result.kind === 'written') await writeTextFile(day.file, result.content)
    return c.json(await options.view(day.ymd))
  })

  return app
}
