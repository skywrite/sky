/**
 * Keeping a dropped file beside what it belongs to. A browser drop carries
 * bytes, a name, a size and a modified time — never a path — so keeping
 * starts with a look for the original on this Mac from those three facts.
 * Found, the file moves in and nothing uploads; not found, the caller stores
 * the bytes as a copy. A look is remembered for a while under a token, so
 * only a file the look found ever moves, and a fresh move can be undone
 * while its toast is still up. The day's files and a document's attachments
 * share this; each names the directory a file lands in.
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, rename, stat, unlink } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { sha256File } from '#lib/notebook/attachments.ts'
import { type FileFacts, type Located, locateFile, matchesFacts } from '#lib/sys/locateFile.ts'
import { safeAttachmentName } from './mod.ts'

export interface KeepOptions {
  /** Where a dropped file most likely came from, checked before Spotlight — the Desktop and Downloads */
  searchDirs?: string[]
  /** Ask Spotlight for the name anywhere else; on by default on a Mac */
  spotlight?: boolean
}

/** What the look for a dropped file's original found. */
export interface LocateAnswer {
  /** Names this look; a move must quote it, so only a located file ever moves */
  token: string
  /** The one file to move, when the look settled on one */
  match: Located | null
  /** Identical files in more than one place — the person picks which moves */
  ambiguous: Located[]
  /** The file already sits in the directory */
  already: boolean
}

export interface MoveRequest {
  token: string
  /** The located file, as the look named it */
  path: string
  /** The name it lands under */
  name: string
}

export interface Moved {
  /** The name the file carries in the end — `_2`-suffixed when a different file held the name */
  name: string
  /** Quotes this move to undo it, for a while */
  moveId: string
  from: Located
}

export type MoveAnswer = Moved | { refused: string }

export type UndoAnswer = 'ok' | 'nothing' | 'moved-on'

export interface Keeper {
  /** Where the original is, from the three facts a drop carries; `already` when it sits in `dir` */
  locate(dir: string, facts: FileFacts): Promise<LocateAnswer>
  /** The move into `dir`: only a file the look found, still as the look saw it */
  move(dir: string, request: MoveRequest): Promise<MoveAnswer>
  /** Back where it came from, while the move is fresh */
  undo(moveId: string): Promise<UndoAnswer>
}

export type FileKind = 'image' | 'audio' | 'video' | 'pdf' | 'text' | 'document' | 'archive' | 'file'

/** A file in a directory, as a page lists it. */
export interface ListedFile {
  name: string
  size: number
  /** ISO, the file's own modified time */
  modified: string
  kind: FileKind
}

const KINDS: Record<string, FileKind> = {
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.heic': 'image',
  '.svg': 'image',
  '.m4a': 'audio',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.aac': 'audio',
  '.ogg': 'audio',
  '.flac': 'audio',
  '.caf': 'audio',
  '.mp4': 'video',
  '.mov': 'video',
  '.webm': 'video',
  '.m4v': 'video',
  '.pdf': 'pdf',
  '.txt': 'text',
  '.md': 'text',
  '.vtt': 'text',
  '.srt': 'text',
  '.csv': 'text',
  '.json': 'text',
  '.doc': 'document',
  '.docx': 'document',
  '.pages': 'document',
  '.rtf': 'document',
  '.ppt': 'document',
  '.pptx': 'document',
  '.key': 'document',
  '.xls': 'document',
  '.xlsx': 'document',
  '.numbers': 'document',
  '.zip': 'archive',
  '.gz': 'archive',
  '.tar': 'archive',
  '.dmg': 'archive',
}

export function kindOf(name: string): FileKind {
  return KINDS[path.extname(name).toLowerCase()] ?? 'file'
}

/** The files of a directory by name, hidden ones left out; none when the directory is not there yet. */
export async function listFiles(dir: string): Promise<ListedFile[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const files: ListedFile[] = []
  for (const name of entries) {
    if (name.startsWith('.')) continue
    const info = await stat(path.join(dir, name)).catch(() => null)
    if (!info?.isFile()) continue
    files.push({ name, size: info.size, modified: info.mtime.toISOString(), kind: kindOf(name) })
  }
  return files.sort((a, b) => a.name.localeCompare(b.name))
}

const TTL_MS = 10 * 60 * 1000

interface Look {
  facts: FileFacts
  found: Located[]
  expires: number
}

interface Move {
  from: string
  to: string
  expires: number
}

function sweep<T extends { expires: number }>(map: Map<string, T>): void {
  const now = Date.now()
  for (const [key, value] of map) if (value.expires < now) map.delete(key)
}

/** The Desktop and Downloads: where a file dragged into the browser most often sits. */
export function defaultSearchDirs(): string[] {
  const home = os.homedir()
  return [path.join(home, 'Desktop'), path.join(home, 'Downloads')]
}

/** A name the routes accept: exactly what `safeAttachmentName` would keep, so no path ever hides in it. */
export function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const trimmed = name.trim()
  return trimmed.length > 0 && safeAttachmentName(trimmed) === trimmed && trimmed !== 'file' ? trimmed : null
}

/** The three facts a drop carries, out of a request body; null when any is missing or malformed. */
export function factsOf(body: unknown): FileFacts | null {
  const record = body as Record<string, unknown> | null
  const name = cleanName(record?.name)
  const size = typeof record?.size === 'number' && Number.isInteger(record.size) && record.size > 0 ? record.size : null
  const lastModified =
    typeof record?.lastModified === 'number' && Number.isFinite(record.lastModified) && record.lastModified > 0
      ? Math.floor(record.lastModified)
      : null
  if (!name || size === null || lastModified === null) return null
  return { name, size, lastModified }
}

/** A move request out of a request body; null without a clean name. */
export function moveRequestOf(body: unknown): MoveRequest | null {
  const record = body as Record<string, unknown> | null
  const name = cleanName(record?.name)
  if (!name) return null
  return {
    token: typeof record?.token === 'string' ? record.token : '',
    path: typeof record?.path === 'string' ? record.path : '',
    name,
  }
}

/** A rename, or a copy and delete when the two sit on different volumes. */
export async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await copyFile(from, to)
    await unlink(from)
  }
}

/**
 * Move a file into `dir` under `desired`, the way copies dedupe: an identical
 * file already there is simply replaced, so one copy remains; a different
 * file wanting the name pushes this one to `_2`, `_3`, … Returns the name
 * the file carries in the end.
 */
export async function placeFile(source: string, dir: string, desired: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const ext = path.extname(desired)
  const stem = desired.slice(0, desired.length - ext.length)
  let sourceHash: string | null = null
  let name = desired
  for (let counter = 2; ; counter++) {
    const target = path.join(dir, name)
    if (!existsSync(target)) break
    sourceHash ??= await sha256File(source)
    if ((await sha256File(target)) === sourceHash) break
    name = `${stem}_${counter}${ext}`
  }
  await moveFile(source, path.join(dir, name))
  return name
}

export function createKeeper(options: KeepOptions = {}): Keeper {
  const searchDirs = options.searchDirs ?? defaultSearchDirs()
  const spotlight = options.spotlight ?? process.platform === 'darwin'
  const looks = new Map<string, Look>()
  const moves = new Map<string, Move>()

  return {
    async locate(dir, facts) {
      const target = path.resolve(dir)
      const found = await locateFile(facts, { searchDirs, spotlight })
      const already = found.some((f) => path.dirname(f.path) === target)
      const elsewhere = found.filter((f) => path.dirname(f.path) !== target)
      const inSearchDirs = elsewhere.filter((f) => searchDirs.some((d) => path.dirname(f.path) === path.resolve(d)))
      // One in the likely folders outranks a Spotlight hit elsewhere; two in the likely folders is a question.
      const match =
        inSearchDirs.length === 1
          ? inSearchDirs[0]
          : inSearchDirs.length === 0 && elsewhere.length === 1
            ? elsewhere[0]
            : null
      const token = randomUUID()
      sweep(looks)
      looks.set(token, { facts, found: elsewhere, expires: Date.now() + TTL_MS })
      return { token, match: match ?? null, ambiguous: match ? [] : elsewhere, already }
    },

    async move(dir, request) {
      sweep(looks)
      const look = looks.get(request.token)
      const located = look?.found.find((f) => f.path === request.path)
      if (!look || !located) return { refused: 'that file was not located — drop it again' }
      if (!(await matchesFacts(request.path, look.facts))) return { refused: 'the file changed since it was located' }
      const name = await placeFile(request.path, dir, request.name)
      const moveId = randomUUID()
      sweep(moves)
      moves.set(moveId, { from: request.path, to: path.join(dir, name), expires: Date.now() + TTL_MS })
      return { name, moveId, from: located }
    },

    async undo(moveId) {
      sweep(moves)
      const move = moves.get(moveId)
      if (!move) return 'nothing'
      if (!existsSync(move.to) || existsSync(move.from)) return 'moved-on'
      await moveFile(move.to, move.from)
      moves.delete(moveId)
      return 'ok'
    },
  }
}
