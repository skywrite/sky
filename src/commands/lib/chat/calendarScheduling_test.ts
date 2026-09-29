import { assert, test } from '#test'
import { calendarDraftRefusal, CalendarSchedulingTurn } from './calendarScheduling.ts'

test('unsupported scheduling stops queued preparations and sends until the next user turn', async () => {
  const turn = new CalendarSchedulingTurn()
  let finish!: (value: Record<string, unknown>) => void
  let preparations = 0
  let sends = 0
  const first = turn.run({ request: 'Meet Jane every week.' }, () => {
    preparations++
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const queued = Array.from({ length: 12 }, (_, index) =>
    turn.run({ request: `One single event on date ${index + 1}.` }, async () => {
      preparations++
      return { success: true, status: 'ready', draftId: `draft-${index}` }
    }),
  )
  await Promise.resolve()
  finish({ success: true, status: 'unsupported', unsupported: ['Recurring series are unsupported.'] })
  const original = await first
  const results = await Promise.all(queued)
  const send = await turn.run({ send: 'earlier-draft' }, async () => {
    sends++
    return { success: true, state: 'created' }
  })
  const receipt = await turn.run({ status: 'earlier-draft' }, async () => ({ success: true, state: 'uncertain' }))
  assert({
    given: 'parallel attempts to reword recurrence as one-time events, followed by a send and a receipt read',
    should: 'preserve the limitation, run only the original preparation, block writes, and allow status reads',
    actual: {
      preparations,
      sends,
      original: [original.status, original.retryable, original.unsupported, typeof original.nextAction],
      refused: results.every((result) => result.success === false && result.retryable === false),
      send: send.success,
      receipt: receipt.state,
    },
    expected: {
      preparations: 1,
      sends: 0,
      original: ['unsupported', false, ['Recurring series are unsupported.'], 'string'],
      refused: true,
      send: false,
      receipt: 'uncertain',
    },
  })
  const nextTurn = new CalendarSchedulingTurn()
  const revised = await nextTurn.run({ request: 'Just the first occurrence, please.' }, async () => {
    preparations++
    return { success: true, status: 'ready' }
  })
  assert({
    given: 'the user choosing a supported alternative in their next turn',
    should: 'allow a fresh preparation',
    actual: [preparations, revised.status],
    expected: [2, 'ready'],
  })
})

test('a scheduling turn still allows clarifications and batches of supported events', async () => {
  const turn = new CalendarSchedulingTurn()
  const outcomes = ['needs_input', 'ready', 'ready', 'created']
  const results = await Promise.all(
    outcomes.map((status) =>
      turn.run(status === 'created' ? { send: 'first,second' } : { request: 'Atlas planning' }, async () => ({
        success: true,
        status,
      })),
    ),
  )
  assert({
    given: 'missing details resolved from existing context and two supported preparations',
    should: 'preserve all results without treating clarification or an explicit batch as recurrence',
    actual: results.map((result) => result.status),
    expected: outcomes,
  })
})

test('a failed call does not leave the scheduling queue locked', async () => {
  const turn = new CalendarSchedulingTurn()
  await turn
    .run({ request: 'Atlas planning' }, async () => {
      throw new Error('Disconnected')
    })
    .catch(() => {})
  const result = await turn.run({ request: 'Atlas planning' }, async () => ({ success: true, status: 'ready' }))
  assert({
    given: 'a transport error rather than an unsupported request',
    should: 'release the queue for a later preparation',
    actual: result.status,
    expected: 'ready',
  })
})

test('drafts from an unsupported attempt stay blocked across later turns and JSON recovery', async () => {
  const history = JSON.parse(
    JSON.stringify([
      { tool: 'calendar_schedule', at: 1, output: { status: 'ready', draftId: 'before-rejection' } },
      { tool: 'calendar_schedule', at: 1, output: JSON.stringify({ status: 'unsupported' }) },
      { tool: 'calendar_schedule', at: 1, output: { status: 'ready', draftId: 'workaround' } },
      { tool: 'calendar_schedule', at: 3, output: { status: 'ready', draftId: 'fresh-request' } },
    ]),
  )
  let writes = 0
  const execute = async () => {
    writes++
    return { success: true }
  }
  const later = new CalendarSchedulingTurn(() => history)
  const blocked = await later.run({ send: 'before-rejection,workaround' }, execute)
  const allowed = await later.run({ send: 'fresh-request' }, execute)
  assert({
    given: 'a new turn reusing saved drafts from before and after an unsupported result in an older turn',
    should: 'reject those IDs after recovery while allowing a fresh supported request',
    actual: [!!calendarDraftRefusal(history, ['workaround']), blocked.success, allowed.success, writes],
    expected: [true, false, true, 1],
  })
})

test('a failed save stops queued replacement drafts and older sends while retaining receipt access', async () => {
  const turn = new CalendarSchedulingTurn()
  const receipt = {
    id: 'edited-draft',
    state: 'failed',
    fields: { title: 'Atlas launch review', time: '16:15', duration: 45 },
    success: false,
  }
  let writes = 0
  const replacement = async () => {
    writes++
    return { success: true }
  }
  const results = await Promise.all([
    turn.run({ send: 'edited-draft' }, async () => receipt),
    turn.run({ send: 'old-draft' }, replacement),
    turn.run({ request: 'Original Atlas planning at 3pm for 30 minutes.' }, replacement),
  ])
  const repeated = await turn.run({ send: 'edited-draft' }, async () => receipt)
  const status = await turn.run({ status: 'edited-draft' }, async () => receipt)
  const history = [
    { tool: 'calendar_schedule', at: 4, input: { send: 'edited-draft' }, output: JSON.stringify(receipt) },
  ]
  assert({
    given: 'a failed edited invitation followed by an older ID or a reconstruction from stale chat text',
    should: 'block both before execution or another approval, preserve the failed fields, and allow receipt reads',
    actual: [
      writes,
      results.map((result) => result.success),
      results[0]?.fields,
      repeated.id,
      status.state,
      !!calendarDraftRefusal(history, ['old-draft'], 4),
      calendarDraftRefusal(history, ['new-draft'], 6),
    ],
    expected: [0, [false, false, false], receipt.fields, receipt.id, 'failed', true, undefined],
  })
})
