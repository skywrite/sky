import { Hono } from 'hono'
import { atomicWrite, readOptional } from '#lib/outbox/files.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { editPlanItem, ItemEditError, replaceEditedBlock } from './editingText.ts'
import { itemEditFields, type DayEditFields } from './editingTypes.ts'
import { bodyOf, dayFileOf, type ItemRoutesOptions } from './itemContext.ts'
import { normalizeDayTime } from './planningTypes.ts'

interface EditOperation {
  day: string
  request: string
  before: string
  result: ReturnType<typeof editPlanItem>
  expires: number
  undone: boolean
}

function fieldsOf(body: Record<string, unknown>, list: string, raw: string): DayEditFields {
  const original = itemEditFields({ list, raw })
  const fields = { ...original, ...body }
  if (typeof fields.text !== 'string' || !fields.text.trim() || fields.text.length > 4000)
    throw new ItemEditError('Enter text for the item (up to 4000 characters).', 400)
  if (!['todos', 'commitments', 'reminders', 'important'].includes(String(fields.kind)))
    throw new ItemEditError('Choose an item type.', 400)
  if (
    typeof fields.category !== 'string' ||
    !fields.category.trim() ||
    fields.category.length > 80 ||
    /[\r\n#]/.test(fields.category)
  )
    throw new ItemEditError('Choose a category.', 400)
  if (typeof fields.time !== 'string') throw new ItemEditError('Enter a time as HH:MM.', 400)
  const time = fields.time ? normalizeDayTime(fields.time) : ''
  const scheduling = body.kind !== undefined || body.time !== undefined
  if (
    time === null ||
    (scheduling && fields.kind === 'commitments' && !time) ||
    (scheduling && ['todos', 'reminders'].includes(fields.kind) && time)
  )
    throw new ItemEditError('Commitments need a time as HH:MM. To-dos and reminders have no time.', 400)
  return { text: fields.text.trim().replace(/\s+/g, ' '), kind: fields.kind, category: fields.category.trim(), time }
}

export function createEditingRoutes(options: ItemRoutesOptions): Hono {
  const app = new Hono()
  const operations = new Map<string, EditOperation>()
  const cleanup = () => {
    for (const [id, operation] of operations) if (operation.expires < performance.now()) operations.delete(id)
    while (operations.size > 200) operations.delete(operations.keys().next().value!)
  }
  app.onError((error, c) => c.json({ error: error.message }, error instanceof ItemEditError ? error.status : 500))
  const write = async (file: string, before: string, after: string) => {
    if ((await readOptional(file)) !== before)
      throw new ItemEditError('The day changed while saving. Your draft is kept; try again.')
    if (after !== before) await (options.writePlanning ?? atomicWrite)(file, after)
  }

  app.post('/:ymd/item/edit', async (c) => {
    const body = await bodyOf(c)
    if (
      !body ||
      typeof body.list !== 'string' ||
      typeof body.raw !== 'string' ||
      typeof body.text !== 'string' ||
      typeof body.requestId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(body.requestId)
    )
      return c.json({ error: 'Expected an item, its text and a request ID.' }, 400)
    const day = await dayFileOf(c, options)
    if (day instanceof Response) return day
    const fields = fieldsOf(body, body.list, body.raw)
    const request = JSON.stringify({ list: body.list, raw: body.raw, fields })
    cleanup()
    const previous = operations.get(body.requestId)
    if (previous) {
      if (previous.day !== day.ymd || previous.request !== request || previous.undone)
        throw new ItemEditError('This request has already been used. Start a new edit.')
      return c.json({
        view: await options.view(day.ymd),
        undo: body.requestId,
        message: 'Item updated',
        item: previous.result.after,
      })
    }
    const result = editPlanItem(day.content, body.list, body.raw, fields)
    if (DayDocument.isItemDone(result.after.raw) !== DayDocument.isItemDone(body.raw.split(/\r?\n/)[0]))
      throw new ItemEditError('Use the checkbox to change completion. Keep completion marks out of the text.', 400)
    await write(day.file, day.content, result.content)
    operations.set(body.requestId, {
      day: day.ymd,
      request,
      before: day.content,
      result,
      expires: performance.now() + 10 * 60_000,
      undone: false,
    })
    return c.json({
      view: await options.view(day.ymd),
      undo: body.requestId,
      message: 'Item updated',
      item: result.after,
    })
  })

  app.post('/:ymd/item/edit/undo', async (c) => {
    const body = await bodyOf(c)
    cleanup()
    const operation = typeof body?.id === 'string' ? operations.get(body.id) : undefined
    if (!operation || operation.day !== c.req.param('ymd')) throw new ItemEditError('This undo has expired.')
    const day = await dayFileOf(c, options)
    if (day instanceof Response) return day
    if (!operation.undone) {
      const after =
        day.content === operation.result.content
          ? operation.before
          : replaceEditedBlock(day.content, operation.result.after, operation.result.before)
      await write(day.file, day.content, after)
      operation.undone = true
    }
    return c.json(await options.view(day.ymd))
  })
  return app
}
