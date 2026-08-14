import { assert, test } from '#test'
import { formatSyncReport } from './syncReport.ts'

test('formatSyncReport lists captures and retirements as two sections', () => {
  const lines = formatSyncReport(
    [
      { from: 'Jane Doe', label: 'Kickoff scheduling', messages: 3, state: 'new' },
      { from: 'John Smith', label: 'Invoice question', messages: 1, state: 'updated' },
    ],
    [{ label: 'Old planning thread', reason: 'inactive 43d >= 14d' }],
  )

  assert({
    given: 'two captured threads and one retired follow',
    should: 'head each list with its count and mark new, updated, and closed differently',
    expected: [
      '',
      '  Synced (2):',
      '    + Jane Doe — Kickoff scheduling (3 msgs)',
      '    ~ John Smith — Invoice question (1 msg)',
      '',
      '  Closed (1):',
      '    × Old planning thread — inactive 43d >= 14d',
    ].join('\n'),
    actual: lines.join('\n'),
  })
})

test('formatSyncReport shows a captured-then-closed thread in both lists', () => {
  const lines = formatSyncReport(
    [{ from: 'Jane Doe', label: 'Kickoff scheduling', messages: 2, state: 'new', closed: true }],
    [{ label: 'Kickoff scheduling', reason: 'already quiet past 14d when first seen', captured: 2 }],
  )

  assert({
    given: 'a thread first seen already past the expiry window',
    should: 'appear as captured and as closed, each saying so',
    expected: [
      '',
      '  Synced (1):',
      '    + Jane Doe — Kickoff scheduling (2 msgs) — captured, then closed',
      '',
      '  Closed (1):',
      '    × Kickoff scheduling (2 msgs captured) — already quiet past 14d when first seen',
    ].join('\n'),
    actual: lines.join('\n'),
  })
})

test('formatSyncReport omits a list nothing happened in', () => {
  const lines = formatSyncReport([], [{ label: 'Old planning thread', reason: 'inactive 43d >= 14d' }])

  assert({
    given: 'a run that retired a follow but captured nothing',
    should: 'print the closed list alone, with no empty Synced heading',
    expected: ['', '  Closed (1):', '    × Old planning thread — inactive 43d >= 14d'].join('\n'),
    actual: lines.join('\n'),
  })
})

test('formatSyncReport stays silent on a quiet run', () => {
  assert({
    given: 'a run that captured and retired nothing',
    should: 'add no lines, leaving the one-line summary to speak',
    expected: 0,
    actual: formatSyncReport([], []).length,
  })
})

test('formatSyncReport truncates a label that would run off the line', () => {
  const long = 'A subject line that just keeps going and going well past anything readable in a terminal'
  const lines = formatSyncReport([{ from: 'Jane Doe', label: long, messages: 1, state: 'new' }], [])

  assert({
    given: 'an 87-character label',
    should: 'cut it to the display width',
    expected: '    + Jane Doe — A subject line that just keeps going and going well past any… (1 msg)',
    actual: lines[2],
  })
})
