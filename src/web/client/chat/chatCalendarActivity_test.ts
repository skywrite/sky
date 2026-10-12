import { assert, test } from '#test'
import type { Run } from './chat.tsx'
import { calendarActivitySummary, calendarRunLabel } from './chatCalendarActivity.ts'

const run = (output: unknown, changes: Partial<Run> = {}): Run => ({
  tool: 'calendar_schedule',
  at: 1,
  started: 1000,
  finished: 2000,
  status: 'success',
  lines: [],
  input: { request: 'Atlas planning' },
  output,
  ...changes,
})

test('calendar activity distinguishes draft preparation from creation and unsupported requests', () => {
  assert({
    given: 'successful tool calls with different scheduler outcomes',
    should: 'reserve Created for confirmed receipts',
    actual: [
      { status: 'ready' },
      { status: 'needs_input' },
      { status: 'unsupported' },
      { state: 'created' },
      { state: 'creating' },
      { state: 'uncertain' },
      { state: 'failed' },
      { success: false, retryable: false },
    ].map((output) => calendarRunLabel(run(output))),
    expected: [
      'Draft prepared',
      'Needs details',
      'Unsupported request',
      'Created',
      'Still creating',
      'Save unconfirmed',
      'Failed',
      'Stopped for your input',
    ],
  })
  assert({
    given: 'an old preparation without a structured result and a call that failed before returning',
    should: 'avoid claiming creation or treating a stale result as successful',
    actual: [calendarRunLabel(run(undefined)), calendarRunLabel(run({ status: 'ready' }, { error: 'Stopped' }))],
    expected: ['Preparation finished', 'Failed'],
  })
})

test('calendar activity retains mixed outcomes in its collapsed summary', () => {
  const calls = [
    run({ status: 'unsupported' }),
    run({ status: 'ready' }),
    run({ status: 'ready' }),
    run({ success: false, retryable: false }),
  ]
  assert({
    given: 'a recovered burst of preparations and a blocked workaround',
    should: 'keep the unsupported and stopped outcomes visible beside prepared drafts',
    actual: calendarActivitySummary(calls),
    expected: 'Unsupported request · Draft prepared × 2 · Stopped for your input',
  })
  assert({
    given: 'another preparation still running',
    should: 'describe ongoing preparation without claiming creation',
    actual: calendarActivitySummary([...calls, run(undefined, { status: null, phase: 'running' })]),
    expected: 'Preparing draft · 5 calls',
  })
})
