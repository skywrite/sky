import * as path from 'node:path'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { NotebookChanges, type NotebookChange } from './notebookChanges.ts'

const base = '/synthetic-notebook'
const time = path.join(base, 'time')
const file = path.join(time, dayFile('2030-04-08'))
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

test('notebook changes coalesce paths and identify days, including shared sources and overflow', async () => {
  const changes = new NotebookChanges(base, time, 15, 60)
  const events: NotebookChange[] = []
  const off = changes.subscribe((event) => events.push(event))
  try {
    changes.changed(file)
    changes.changed(file)
    changes.changed(path.join(path.dirname(file), 'summary.md'))
    changes.changed('/outside-notebook/day.md')
    await wait(40)
    assert({
      given: 'a burst of changes to a day and its summary',
      should: 'send a ready handshake and one deduplicated, date-scoped batch',
      actual: [events[0]?.type, events.slice(1)],
      expected: [
        'ready',
        [
          {
            type: 'changed',
            paths: [path.relative(base, file), path.relative(base, path.join(path.dirname(file), 'summary.md'))],
            days: ['2030-04-08'],
          },
        ],
      ],
    })
    events.length = 0
    changes.changed(path.join(base, 'me/about.md'))
    await wait(40)
    assert({
      given: 'a shared profile changed',
      should: 'invalidate views of every day',
      actual: events,
      expected: [{ type: 'changed', paths: ['me/about.md'], days: null }],
    })
    events.length = 0
    for (let i = 0; i < 300; i++) changes.changed(path.join(path.dirname(file), `note-${i}.md`))
    await wait(40)
    assert({
      given: 'a large sync sweep',
      should: 'bound the batch size and request a complete refresh',
      actual: events,
      expected: [{ type: 'changed', paths: null, days: null }],
    })
    off()
    changes.changed(file)
    await wait(40)
    assert({ given: 'an unsubscribed tab', should: 'receive no further batches', actual: events.length, expected: 1 })
  } finally {
    changes.close()
  }
})

test('continuous notebook changes flush by the maximum wait and retain the trailing batch', async () => {
  const changes = new NotebookChanges(base, time, 40, 70)
  const events: NotebookChange[] = []
  changes.subscribe((event) => {
    if (event.type === 'changed') events.push(event)
  })
  const writes = setInterval(() => changes.changed(file), 10)
  try {
    await wait(110)
    assert({
      given: 'writes arriving faster than the debounce interval',
      should: 'send a batch while writes are still arriving',
      actual: events.length >= 1,
      expected: true,
    })
    clearInterval(writes)
    const before = events.length
    changes.changed(file)
    await wait(90)
    assert({
      given: 'the final write',
      should: 'send a trailing batch',
      actual: events.length > before,
      expected: true,
    })
  } finally {
    clearInterval(writes)
    changes.close()
  }
})
