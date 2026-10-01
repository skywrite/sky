import { randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { setMostImportantComplete } from '#lib/mostImportant/store.ts'
import { atomicWrite, readOptional } from '#lib/outbox/files.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { ItemEditError, planSection, replaceEditedBlock } from './editingText.ts'
import { bodyOf, dayFileOf, type ItemRoutesOptions } from './itemContext.ts'
import { orderPlanList } from './order.ts'
import { blockRaw, blockRevision, checkedBlock, insertBlock, removeBlock, savedRow } from './organizingText.ts'

interface RowOperation {
  day: string
  before: string
  after: string
  item: { list: string; raw: string; block: string; occurrence: number; index: number }
  changed?: { list: string; raw: string; block: string; occurrence: number }
  expires: number
  undone: boolean
}

/** Web row actions keep complete blocks and distinguish repeated text without adding IDs to Markdown. */
export function createRowActions(options: ItemRoutesOptions) {
  const routes = new Hono()
  const operations = new Map<string, RowOperation>()
  const write = async (file: string, before: string, after: string) => {
    if ((await readOptional(file)) !== before)
      throw new ItemEditError('The day changed. Reload it before trying again.')
    if (after !== before) await (options.writePlanning ?? atomicWrite)(file, after)
  }
  const change = async (c: Context, body: Record<string, unknown> & { list: string; raw: string }, done?: boolean) => {
    if (!Number.isSafeInteger(body.occurrence) || Number(body.occurrence) < 0 || typeof body.revision !== 'string')
      throw new ItemEditError('Reload the day before changing this item.', 400)
    const day = await dayFileOf(c, options)
    if (day instanceof Response) return day
    const occurrence = body.occurrence as number
    const row = checkedBlock(day.content, day.file, {
      list: body.list,
      raw: body.raw,
      occurrence,
      revision: body.revision,
    })
    const item = { list: body.list, raw: row.raw, block: row.block, occurrence, index: row.index }
    let content: string
    let changed: RowOperation['changed']
    if (done === undefined) {
      content = removeBlock(day.content, body.list, row.raw, occurrence)
    } else {
      // Use the Day model's strike spelling on this one already-validated block.
      const prefix = `## ${body.list}\n\n`
      const toggled = DayDocument.toggleItem(prefix + row.block, body.list, row.raw, done)
      const block = toggled.kind === 'written' ? toggled.content.slice(prefix.length) : row.block
      const raw = blockRaw(block)
      const nextOccurrence = planSection(day.content, body.list)!.rows.filter(
        (candidate) => candidate.raw === raw && candidate.from < row.from,
      ).length
      content = orderPlanList(day.content.slice(0, row.from) + block + day.content.slice(row.to), body.list)
      changed = { list: body.list, raw, block, occurrence: nextOccurrence }
    }
    const rollback =
      done === undefined
        ? undefined
        : await setMostImportantComplete(options.timeDir, day.file, row.raw, done, day.content)
    try {
      await write(day.file, day.content, content)
    } catch (error) {
      await rollback?.()
      throw error
    }
    for (const [id, operation] of operations) if (operation.expires < performance.now()) operations.delete(id)
    while (operations.size >= 200) operations.delete(operations.keys().next().value!)
    const undo = randomUUID()
    operations.set(undo, {
      day: day.ymd,
      before: day.content,
      after: content,
      item,
      changed,
      expires: performance.now() + 10 * 60_000,
      undone: false,
    })
    const view = await options.view(day.ymd)
    if (!changed) return c.json({ at: row.index, view, undo })
    const fresh = [
      ...view.record.mostImportant,
      ...view.record.todos,
      ...view.record.commitments,
      ...view.record.reminders,
    ].find(
      (item) =>
        item.list === changed.list &&
        item.raw.split(/\r?\n/)[0] === changed.raw &&
        item.occurrence === changed.occurrence,
    )
    return c.json({ ...view, itemUndo: undo, item: fresh })
  }

  routes.post('/:ymd/item/row/undo', async (c) => {
    const body = await bodyOf(c)
    const operation = typeof body?.id === 'string' ? operations.get(body.id) : undefined
    if (!operation || operation.expires < performance.now() || operation.day !== c.req.param('ymd'))
      throw new ItemEditError('This undo has expired.')
    const day = await dayFileOf(c, options)
    if (day instanceof Response) return day
    if (!operation.undone) {
      let content = operation.before
      if (day.content !== operation.after) {
        if (operation.changed) {
          const row = savedRow(day.content, operation.after, day.file, operation.changed)
          content = replaceEditedBlock(
            day.content,
            { ...operation.changed, occurrence: row.occurrence },
            operation.item,
          )
        } else {
          if (
            blockRevision(operation.item.block, day.content, day.file) !==
            blockRevision(operation.item.block, operation.before, day.file)
          )
            throw new ItemEditError('A source link changed. Review the day before undoing.')
          content = orderPlanList(
            insertBlock(day.content, operation.item.list, operation.item.block, operation.item.index),
            operation.item.list,
          )
        }
      }
      const rollback = operation.changed
        ? await setMostImportantComplete(
            options.timeDir,
            day.file,
            operation.item.raw,
            DayDocument.isItemDone(operation.item.raw),
            day.content,
          )
        : undefined
      try {
        await write(day.file, day.content, content)
      } catch (error) {
        await rollback?.()
        throw error
      }
      operation.undone = true
    }
    return c.json(await options.view(day.ymd))
  })
  return { routes, change }
}
