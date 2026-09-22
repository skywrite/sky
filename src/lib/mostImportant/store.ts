import { readdir, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { Lexer, type Token, type Tokens } from 'marked'
import { createDayFile } from '#lib/nbfs/createDayFile.ts'
import { atomicWrite, hash, missing, notebookFile, readOptional, withLock } from '#lib/outbox/files.ts'
import slugify from '#lib/string/slugify.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { toSingleLine } from '#shared/models/MostImportant/frontmatter.ts'
import { dayDir, dayFile } from '#shared/nbfs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { miMarkdown } from './document.ts'
import { MI_FILE } from './paths.ts'
import { MostImportantError, type MIDraft } from './types.ts'

export interface MIStorage {
  timeDir: string
  /** Shared with the day page's planning writes. */
  stateDir: string
  /** Shared with CLI day writers and workstream projections, when available. */
  dayStateDir?: string
  write?: (file: string, content: string) => Promise<void>
}

export interface MISaved {
  /** Relative to the day's directory. */
  file: string
  count: number
}

interface SaveReceipt extends MISaved {
  fingerprint: string
  markdown: string
  linked: boolean
}

function receiptDirectory(storage: MIStorage, day: PlainDate): string {
  return path.join(storage.stateDir, 'most-important', day.ymd)
}

async function receipts(dir: string): Promise<SaveReceipt[]> {
  const names = await readdir(dir).catch((error: unknown) => {
    if (missing(error)) return [] as string[]
    throw error
  })
  return Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => JSON.parse((await readOptional(path.join(dir, name)))!) as SaveReceipt),
  )
}

const label = (value: string) => value.replace(/[\\[\]]/g, '\\$&')
const target = (value: string) => value.split(path.sep).map(encodeURIComponent).join('/')

async function records(dir: string): Promise<Array<{ name: string; doc: Document }>> {
  const names = await readdir(dir).catch((error: unknown) => {
    if (missing(error)) return [] as string[]
    throw error
  })
  const result: Array<{ name: string; doc: Document }> = []
  for (const name of names.filter((name) => MI_FILE.test(name))) {
    const file = await notebookFile(dir, name)
    const content = await readOptional(file)
    if (content !== undefined) result.push({ name, doc: Document.fromMarkdown(content) })
  }
  return result
}

/** Accepting a reviewed draft creates its file and day link once, including after a lost response. */
export async function saveMostImportant(
  storage: MIStorage,
  day: PlainDate,
  input: MIDraft,
  requestId: string,
  enrichment: { tags?: string; rel?: string[] } = {},
): Promise<MISaved> {
  const draft = { summary: toSingleLine(input.summary), dueBy: toSingleLine(input.dueBy), body: input.body.trim() }
  if (!draft.summary || !draft.body) throw new MostImportantError('Give the task a title and a description.', 400)
  const run = async (): Promise<MISaved> => {
    const file = path.join(storage.timeDir, dayFile(day))
    const before = await readOptional(file)
    const dayDoc = before === undefined ? DayDocument.createFutureDay(day) : DayDocument.fromMarkdown(before)
    const dir = path.join(storage.timeDir, dayDir(day), 'most-important')
    const items = await records(dir)
    const fingerprint = hash(JSON.stringify(draft))
    const receiptDir = receiptDirectory(storage, day)
    // This opaque key belongs to the save protocol, never to the notebook document.
    const receiptFile = path.join(receiptDir, `${hash(requestId)}.json`)
    const existing = await readOptional(receiptFile)
    let receipt: SaveReceipt | undefined = existing ? JSON.parse(existing) : undefined
    const remember = async (value: SaveReceipt) => atomicWrite(receiptFile, JSON.stringify(value))
    if (receipt && receipt.fingerprint !== fingerprint)
      throw new MostImportantError('This save was already used for a different draft. Review the saved task.')
    if (receipt?.linked) return { file: receipt.file, count: receipt.count }
    if (!receipt) {
      if (dayDoc.yaml['ended']) throw new MostImportantError('This day has ended. Choose an open day for this task.')
      const count =
        Math.max(
          items.length,
          ...items.map(({ name, doc }) => Number(/^MI(\d+)/i.exec(name)?.[1]) || Number(doc.yaml['mi']) || 0),
          ...(await receipts(receiptDir)).map((item) => item.count),
        ) + 1
      // The daily MI ordinal is the established identity shared with the day list.
      const slug = slugify(draft.summary, { suggestedLength: 40, preserveCase: true })
      receipt = {
        file: `most-important/MI${count}${slug ? `_${slug}` : ''}.md`,
        count,
        fingerprint,
        markdown: miMarkdown(draft, { rel: enrichment.rel ?? null, tags: enrichment.tags ?? null }),
        linked: false,
      }
      // Keep an unfinished save outside the notebook until its day link can be written.
      await remember(receipt)
    }
    const { file: relative, count, markdown } = receipt
    const absolute = path.join(storage.timeDir, dayDir(day), relative)
    // Check existing parents for symlinks even when the final file does not yet exist.
    await notebookFile(storage.timeDir, path.relative(storage.timeDir, absolute)).catch((error: unknown) => {
      if (!missing(error)) throw error
    })
    const published = await readOptional(absolute)
    if (published !== undefined) {
      // The process may have stopped after publication but before recording success.
      if (published !== markdown)
        throw new MostImportantError('The saved task has changed. Review it before trying to save again.')
      await remember({ ...receipt, linked: true })
      return { file: relative, count }
    }
    if (dayDoc.yaml['ended']) throw new MostImportantError('This day has ended. Choose an open day for this task.')
    const encoded = target(relative)
    const raw = `MI/${count} -> [${label(draft.summary)}](${encoded})`
    let after: string | undefined
    // A retry repairs an interrupted publication without adding another day row.
    if (!before?.includes(`](${encoded})`)) {
      if ((await readOptional(file)) !== before) throw new MostImportantError('The day changed. Try saving again.')
      after = dayDoc.addMostImportantItem(raw).toMarkdown()
      if (before === undefined) {
        if (!(await createDayFile(file, after))) throw new MostImportantError('The day changed. Try saving again.')
      } else await (storage.write ?? atomicWrite)(file, after)
    }
    try {
      if (!(await createDayFile(absolute, markdown)))
        throw new MostImportantError('A task with this filename already exists. Review it before saving again.')
    } catch (error) {
      // Do not leave a broken link after a failed publication or overwrite later day edits.
      if (after !== undefined && (await readOptional(file)) === after) {
        if (before === undefined) await unlink(file)
        else await atomicWrite(file, before)
      }
      throw error
    }
    await remember({ ...receipt, linked: true })
    return { file: relative, count }
  }
  return withLock(path.join(storage.stateDir, 'planning.lock'), () =>
    storage.dayStateDir ? withLock(path.join(storage.dayStateDir, `day-${day.ymd}.lock`), run) : run(),
  )
}

function firstLink(tokens: Token[]): Tokens.Link | undefined {
  for (const token of tokens) {
    if (token.type === 'link') return token as Tokens.Link
    if ('tokens' in token && Array.isArray(token.tokens)) {
      const link = firstLink(token.tokens)
      if (link) return link
    }
  }
  return undefined
}

/** Caller holds the day write lock. Return a conditional rollback if its day write fails. */
export async function setMostImportantComplete(
  timeDir: string,
  dayPath: string,
  raw: string,
  done: boolean,
  dayContent?: string,
): Promise<() => Promise<void>> {
  const noop = async () => {}
  const lexer = new Lexer()
  if (dayContent)
    lexer.tokens.links = Object.fromEntries(
      [...Document.fromMarkdown(dayContent).links].map(([key, link]) => [key, link]),
    )
  const link = firstLink(lexer.inlineTokens(raw.split('\n')[0]))
  if (!link || /^(?:[a-z]+:|\/\/)/i.test(link.href)) return noop
  let relative: string
  try {
    relative = decodeURIComponent(link.href.split(/[?#]/)[0])
  } catch {
    return noop
  }
  const absolute = path.resolve(path.dirname(dayPath), relative)
  if (path.basename(path.dirname(absolute)) !== 'most-important' || !MI_FILE.test(path.basename(absolute))) return noop
  let file: string
  try {
    file = await notebookFile(timeDir, path.relative(timeDir, absolute))
  } catch (error) {
    if (missing(error)) return noop
    throw error
  }
  const before = await readOptional(file)
  if (before === undefined) return noop
  const doc = Document.fromMarkdown(before)
  if (doc.yaml['complete'] === done) return noop
  doc.yaml['complete'] = done
  const after = doc.toMarkdown()
  await atomicWrite(file, after)
  return async () => {
    if ((await readOptional(file)) === after) await atomicWrite(file, before)
  }
}
