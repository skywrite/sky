/**
 * Delete, from the ⋯ menu of a file open in the explorer. The file leaves for
 * the Trash the way a day's file does, and the day it was captured under lets
 * go of the line that pointed at it — `- 09:15 > Notes -> [Title](notes/x.md)`
 * is how every capture puts itself on its day — so no day keeps a link to
 * nothing. Undo, while the toast holds it, brings the file back and puts the
 * line where it was.
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import * as path from 'node:path'
import { Hono } from 'hono'
import { blockRaw, insertBlock, ItemEditError, planSections, removeBlock } from '#lib/nbfs/listBlocks.ts'
import { withLock } from '#lib/outbox/files.ts'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import type { Link } from '#shared/models/Markdown/Link/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { dayDir, dayFile } from '#shared/nbfs/mod.ts'
import parseTimePath from '#shared/nbfs/parseTimePath.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { defaultTrashDir, moveFile, sweep, trashFile } from '../attachments/keep.ts'
import { formatDateLabel } from '../home/today.ts'
import { resolveMarkdownPreviewRequest, toNotebookRelativePath } from '../markdown-preview/request.ts'
import type { ExplorerRoutesOptions } from './mod.ts'

export interface ExplorerRemoveOptions {
  /** The user-data directory; off a Mac the Trash's stand-in lives under it */
  userDataDir: string
  /** Notebook time root — the day files, one of which may list the file; without it no day line is touched */
  timeDir?: string
  /** Where a deleted file goes — the Mac's Trash by default */
  trashDir?: string
  /** The day page's lock directory, so a day write here and one from the page never overlap; without it the write is unlocked */
  lockDir?: string
}

/** What the delete answers: the handle that undoes it, and the day that let go of its line, when one did. */
export interface RemoveAnswer {
  ok: true
  moveId: string
  day: { ymd: string; label: string; lines: number } | null
}

/** A line of the day that pointed at the file, as it stood: its list, its whole block, and its place among the list's rows. */
export interface RemovedLine {
  list: string
  block: string
  index: number
}

interface Removal {
  file: string
  trashed: string
  day: { file: string; ymd: string; lines: RemovedLine[] } | null
  expires: number
}

/** The day a file sits under: its date, its own file, and its directory as a link from the day file is written. */
interface Day {
  ymd: string
  date: PlainDate
  file: string
  dirRel: string
}

/** How long a delete can be undone — well past the toast, in case the page is slow to ask. */
const TTL_MS = 10 * 60 * 1000

/** `[label](target)` or `[label](<target with spaces> "title")` — the target is what matters. */
const INLINE_LINK = /\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g

/** The day a file was captured under, from its path — none for a file outside the days, or for the day's own file. */
function dayOf(relativePath: string, base: string, timeDir: string): Day | null {
  const time = parseTimePath(relativePath)
  if (time?.kind !== 'day') return null
  const file = path.join(timeDir, dayFile(time.date))
  if (path.resolve(base, relativePath) === path.resolve(file)) return null
  const dirRel = toNotebookRelativePath(base, path.join(timeDir, dayDir(time.date)))
  return { ymd: time.date.ymd, date: time.date, file, dirRel }
}

/** The targets a row's own line links to — inline links, and reference links through the file's definitions. */
function targetsOf(raw: string, definitions: Map<string, Link>): string[] {
  const targets = [...raw.matchAll(INLINE_LINK)].map((match) => match[1])
  for (const label of Document.extractReferenceLabels(raw)) {
    const link = definitions.get(label) ?? definitions.get(label.toLowerCase())
    if (link) targets.push(link.href)
  }
  return targets
}

/** Whether a link target, written from the day's directory, names the file — as written, or percent-encoded. */
function namesFile(target: string, dayDirRel: string, file: string): boolean {
  let written = target.trim()
  if (written.startsWith('<') && written.endsWith('>')) written = written.slice(1, -1)
  written = written.replace(/#.*$/, '')
  if (!written || written.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(written)) return false
  const forms = new Set([written])
  try {
    forms.add(decodeURIComponent(written))
  } catch {
    // Not percent-encoded; the written form is the only one.
  }
  for (const form of forms) if (path.posix.normalize(path.posix.join(dayDirRel, form)) === file) return true
  return false
}

/**
 * The day's rows whose own line links to the file. A link in a note nested
 * under a task never takes the task away: only the line that is about the
 * file goes with it.
 */
export function rowsLinkingTo(content: string, dayDirRel: string, file: string): RemovedLine[] {
  const definitions = Document.fromMarkdown(content).links
  const rows: RemovedLine[] = []
  for (const section of planSections(content)) {
    section.rows.forEach((row, index) => {
      if (targetsOf(row.raw, definitions).some((target) => namesFile(target, dayDirRel, file)))
        rows.push({ list: section.title, block: row.block, index })
    })
  }
  return rows
}

/** The day file without the lines that pointed at the file; what left, so Undo can put it back. */
async function takeOffDay(day: Day, file: string): Promise<RemovedLine[]> {
  if (!(await exists(day.file))) return []
  const before = await readTextFile(day.file)
  let after = before
  const removed: RemovedLine[] = []
  for (const row of rowsLinkingTo(before, day.dirRel, file)) {
    try {
      after = removeBlock(after, row.list, blockRaw(row.block))
      removed.push(row)
    } catch (err) {
      // Two lines the same: neither can be told from the other, so both stay for the person to sort out.
      if (!(err instanceof ItemEditError)) throw err
    }
  }
  if (after !== before) await writeTextFile(day.file, after)
  return removed
}

/** The lines back on the day, each where it was — or last, when the list has moved on. */
async function putBackOnDay(day: { file: string; lines: RemovedLine[] }): Promise<void> {
  if (!(await exists(day.file))) return
  const before = await readTextFile(day.file)
  let after = before
  for (const line of [...day.lines].sort((a, b) => a.index - b.index)) {
    try {
      after = insertBlock(after, line.list, line.block, line.index)
    } catch (err) {
      // Already there — a hand edit put it back first.
      if (!(err instanceof ItemEditError)) throw err
    }
  }
  if (after !== before) await writeTextFile(day.file, after)
}

export function createRemoveRoutes(options: ExplorerRoutesOptions, remove: ExplorerRemoveOptions): Hono {
  const base = path.resolve(options.markdownBaseDir)
  const trashDir = remove.trashDir ?? defaultTrashDir(remove.userDataDir)
  const moves = new Map<string, Removal>()
  const app = new Hono()

  const locked = <T>(ymd: string, run: () => Promise<T>): Promise<T> =>
    remove.lockDir ? withLock(path.join(remove.lockDir, `day-${ymd}.lock`), run) : run()

  // POST /remove {path} → the file to the Trash, its line off its day; the answer's moveId undoes both.
  app.post('/remove', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    const param = typeof body?.path === 'string' ? body.path : ''
    const request = resolveMarkdownPreviewRequest(param, undefined, options.markdownBaseDir, options.markdownDirs)
    if (!request.ok) return c.json({ message: request.message }, request.status)
    const { filePath, relativePath } = request.value
    const info = await stat(filePath).catch(() => null)
    if (!info?.isFile()) return c.json({ message: `no file at ${relativePath}` }, 404)
    const day = remove.timeDir ? dayOf(relativePath, base, remove.timeDir) : null
    const trashed = await trashFile(filePath, trashDir)
    let lines: RemovedLine[] = []
    if (day) {
      try {
        lines = await locked(day.ymd, () => takeOffDay(day, relativePath))
      } catch (err) {
        // The day would not change, so the file comes back: nothing half-done.
        await moveFile(trashed, filePath).catch(() => {})
        return c.json({ message: err instanceof Error ? err.message : String(err) }, 500)
      }
    }
    const moveId = randomUUID()
    sweep(moves)
    const gone = day && lines.length > 0 ? { file: day.file, ymd: day.ymd, lines } : null
    moves.set(moveId, { file: filePath, trashed, day: gone, expires: Date.now() + TTL_MS })
    const answer: RemoveAnswer = {
      ok: true,
      moveId,
      day: day && lines.length > 0 ? { ymd: day.ymd, label: formatDateLabel(day.date), lines: lines.length } : null,
    }
    return c.json(answer)
  })

  // POST /undo {moveId} → the file back where it was, and its line back on the day, while the delete is fresh.
  app.post('/undo', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    const moveId = typeof body?.moveId === 'string' ? body.moveId : ''
    sweep(moves)
    const move = moves.get(moveId)
    if (!move) return c.json({ message: 'nothing to undo' }, 404)
    if (!existsSync(move.trashed) || existsSync(move.file)) return c.json({ message: 'the file has moved on' }, 409)
    await moveFile(move.trashed, move.file)
    moves.delete(moveId)
    const { day } = move
    if (day) await locked(day.ymd, () => putBackOnDay(day))
    return c.json({ ok: true })
  })

  return app
}
