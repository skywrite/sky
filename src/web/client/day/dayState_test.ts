import { assert, test } from '#test'
import type { DayData } from './day.tsx'
import { DayState } from './dayState.ts'

const DAY = '2030-04-08'
function view(sequence: number, instance = 'first-service', ymd = DAY): DayData {
  const ref = { ymd, label: 'Monday', meta: 'Mon 04-08', dayRelativePath: null }
  return {
    version: { instance, sequence },
    today: ref,
    day: { ...ref, dateLabel: 'Monday, April 8, 2030' },
    days: [ref],
    due: null,
    section: null,
    chats: [],
    summary: null,
    record: {
      started: null,
      summarized: false,
      mostImportant: [],
      commitments: [],
      todos: [],
      reminders: [],
      done: [],
      meetings: [],
      events: [],
      videos: [],
      messages: { involved: [], archive: [] },
      notes: [],
      journals: [],
      skipped: 0,
    },
  }
}
const wait = (ms = 25) => new Promise<void>((resolve) => setTimeout(resolve, ms))

test('day reads coalesce, follow changes during a read, and never overwrite a newer save', async () => {
  const reads: ReturnType<typeof Promise.withResolvers<DayData>>[] = []
  const state = new DayState(
    DAY,
    () => {
      const read = Promise.withResolvers<DayData>()
      reads.push(read)
      return read.promise
    },
    5,
  )
  state.start()
  try {
    await wait()
    for (let i = 0; i < 20; i++) state.refresh()
    state.applyView(view(2))
    reads[0].resolve(view(1))
    await wait()
    assert({
      given: 'an old read arriving after a save, with many changes during that read',
      should: 'keep the saved version and issue just one trailing read',
      actual: [state.snapshot()?.version?.sequence, reads.length],
      expected: [2, 2],
    })
    reads[1].resolve(view(4))
    await wait()
    state.applyView(view(3))
    assert({
      given: 'a slow mutation response arriving after a fresher background read',
      should: 'retain the fresher snapshot',
      actual: state.snapshot()?.version?.sequence,
      expected: 4,
    })
    state.notice({ type: 'changed', paths: [], days: ['2030-04-09'] })
    await wait()
    assert({ given: 'another date changed', should: 'leave this date alone', actual: reads.length, expected: 2 })
    for (let i = 0; i < 20; i++) state.notice({ type: 'resume' })
    await wait()
    assert({ given: 'focus and visibility events together', should: 'read once', actual: reads.length, expected: 3 })
    reads[2].resolve(view(5))
  } finally {
    state.stop()
  }
})

test('a restart accepts its new sequence, rejects old replies, and a failed read preserves the day', async () => {
  let next = view(1)
  let fail = false
  const state = new DayState(
    DAY,
    async () => {
      if (fail) throw new Error('offline')
      return next
    },
    5,
  )
  state.start()
  try {
    await wait()
    state.notice({ type: 'ready', instance: 'first-service' })
    state.applyView(view(50))
    next = view(1, 'second-service')
    state.notice({ type: 'ready', instance: 'second-service' })
    await wait()
    state.applyView(view(99))
    assert({
      given: 'a service restart and a delayed response from the old process',
      should: 'keep the new process snapshot',
      actual: state.snapshot()?.version,
      expected: next.version,
    })
    fail = true
    state.refresh()
    await wait()
    assert({
      given: 'a connection failure',
      should: 'retain readable data',
      actual: state.snapshot()?.version,
      expected: next.version,
    })
    fail = false
    next = view(2, 'second-service')
    state.notice({ type: 'resume' })
    await wait()
    assert({
      given: 'the tab becomes active during retry backoff',
      should: 'refresh promptly instead of waiting for the retry timer',
      actual: state.snapshot()?.version,
      expected: next.version,
    })
    state.applyView(view(2, 'second-service', '2030-04-09'))
    assert({
      given: 'a reply for another day',
      should: 'keep the selected date',
      actual: state.snapshot()?.day.ymd,
      expected: DAY,
    })
    state.stop()
    state.applyView(view(3, 'second-service'))
    assert({
      given: 'a response after navigation',
      should: 'be ignored',
      actual: state.snapshot()?.version,
      expected: next.version,
    })
  } finally {
    state.stop()
  }
})
