/**
 * The day's files: what sits in the day's attachments directory, folders
 * and all, and the drop that keeps a file there. A browser drop carries
 * bytes, never the path, so keeping starts with a look for the original on
 * this Mac from the name, size and modified time the drop does carry.
 * Found, the file moves and nothing uploads. Not found, the bytes upload and
 * a copy lands. Either way the directory is the record: nothing is written
 * into the notebook, the same as the desktop sweep. A file or a whole folder
 * leaves for the Mac's Trash, and comes back while its toast still holds Undo.
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Hono } from 'hono'
import { copyFileDedup } from '#lib/notebook/attachments.ts'
import { runCommand } from '#lib/sys/mod.ts'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import {
  cleanName,
  cleanRelativePath,
  createKeeper,
  factsOf,
  kindOf,
  type ListedFile,
  type ListedFolder,
  listFolder,
  measureFolder,
  moveFile,
  moveRequestOf,
} from '../attachments/keep.ts'
import { formatDateLabel } from '../home/today.ts'
import isDay from './isDay.ts'

export interface DayFilesOptions {
  /** The user-data directory; a day's files live under `attachments/YYYY/MM/DD` in it */
  userDataDir: string
  /** Notebook time root — the day's notes, read for which of them lists a file; without it no file is marked */
  timeDir?: string
  /** The notebook root a note's path is given relative to, with `timeDir` */
  markdownBaseDir?: string
  /** Where a dropped file most likely came from, checked before Spotlight — the Desktop and Downloads */
  searchDirs?: string[]
  /** Ask Spotlight for the name anywhere else; on by default on a Mac */
  spotlight?: boolean
  /** Where a removed file goes — the Mac's Trash by default */
  trashDir?: string
  /** Shows a folder, or a file selected in its folder, in the Finder; `open` by default. A test records the calls instead */
  reveal?: (target: string, kind: 'file' | 'folder') => Promise<void>
}

/** The note that lists a file in its `attachments:` — where the file belongs, as the page says it. */
export interface ListedBy {
  /** Relative to the notebook root */
  path: string
  title: string
}

export type DayFile = ListedFile & { listedBy?: ListedBy }

/** What the page lists: the day's files, or one folder inside them. */
export interface DayListing {
  /** The folder inside the day's files, '' for the day itself */
  path: string
  /** The day, as its page titles it */
  label: string
  folders: ListedFolder[]
  files: DayFile[]
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

/** The Finder, on the folder — or on the file, selected in its folder. */
async function openInFinder(target: string, kind: 'file' | 'folder'): Promise<void> {
  const run = await runCommand('open', kind === 'file' ? ['-R', target] : [target])
  if (!run.success) throw new Error(run.stderr.trim() || 'the Finder did not open')
}

/** The directory a day's files live in. */
export function dayFilesDir(userDataDir: string, ymd: string): string {
  return path.join(userDataDir, 'attachments', dayAttachmentsDir(new PlainDate(ymd)))
}

async function describe(dir: string, name: string): Promise<ListedFile> {
  const info = await stat(path.join(dir, name))
  return { name, size: info.size, modified: info.mtime.toISOString(), kind: kindOf(name) }
}

/** The path a file route names, after `/files/`, decoded segment by segment; '' when there is none or it is malformed. */
export function fileRouteOf(url: string, ymd: string): string {
  const pathname = new URL(url).pathname
  const marker = `/${ymd}/files/`
  const at = pathname.indexOf(marker)
  if (at < 0) return ''
  try {
    return pathname
      .slice(at + marker.length)
      .split('/')
      .map(decodeURIComponent)
      .join('/')
  } catch {
    return ''
  }
}

/** What to call a note: its `title:`, else its first heading, else its name read as words. */
export function noteTitle(yaml: Record<string, unknown>, text: string, file: string): string {
  const title = yaml.title
  if (typeof title === 'string' && title.trim().length > 0) return title.trim()
  const heading = /^#\s+(.+?)\s*$/m.exec(text)
  if (heading?.[1]) return heading[1]
  return path
    .basename(file, '.md')
    .split('_')
    .map((part) => part.replace(/-/g, ' ').trim())
    .filter((part) => part.length > 0)
    .join(' · ')
}

/**
 * Which note lists each file, by name: the day's notes read for their
 * `attachments:`, the first note to name a file keeping it. Empty when the
 * routes were given no notebook, or the day has no notes yet.
 */
async function listedByName(options: DayFilesOptions, day: PlainDate): Promise<Map<string, ListedBy>> {
  const marks = new Map<string, ListedBy>()
  if (!options.timeDir || !options.markdownBaseDir) return marks
  const dayPath = path.join(options.timeDir, dayDir(day))
  if (!existsSync(dayPath)) return marks
  for await (const entry of walk(dayPath, { exts: ['.md'] })) {
    if (!entry.isFile) continue
    try {
      const text = await readTextFile(entry.path)
      const doc = Document.fromMarkdown(text)
      if (doc.attachments.length === 0) continue
      const mark = {
        path: path.relative(options.markdownBaseDir, entry.path),
        title: noteTitle(doc.yaml, text, entry.path),
      }
      for (const attachment of doc.attachments) if (!marks.has(attachment.file)) marks.set(attachment.file, mark)
    } catch {
      // A note that does not parse lists nothing.
    }
  }
  return marks
}

export function createDayFilesRoutes(options: DayFilesOptions): Hono {
  const home = os.homedir()
  const trashDir =
    options.trashDir ??
    (process.platform === 'darwin' ? path.join(home, '.Trash') : path.join(options.userDataDir, 'trash'))
  const keeper = createKeeper({ searchDirs: options.searchDirs, spotlight: options.spotlight })
  const reveal = options.reveal ?? openInFinder
  const app = new Hono()

  const badDay = (c: { json: (body: unknown, status: 404) => Response }, ymd: string) =>
    c.json({ message: `not a day: ${ymd}` }, 404)
  const dirOf = (ymd: string) => dayFilesDir(options.userDataDir, ymd)

  // The day's folders and files — the day's own, or one folder inside it (`?dir=photos`).
  app.get('/:ymd/files', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return badDay(c, ymd)
    const folder = cleanRelativePath(c.req.query('dir') ?? '')
    if (folder === null) return c.json({ message: 'not a folder path' }, 400)
    const dir = path.join(dirOf(ymd), folder)
    if (folder.length > 0) {
      const info = await stat(dir).catch(() => null)
      if (!info?.isDirectory()) return c.json({ message: 'no such folder' }, 404)
    }
    const day = new PlainDate(ymd)
    const [listing, marks] = await Promise.all([listFolder(dir), listedByName(options, day)])
    const files: DayFile[] = listing.files.map((file) => {
      const listedBy = marks.get(file.name)
      return listedBy ? { ...file, listedBy } : file
    })
    const answer: DayListing = { path: folder, label: formatDateLabel(day), folders: listing.folders, files }
    return c.json(answer)
  })

  // The file itself, inline, from the day or a folder inside it: a PDF or an image opens in the tab, anything else downloads.
  app.get('/:ymd/files/*', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return badDay(c, ymd)
    const rel = cleanRelativePath(fileRouteOf(c.req.url, ymd))
    if (!rel) return c.json({ message: 'not a file name' }, 400)
    const file = path.join(dirOf(ymd), rel)
    try {
      if (!(await stat(file)).isFile()) return c.json({ message: 'not a file' }, 404)
      const data = await readFile(file)
      const name = path.basename(rel)
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
    const dir = dirOf(ymd)
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
    return c.json(await keeper.locate(dirOf(ymd), facts))
  })

  // The move: only a file the look found, still as the look saw it.
  app.post('/:ymd/files/move', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return badDay(c, ymd)
    const request = moveRequestOf(await c.req.json().catch(() => null))
    if (!request) return c.json({ message: 'a file name is required' }, 400)
    const dir = dirOf(ymd)
    const moved = await keeper.move(dir, request)
    if ('refused' in moved) return c.json({ message: moved.refused }, 409)
    return c.json({ file: await describe(dir, moved.name), moveId: moved.moveId, from: moved.from })
  })

  // Back where it came from — off the desktop, or out of the Trash — while the toast is still up.
  app.post('/:ymd/files/undo', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    const moveId = typeof body?.moveId === 'string' ? body.moveId : ''
    const undone = await keeper.undo(moveId)
    if (undone === 'nothing') return c.json({ message: 'nothing to undo' }, 404)
    if (undone === 'moved-on') return c.json({ message: 'the file has moved on' }, 409)
    return c.json({ ok: true })
  })

  // Out of the day and into the Trash — a file, or a folder whole — where it can still be put back by hand; the answer's moveId undoes it.
  app.post('/:ymd/files/remove', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return badDay(c, ymd)
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    const rel = cleanRelativePath(body?.path ?? body?.name)
    if (!rel) return c.json({ message: 'a file or folder path is required' }, 400)
    const source = path.join(dirOf(ymd), rel)
    const info = await stat(source).catch(() => null)
    if (!info) return c.json({ message: 'no such file' }, 404)
    const folder = info.isDirectory()
    const files = folder ? (await measureFolder(source)).files : 1
    await mkdir(trashDir, { recursive: true })
    const name = path.basename(rel)
    const ext = folder ? '' : path.extname(name)
    const stem = name.slice(0, name.length - ext.length)
    let target = path.join(trashDir, name)
    if (existsSync(target)) target = path.join(trashDir, `${stem}_${Date.now()}${ext}`)
    await moveFile(source, target)
    return c.json({ ok: true, moveId: keeper.remember(source, target), folder, files })
  })

  // The Finder, on the day's folder or one inside it — a file is shown selected. The day's folder is made if it is not there yet.
  app.post('/:ymd/files/reveal', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return badDay(c, ymd)
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    const rel = cleanRelativePath(body?.path ?? '')
    if (rel === null) return c.json({ message: 'not a path inside the day' }, 400)
    const target = path.join(dirOf(ymd), rel)
    if (rel.length === 0) await mkdir(target, { recursive: true })
    const info = await stat(target).catch(() => null)
    if (!info) return c.json({ message: 'no such file' }, 404)
    try {
      await reveal(target, info.isDirectory() ? 'folder' : 'file')
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : String(err) }, 500)
    }
    return c.json({ ok: true })
  })

  return app
}
