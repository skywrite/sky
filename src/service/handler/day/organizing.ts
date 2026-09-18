import { unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { Hono, type Context } from 'hono'
import { createDayFile } from '#lib/nbfs/createDayFile.ts'
import { atomicWrite, readOptional, withLock } from '#lib/outbox/files.ts'
import { workstreamDayReference } from '#lib/workstreams/day.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { editPlanItem, editableRow, ItemEditError, planSection, planSections } from './editingText.ts'
import type { DayEditFields } from './editingTypes.ts'
import { dayEnd } from './ended.ts'
import isDay from './isDay.ts'
import { bodyOf, dayFileOf, type ItemRoutesOptions } from './itemContext.ts'
import { orderPlanList, planOrder, setPlanOrder } from './order.ts'
import { arrangeBlocks, blockRaw, blockRevision, checkedBlock, insertBlock, removeBlock } from './organizingText.ts'
import { dayItemKey, type DayItemAddress } from './organizingTypes.ts'
import { moveItemMarkdown } from './planningText.ts'

interface Change {
  file: string
  before: string | undefined
  after: string | undefined
}
interface MovedBlock {
  before: { list: string; raw: string; block: string; index: number }
  after: { list: string; raw: string; block: string }
}
interface Operation {
  day: string
  request: string
  changes: Change[]
  message: string
  expires: number
  undone: boolean
  target?: string
  moved?: MovedBlock[]
  lists?: string[]
}

const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)
function addresses(value: unknown): DayItemAddress[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 100 ||
    !value.every(
      (item) =>
        item &&
        typeof item.list === 'string' &&
        typeof item.raw === 'string' &&
        typeof item.revision === 'string' &&
        /^[a-f0-9]{64}$/.test(item.revision),
    )
  )
    throw new ItemEditError('Select up to 100 items from the current day.', 400)
  if (new Set(value.map(dayItemKey)).size !== value.length) throw new ItemEditError('Select each item only once.', 400)
  return value as DayItemAddress[]
}

function orderAddedItems(before: string, after: string, lists: Iterable<string>): string {
  for (const list of lists) {
    const existing = new Set(planSection(before, list)?.rows.map((row) => row.raw))
    // Preserve restored order unless newer items need the restored sorting preference.
    if (planSection(after, list)?.rows.some((row) => row.raw && !existing.has(row.raw)))
      after = orderPlanList(after, list)
  }
  return after
}

async function writeChanges(changes: Change[], write?: ItemRoutesOptions['writePlanning']): Promise<void> {
  for (const change of changes)
    if ((await readOptional(change.file)) !== change.before)
      throw new ItemEditError('A day changed while saving. Refresh and try again.')
  const attempted: Change[] = []
  try {
    for (const change of changes) {
      if (change.before === change.after) continue
      if ((await readOptional(change.file)) !== change.before)
        throw new ItemEditError('A day changed while saving. Refresh and try again.')
      if (change.after === undefined) await unlink(change.file)
      else if (write) {
        // A test writer may fail after writing; inspect its bytes during rollback too.
        attempted.push(change)
        await write(change.file, change.after)
        continue
      } else if (change.before === undefined) {
        if (!(await createDayFile(change.file, change.after)))
          throw new ItemEditError('The destination day was just created elsewhere. Refresh and try again.')
      } else await atomicWrite(change.file, change.after)
      attempted.push(change)
    }
  } catch (error) {
    for (const change of attempted.reverse()) {
      if ((await readOptional(change.file)) !== change.after) continue
      if (change.before === undefined) await unlink(change.file)
      else await atomicWrite(change.file, change.before)
    }
    throw error
  }
}

export function createDayOrganizer(options: ItemRoutesOptions) {
  const routes = new Hono()
  const operations = new Map<string, Operation>()
  const cleanup = () => {
    for (const [id, operation] of operations) if (operation.expires < performance.now()) operations.delete(id)
    while (operations.size > 200) operations.delete(operations.keys().next().value!)
  }
  const remember = (id: string, operation: Omit<Operation, 'expires' | 'undone'>) => {
    operations.set(id, { ...operation, expires: performance.now() + 10 * 60_000, undone: false })
  }
  const previous = (id: string, day: string, request: string) => {
    cleanup()
    const operation = operations.get(id)
    if (operation && (operation.day !== day || operation.request !== request || operation.undone))
      throw new ItemEditError('This request has already been used. Start a new action.')
    return operation
  }
  const response = async (c: Context, id: string) => {
    const operation = operations.get(id)!
    return c.json({
      view: await options.view(operation.day),
      undo: id,
      undoRoute: 'organize/undo',
      message: operation.message,
      date: operation.target,
      item: operation.moved?.[0]?.after,
    })
  }
  const lockedTarget = <T>(ymd: string, run: () => Promise<T>): Promise<T> =>
    options.workstreams ? withLock(path.join(options.workstreams.stateDir, `day-${ymd}.lock`), run) : run()
  routes.onError((error, c) => c.json({ error: error.message }, error instanceof ItemEditError ? error.status : 500))

  const move = async (
    c: Context,
    input: { items: DayItemAddress[]; date: string; requestId: string; edit?: DayEditFields },
  ) => {
    const selected = addresses(input.items)
    if (!validId(input.requestId) || !isDay(input.date)) throw new ItemEditError('Choose a date for these items.', 400)
    const today = options.today().ymd
    if (input.date < today || input.date === c.req.param('ymd'))
      throw new ItemEditError('Choose today or a future date different from this day.', 400)
    const day = await dayFileOf(c, options)
    if (day instanceof Response) return day
    const request = JSON.stringify(input)
    if (previous(input.requestId, day.ymd, request)) return response(c, input.requestId)
    return lockedTarget(input.date, async () => {
      const file = path.join(options.timeDir, dayFile(new PlainDate(input.date)))
      const before = await readOptional(file)
      const destination = before ?? DayDocument.createFutureDay(new PlainDate(input.date)).toMarkdown()
      if (dayEnd(DayDocument.fromMarkdown(destination)).ended)
        throw new ItemEditError('The destination day has ended. Choose another date.')
      // Sort by source position, so selection order never changes the order of moved tasks.
      const rows = selected
        .map((address) => {
          if (workstreamDayReference(address.raw))
            throw new ItemEditError('Schedule linked activities from their workstream.')
          return { address, row: checkedBlock(day.content, day.file, address) }
        })
        .sort((a, b) => a.row.from - b.row.from)
      let source = day.content
      let target = destination
      const moved: MovedBlock[] = []
      for (const { address, row } of rows) {
        const edited = input.edit ? editPlanItem(day.content, address.list, address.raw, input.edit).after : null
        if (
          edited &&
          (workstreamDayReference(edited.raw) || DayDocument.isItemDone(edited.raw) !== DayDocument.isItemDone(row.raw))
        )
          throw new ItemEditError(
            'Use the checkbox for completion and add linked activities from their workstream.',
            400,
          )
        const list = edited?.list ?? address.list
        const block = moveItemMarkdown(edited?.block ?? row.block, day.content, day.file, file)
        target = insertBlock(target, list, block)
        source = removeBlock(source, address.list, address.raw)
        const raw = blockRaw(block)
        moved.push({
          before: { list: address.list, raw: row.raw, block: row.block, index: row.index },
          after: { list, raw, block: editableRow(target, list, raw).block },
        })
      }
      for (const list of new Set(moved.map((item) => item.after.list))) target = orderPlanList(target, list)
      const changes = [
        { file, before, after: target },
        { file: day.file, before: day.content, after: source },
      ]
      // Keep a destination copy before removing anything from the source.
      await writeChanges(changes, options.writePlanning)
      const when = input.date === new PlainDate(today).addDays(1).ymd ? 'tomorrow' : input.date
      remember(input.requestId, {
        day: day.ymd,
        request,
        changes,
        moved,
        target: input.date,
        message: `${moved.length} ${moved.length === 1 ? 'item' : 'items'} moved to ${when}`,
      })
      return response(c, input.requestId)
    })
  }

  routes.post('/:ymd/item/organize/move', async (c) => {
    const body = await bodyOf(c)
    if (!body || typeof body.date !== 'string' || !validId(body.requestId))
      throw new ItemEditError('Select items and choose their destination date.', 400)
    return move(c, { items: addresses(body.items), date: body.date, requestId: body.requestId })
  })

  routes.post('/:ymd/item/organize/reorder', async (c) => {
    const body = await bodyOf(c)
    if (!body || typeof body.list !== 'string' || !validId(body.requestId))
      throw new ItemEditError('Choose a list to reorder.', 400)
    const requested = addresses(body.items)
    if (requested.some((item) => item.list !== body.list))
      throw new ItemEditError('Reorder items within the same list and category.', 400)
    const day = await dayFileOf(c, options)
    if (day instanceof Response) return day
    const request = JSON.stringify({ list: body.list, items: requested })
    if (previous(body.requestId, day.ymd, request)) return response(c, body.requestId)
    const rows = planSection(day.content, body.list)?.rows.filter((row) => row.raw) ?? []
    if (rows.length !== requested.length) throw new ItemEditError('The list changed. Review it before reordering.')
    const ordered = requested.map((item) => checkedBlock(day.content, day.file, item))
    let after = arrangeBlocks(day.content, rows, ordered)
    if (/commitments$/i.test(body.list)) {
      if (planOrder(day.content).commitmentsOrder !== 'manual')
        throw new ItemEditError('Choose Manual order before dragging commitments.')
    } else if (!/^reminders$/i.test(body.list))
      after = setPlanOrder(after, 'manual-order', [...new Set([...planOrder(after).manualOrder, body.list])])
    const changes = [{ file: day.file, before: day.content, after }]
    await writeChanges(changes, options.writePlanning)
    remember(body.requestId, { day: day.ymd, request, changes, lists: [body.list], message: 'Order updated' })
    return response(c, body.requestId)
  })

  routes.post('/:ymd/item/organize/order', async (c) => {
    const body = await bodyOf(c)
    if (!body || !['time', 'manual'].includes(String(body.order)) || !validId(body.requestId))
      throw new ItemEditError('Choose Time or Manual order.', 400)
    const day = await dayFileOf(c, options)
    if (day instanceof Response) return day
    const request = JSON.stringify({ order: body.order })
    if (previous(body.requestId, day.ymd, request)) return response(c, body.requestId)
    let after = setPlanOrder(day.content, 'commitments-order', body.order)
    const lists = planSections(day.content)
      .map((section) => section.title)
      .filter((list) => /commitments$/i.test(list))
    for (const list of lists) after = orderPlanList(after, list)
    const changes = [{ file: day.file, before: day.content, after }]
    await writeChanges(changes, options.writePlanning)
    remember(body.requestId, {
      day: day.ymd,
      request,
      changes,
      lists,
      message: body.order === 'manual' ? 'Commitments use manual order' : 'Commitments sorted by time',
    })
    return response(c, body.requestId)
  })

  routes.post('/:ymd/item/organize/undo', async (c) => {
    const body = await bodyOf(c)
    cleanup()
    const operation = typeof body?.id === 'string' ? operations.get(body.id) : undefined
    if (!operation || operation.day !== c.req.param('ymd')) throw new ItemEditError('This undo has expired.')
    const day = await dayFileOf(c, options)
    if (day instanceof Response) return day
    if (operation.undone) return c.json(await options.view(day.ymd))
    const undo = async () => {
      const changes: Change[] = []
      for (const change of operation.changes) {
        const current = await readOptional(change.file)
        if (current === undefined)
          throw new ItemEditError('A day file was removed. The change cannot be undone automatically.')
        if (dayEnd(DayDocument.fromMarkdown(current)).ended)
          throw new ItemEditError('A day has ended. The change cannot be undone automatically.')
        let after = change.before
        if (current !== change.after) {
          after = current
          if (operation.moved) {
            if (change.file === day.file) {
              for (const item of [...operation.moved].sort((a, b) => a.before.index - b.before.index)) {
                if (
                  blockRevision(item.before.block, current, change.file) !==
                  blockRevision(item.before.block, change.before!, change.file)
                )
                  throw new ItemEditError('A source link changed. Review the day before undoing.')
                after = insertBlock(after, item.before.list, item.before.block, item.before.index)
              }
              after = orderAddedItems(change.before!, after, new Set(operation.moved.map((item) => item.before.list)))
            } else {
              for (const item of operation.moved) {
                const row = editableRow(after, item.after.list, item.after.raw)
                if (
                  blockRevision(row.block, after, change.file) !==
                  blockRevision(item.after.block, change.after!, change.file)
                )
                  throw new ItemEditError('A moved item or its notes changed. It cannot be undone automatically.')
                after = removeBlock(after, item.after.list, item.after.raw)
              }
            }
          } else {
            for (const list of operation.lists ?? []) {
              const original = planSection(change.before!, list)?.rows.filter((row) => row.raw) ?? []
              const saved = planSection(change.after!, list)?.rows.filter((row) => row.raw) ?? []
              const names = new Set(saved.map((row) => row.raw))
              const slots = planSection(after, list)?.rows.filter((row) => names.has(row.raw)) ?? []
              if (
                slots.length !== saved.length ||
                slots.some(
                  (row, i) =>
                    blockRevision(row.block, after!, change.file) !==
                    blockRevision(saved[i].block, change.after!, change.file),
                )
              )
                throw new ItemEditError('This list changed again. Its order cannot be undone automatically.')
              after = arrangeBlocks(after, slots, original)
            }
            for (const key of ['manual-order', 'commitments-order'] as const) {
              const oldValue = DayDocument.fromMarkdown(change.before!).yaml[key]
              const savedValue = DayDocument.fromMarkdown(change.after!).yaml[key]
              const currentValue = DayDocument.fromMarkdown(current).yaml[key]
              if (JSON.stringify(oldValue) === JSON.stringify(savedValue)) continue
              if (JSON.stringify(savedValue) !== JSON.stringify(currentValue))
                throw new ItemEditError('The ordering preference changed again. It cannot be undone automatically.')
              after = setPlanOrder(after, key, oldValue)
            }
            after = orderAddedItems(change.before!, after, operation.lists ?? [])
          }
        }
        changes.push({ file: change.file, before: current, after })
      }
      // Restore the original day before deleting its destination copies.
      await writeChanges(changes.reverse(), options.writePlanning)
      operation.undone = true
      return c.json(await options.view(day.ymd))
    }
    return operation.target ? lockedTarget(operation.target, undo) : undo()
  })
  return { routes, move }
}

export type DayOrganizer = ReturnType<typeof createDayOrganizer>
