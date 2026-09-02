/**
 * The day's files: what sits in the day's attachments directory, and the
 * drop that keeps a file there. A browser drop carries bytes, never the
 * path, so keeping starts with a look for the original on this Mac from
 * the name, size and modified time the drop does carry. Found, the file
 * moves and nothing uploads. Not found, the bytes upload and a copy lands.
 * Either way the directory is the record: nothing is written into the
 * notebook, the same as the desktop sweep.
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Hono } from 'hono'
import { copyFileDedup } from '#lib/notebook/attachments.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import {
  cleanName,
  createKeeper,
  factsOf,
  kindOf,
  listFiles,
  type ListedFile,
  moveFile,
  moveRequestOf,
} from '../attachments/keep.ts'
import isDay from './isDay.ts'

export interface DayFilesOptions {
  /** The user-data directory; a day's files live under `attachments/YYYY/MM/DD` in it */
  userDataDir: string
  /** Where a dropped file most likely came from, checked before Spotlight — the Desktop and Downloads */
  searchDirs?: string[]
  /** Ask Spotlight for the name anywhere else; on by default on a Mac */
  spotlight?: boolean
  /** Where a removed file goes — the Mac's Trash by default */
  trashDir?: string
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.caf': 'audio/x-caf',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json',
  '.zip': 'application/zip',
}

function contentTypeOf(name: string): string {
  return CONTENT_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream'
}

/** The directory a day's files live in. */
export function dayFilesDir(userDataDir: string, ymd: string): string {
  return path.join(userDataDir, 'attachments', dayAttachmentsDir(new PlainDate(ymd)))
}

async function describe(dir: string, name: string): Promise<ListedFile> {
  const info = await stat(path.join(dir, name))
  return { name, size: info.size, modified: info.mtime.toISOString(), kind: kindOf(name) }
}

export function createDayFilesRoutes(options: DayFilesOptions): Hono {
  const home = os.homedir()
  const trashDir =
    options.trashDir ??
    (process.platform === 'darwin' ? path.join(home, '.Trash') : path.join(options.userDataDir, 'trash'))
  const keeper = createKeeper({ searchDirs: options.searchDirs, spotlight: options.spotlight })
  const app = new Hono()

  const badDay = (c: { json: (body: unknown, status: 404) => Response }, ymd: string) =>
    c.json({ message: `not a day: ${ymd}` }, 404)

  app.get('/:ymd/files', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return badDay(c, ymd)
    return c.json({ files: await listFiles(dayFilesDir(options.userDataDir, ymd)) })
  })

  // The file itself, inline: a PDF or an image opens in the tab, anything else downloads.
  app.get('/:ymd/files/:name', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return badDay(c, ymd)
    const name = cleanName(c.req.param('name'))
    if (!name) return c.json({ message: 'not a file name' }, 400)
    try {
      const data = await readFile(path.join(dayFilesDir(options.userDataDir, ymd), name))
      return c.body(data, 200, {
        'content-type': contentTypeOf(name),
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
        'cache-control': 'no-cache',
      })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return c.json({ message: 'no such file' }, 404)
      return c.json({ message: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // The bytes, when the original is nowhere on this Mac: a copy lands, deduplicated by content.
  app.put('/:ymd/files', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return badDay(c, ymd)
    const name = cleanName(c.req.query('name'))
    if (!name) return c.json({ message: 'a file name is required' }, 400)
    const data = new Uint8Array(await c.req.arrayBuffer())
    if (data.byteLength === 0) return c.json({ message: 'the file is empty' }, 400)
    const dir = dayFilesDir(options.userDataDir, ymd)
    const stagingDir = path.join(options.userDataDir, 'tmp')
    await mkdir(dir, { recursive: true })
    await mkdir(stagingDir, { recursive: true })
    const staging = path.join(stagingDir, `keep-${randomUUID()}`)
    try {
      await writeFile(staging, data)
      const file = await copyFileDedup(staging, dir, name)
      if (!file) return c.json({ message: 'the file could not be staged' }, 500)
      return c.json({ file: await describe(dir, file) })
    } finally {
      await rm(staging, { force: true })
    }
  })

  // Where the original is, from the three facts a drop carries.
  app.post('/:ymd/files/locate', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return badDay(c, ymd)
    const facts = factsOf(await c.req.json().catch(() => null))
    if (!facts) return c.json({ message: 'expected {name, size, lastModified}' }, 400)
    return c.json(await keeper.locate(dayFilesDir(options.userDataDir, ymd), facts))
  })

  // The move: only a file the look found, still as the look saw it.
  app.post('/:ymd/files/move', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return badDay(c, ymd)
    const request = moveRequestOf(await c.req.json().catch(() => null))
    if (!request) return c.json({ message: 'a file name is required' }, 400)
    const dir = dayFilesDir(options.userDataDir, ymd)
    const moved = await keeper.move(dir, request)
    if ('refused' in moved) return c.json({ message: moved.refused }, 409)
    return c.json({ file: await describe(dir, moved.name), moveId: moved.moveId, from: moved.from })
  })

  // Back where it came from, while the toast is still up.
  app.post('/:ymd/files/undo', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    const moveId = typeof body?.moveId === 'string' ? body.moveId : ''
    const undone = await keeper.undo(moveId)
    if (undone === 'nothing') return c.json({ message: 'nothing to undo' }, 404)
    if (undone === 'moved-on') return c.json({ message: 'the file has moved on' }, 409)
    return c.json({ ok: true })
  })

  // Out of the day and into the Trash, where it can still be put back by hand.
  app.post('/:ymd/files/remove', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return badDay(c, ymd)
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    const name = cleanName(body?.name)
    if (!name) return c.json({ message: 'a file name is required' }, 400)
    const source = path.join(dayFilesDir(options.userDataDir, ymd), name)
    if (!existsSync(source)) return c.json({ message: 'no such file' }, 404)
    await mkdir(trashDir, { recursive: true })
    const ext = path.extname(name)
    const stem = name.slice(0, name.length - ext.length)
    let target = path.join(trashDir, name)
    if (existsSync(target)) target = path.join(trashDir, `${stem}_${Date.now()}${ext}`)
    await moveFile(source, target)
    return c.json({ ok: true })
  })

  return app
}
