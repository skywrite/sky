import * as path from 'node:path'
import type { Context } from 'hono'
import type { WorkstreamStore } from '#lib/workstreams/store.ts'
import { exists, readTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { dayEnd } from './ended.ts'
import isDay from './isDay.ts'
import type { DayView } from './mod.ts'

export interface ItemRoutesOptions {
  /** Notebook time root — where the day files are */
  timeDir: string
  /** The view to answer with once the file is written */
  view: (ymd: string) => Promise<DayView>
  workstreams?: WorkstreamStore
  markdownBaseDir: string
  stateDir?: string
  today: () => PlainDate
  /** Test seam for a failed multi-file write. */
  writePlanning?: (file: string, content: string) => Promise<void>
}

/** The day file the request addresses, read — or the refusal to send instead. */
export async function dayFileOf(
  c: Context,
  options: ItemRoutesOptions,
  allowMissing = false,
): Promise<{ ymd: string; file: string; content: string; exists: boolean } | Response> {
  const ymd = c.req.param('ymd') ?? ''
  if (!isDay(ymd)) return c.json({ error: `not a day: ${ymd}` }, 404)
  const file = path.join(options.timeDir, dayFile(new PlainDate(ymd)))
  const present = await exists(file)
  if (!present && (!allowMissing || ymd < options.today().ymd)) return c.json({ error: `no day file for ${ymd}` }, 404)
  const content = present ? await readTextFile(file) : DayDocument.createFutureDay(new PlainDate(ymd)).toMarkdown()
  if (dayEnd(DayDocument.fromMarkdown(content)).ended) {
    return c.json({ error: 'This day has ended. Tasks are read-only.', view: await options.view(ymd) }, 409)
  }
  return { ymd, file, content, exists: present }
}

/** The body as an object, or null when it is not one. */
export async function bodyOf(c: Context): Promise<Record<string, unknown> | null> {
  const body = (await c.req.json().catch(() => null)) as unknown
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
}
