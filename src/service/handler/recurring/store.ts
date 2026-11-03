import * as path from 'node:path'
import { z } from 'zod'
import { PatternMatcher } from '#commands/all/day/_recurring/PatternMatcher.ts'
import { withProcessLock } from '#lib/jobs/files.ts'
import { insertBlock, planSections, type PlanBlock } from '#lib/nbfs/listBlocks.ts'
import { moveItemMarkdown } from '#lib/nbfs/moveItemMarkdown.ts'
import { writePlanningChanges, type PlanningChange } from '#lib/nbfs/planningChanges.ts'
import { hash, readOptional } from '#lib/outbox/files.ts'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { canonicalRecurringPattern } from '#universal/dates/recurring/display.ts'
import {
  SOURCES,
  type RecurringDraft,
  type RecurringItem,
  type RecurringReport,
  type RecurringSource,
} from './types.ts'

export class RecurringError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message)
  }
}

const revisions = z.object({
  professional: z.string().length(64),
  personal: z.string().length(64),
  reminders: z.string().length(64),
})
const address = z.object({ id: z.string().min(1).max(100), revisions })
const draftSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Enter the recurring item’s text.')
    .max(4000)
    .refine((value) => !/[\r\n]/.test(value), 'Keep the item’s title on one line; use Notes for more detail.'),
  notes: z.string().max(80_000),
  kind: z.enum(['todo', 'commitment', 'reminder']),
  category: z.enum(['Professional', 'Personal']),
  time: z.string().max(20),
  pattern: z.string().trim().min(1).max(100),
})
const saveSchema = z.object({ id: address.shape.id.optional(), revisions, draft: draftSchema })
const LABELS: Record<RecurringSource, string> = {
  professional: 'Recurring Professional',
  personal: 'Recurring Personal',
  reminders: 'Reminders',
}
const FILENAMES: Record<RecurringSource, string> = {
  professional: 'recurring-professional.md',
  personal: 'recurring-personal.md',
  reminders: 'reminders.md',
}
const revision = (content: string | undefined) => hash(content === undefined ? 'missing' : 'content:' + content)
interface SourceFile {
  source: RecurringSource
  file: string
  content: string | undefined
}
interface Located extends RecurringItem {
  row: PlanBlock
  listSize: number
}

export function recurringDates(pattern: string, today: PlainDate): string[] {
  const normalized = canonicalRecurringPattern(pattern)
  if (!normalized) return []
  const matcher = new PatternMatcher(normalized)
  const dates: string[] = []
  // Some valid quarter-day rules occur only in the year's 92-day quarters.
  for (let offset = 0; offset < 1500 && dates.length < 3; offset++) {
    const day = today.addDays(offset)
    if (matcher.matches(day)) dates.push(day.ymd)
  }
  return dates
}

function locatedItems(file: SourceFile, today: PlainDate): Located[] {
  if (file.content === undefined) return []
  const content = file.content
  const lists = ListDocument.fromMarkdown(content).lists
  const used = new Set<number>()
  return planSections(content).flatMap((section) => {
    const first = section.rows[0]
    const headingEnd = content.indexOf('\n', section.from)
    // Only heading/list pairs consumed by the CLI extractor are recurring definitions.
    if (!first || headingEnd < 0 || content.slice(headingEnd + 1, first.from).trim()) return []
    const index = lists.findIndex((list, index) => !used.has(index) && list.title === section.title)
    if (index < 0) return []
    used.add(index)
    const rows = section.rows.filter((row) => row.raw).slice(0, lists[index].items.length)
    const valid = canonicalRecurringPattern(section.title) !== null
    const dates = valid ? recurringDates(section.title, today) : []
    return rows.map((row) => {
      const timed = /^(\d{2}:\d{2}) >\s*(.*)$/.exec(row.raw)
      const prefix = row.block.match(/^\s*[-*+]\s+/)?.[0] ?? '- '
      const notes = row.block
        .split(/\r?\n/)
        .slice(1)
        .map((line) => (line.startsWith(' '.repeat(prefix.length)) ? line.slice(prefix.length) : line))
        .join('\n')
      return {
        id: file.source + ':' + row.from,
        source: file.source,
        text: timed && file.source !== 'reminders' ? timed[2] : row.raw,
        notes,
        kind: file.source === 'reminders' ? ('reminder' as const) : timed ? ('commitment' as const) : ('todo' as const),
        category: file.source === 'professional' ? ('Professional' as const) : ('Personal' as const),
        time: timed && file.source !== 'reminders' ? timed[1] : '',
        pattern: section.title,
        valid,
        dates,
        row,
        listSize: rows.length,
      }
    })
  })
}

function normalizeDraft(input: RecurringDraft): RecurringDraft {
  const pattern = canonicalRecurringPattern(input.pattern)
  if (!pattern)
    throw new RecurringError('“' + input.pattern + '” is not a supported repeat schedule. Choose another schedule.')
  let time = ''
  if (input.kind === 'commitment') {
    const match = /^(\d{1,2}):([0-5]\d)$/.exec(input.time.trim())
    if (!match) throw new RecurringError('Enter a time for this to-do as HH:MM, for example 09:30.')
    time = match[1].padStart(2, '0') + ':' + match[2]
  } else if (input.kind === 'todo' && /^\d{2}:\d{2} >/.test(input.text)) {
    throw new RecurringError('This text starts with a time. Choose Add a time and put the time in its Time field.')
  }
  return { ...input, time, pattern, notes: input.notes.replace(/\r\n/g, '\n') }
}

function itemBlock(draft: RecurringDraft, original?: Located): string {
  const raw = draft.time ? draft.time + ' > ' + draft.text : draft.text
  const prefix = original?.row.block.match(/^\s*[-*+]\s+/)?.[0] ?? '- '
  const eol = original?.row.block.includes('\r\n') ? '\r\n' : '\n'
  const tail =
    original && draft.notes === original.notes
      ? original.row.block.slice(original.row.block.split(/\r?\n/)[0].length)
      : draft.notes
        ? eol +
          draft.notes
            .split('\n')
            .map((line) => ' '.repeat(prefix.length) + line)
            .join(eol)
        : ''
  return prefix + raw + tail
}

function removeItem(content: string, item: Located): string {
  if (item.listSize === 1)
    return (
      content.slice(0, item.row.from) + (item.row.block.match(/^\s*[-*+]/)?.[0] ?? '-') + content.slice(item.row.to)
    )
  const eol = content.slice(item.row.to).match(/^\r?\n/)?.[0] ?? ''
  return content.slice(0, item.row.from) + content.slice(item.row.to + eol.length)
}

function appendItem(content: string, heading: string, block: string): string {
  const sections = planSections(content).filter((section) => section.title === heading)
  if (sections.length > 1)
    throw new RecurringError(
      '“' + heading + '” appears more than once. Combine those headings in the source file before adding an item.',
      409,
    )
  const section = sections[0]
  if (!section) return insertBlock(content, heading, block)
  const first = section.rows[0]
  const headingEnd = content.indexOf('\n', section.from)
  const gap = content.slice(headingEnd + 1, first?.from ?? section.end)
  if (gap.trim())
    throw new RecurringError(
      '“' +
        heading +
        '” has text before its list. Open the source file and put the list immediately after its heading.',
      409,
    )
  const count = ListDocument.fromMarkdown(content).lists.find((list) => list.title === heading)?.size ?? 0
  const last = section.rows.filter((row) => row.raw)[count - 1]
  // Append inside the extractor's first list, before any prose or later lists.
  return last
    ? insertBlock(content.slice(0, last.to), heading, block) + content.slice(last.to)
    : insertBlock(content, heading, block)
}

export class RecurringStore {
  constructor(
    readonly options: { notebookDir: string; timeDir: string; stateDir: string },
    private readonly today: () => PlainDate = () => PlainDate.today(),
  ) {}

  private async files(): Promise<SourceFile[]> {
    return Promise.all(
      SOURCES.map(async (source) => {
        const file = path.join(this.options.timeDir, FILENAMES[source])
        return { source, file, content: await readOptional(file) }
      }),
    )
  }

  async report(): Promise<RecurringReport> {
    const files = await this.files()
    const today = this.today()
    return {
      today: today.ymd,
      files: files.map((file) => ({
        source: file.source,
        path: path.relative(this.options.notebookDir, file.file).split(path.sep).join('/'),
        exists: file.content !== undefined,
        revision: revision(file.content),
      })),
      items: files.flatMap((file) => locatedItems(file, today).map(({ row: _row, listSize: _size, ...item }) => item)),
    }
  }

  preview(pattern: string) {
    if (!canonicalRecurringPattern(pattern)) throw new RecurringError('Choose a supported repeat schedule.')
    return { dates: recurringDates(pattern, this.today()) }
  }

  private reviewed(file: SourceFile, expected: string, label: string) {
    if (revision(file.content) !== expected)
      throw new RecurringError(
        '“' +
          label +
          '” changed in ' +
          FILENAMES[file.source] +
          '. Your draft is kept. Review the source file, then reload before trying again.',
        409,
      )
  }

  async save(input: unknown): Promise<RecurringReport> {
    const request = saveSchema.parse(input)
    const draft = normalizeDraft(request.draft)
    return withProcessLock(path.join(this.options.stateDir, 'write'), async () => {
      const files = await this.files()
      const original = request.id
        ? files.flatMap((file) => locatedItems(file, this.today())).find((item) => item.id === request.id)
        : undefined
      if (request.id && !original)
        throw new RecurringError(
          'This recurring item moved or was removed. Your draft is kept; reload before trying again.',
          409,
        )
      const targetSource: RecurringSource =
        draft.kind === 'reminder' ? 'reminders' : draft.category === 'Professional' ? 'professional' : 'personal'
      const target = files.find((file) => file.source === targetSource)!
      const source = original ? files.find((file) => file.source === original.source)! : null
      this.reviewed(target, request.revisions[target.source], draft.text)
      if (source) this.reviewed(source, request.revisions[source.source], original!.text)
      const heading =
        original && canonicalRecurringPattern(original.pattern) === draft.pattern && source === target
          ? original.pattern
          : draft.pattern
      let block = itemBlock(draft, original)
      if (source && source !== target) block = moveItemMarkdown(block, source.content!, source.file, target.file)
      const base = target.content ?? '---\ntitle: ' + LABELS[target.source] + '\n---\n\n'
      const changes: PlanningChange[] = []
      if (original && source === target && heading === original.pattern) {
        changes.push({
          file: target.file,
          before: target.content,
          after: base.slice(0, original.row.from) + block + base.slice(original.row.to),
        })
      } else {
        let without = source?.content
        if (source && original) {
          without = removeItem(without!, original)
        }
        const after = appendItem(source === target ? without! : base, heading, block)
        changes.push({ file: target.file, before: target.content, after })
        if (source && source !== target) changes.push({ file: source.file, before: source.content, after: without })
      }
      // The day-start importer requires both category sources, even in a new notebook.
      // Initialize the standard empty sources only on an explicit save, never on a read.
      for (const file of files) {
        if (file.content !== undefined || changes.some((change) => change.file === file.file)) continue
        this.reviewed(file, request.revisions[file.source], draft.text)
        changes.push({ file: file.file, before: undefined, after: '---\ntitle: ' + LABELS[file.source] + '\n---\n\n' })
      }
      await writePlanningChanges(changes)
      return this.report()
    })
  }

  async remove(input: unknown): Promise<RecurringReport> {
    const request = address.parse(input)
    return withProcessLock(path.join(this.options.stateDir, 'write'), async () => {
      const files = await this.files()
      const original = files.flatMap((file) => locatedItems(file, this.today())).find((item) => item.id === request.id)
      if (!original)
        throw new RecurringError('This recurring item moved or was removed. Reload before trying again.', 409)
      const file = files.find((file) => file.source === original.source)!
      this.reviewed(file, request.revisions[file.source], original.text)
      const content = file.content!
      await writePlanningChanges([
        {
          file: file.file,
          before: content,
          after: removeItem(content, original),
        },
      ])
      return this.report()
    })
  }
}
