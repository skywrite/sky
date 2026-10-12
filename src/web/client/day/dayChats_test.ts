import { assert, test } from '#test'
import type { DayData, ThreadSummary } from './day.tsx'
import { chatTurnCount, dayChatRows } from './dayChats.ts'

const DAY = '2026-01-27'
const ROOT = 'actions/ai-chats/09-00_Atlas.md'
const BRANCH = 'actions/ai-chats/09-00_Atlas/10-00_Board.md'
const LEAF = 'actions/ai-chats/09-00_Atlas/10-00_Board/11-00_Budget.md'

function saved(
  path: string,
  summary: string,
  parent: DayData['chats'][number]['parent'] = null,
): DayData['chats'][number] {
  return { path, summary, time: path.split('/').at(-1)!.slice(0, 5).replace('-', ':'), exchanges: 1, parent }
}

function live(overrides: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id: 'live-root',
    title: 'Atlas live',
    state: 'done',
    line: null,
    when: '12:00',
    day: DAY,
    turns: 4,
    busy: false,
    parent: null,
    inherited: 0,
    saved: null,
    ...overrides,
  }
}

test('day chats nest every generation and count only each file’s own turns', () => {
  const rows = dayChatRows(
    DAY,
    [
      saved(LEAF, 'Budget', { chat: BRANCH, turn: 2 }),
      saved(BRANCH, 'Board', { chat: ROOT, turn: 1 }),
      saved(ROOT, 'Atlas'),
    ],
    [],
  )
  assert({
    given: 'a branch of a branch listed before its ancestors',
    should: 'show each chat under its own parent with its branch point and its own turn count',
    actual: rows.map((row) => [row.title, row.depth, row.parent, chatTurnCount(row)]),
    expected: [
      ['Atlas', 0, null, '1 turn'],
      ['Board', 1, { title: 'Atlas', turn: 1 }, '1 new turn'],
      ['Budget', 2, { title: 'Board', turn: 2 }, '1 new turn'],
    ],
  })
})

test('day chats keep saved children beneath a live continuation of their parent', () => {
  const rows = dayChatRows(
    DAY,
    [saved(ROOT, 'Atlas'), saved(BRANCH, 'Board', { chat: ROOT, turn: 1 })],
    [live({ saved: ROOT })],
  )
  assert({
    given: 'a saved parent opened to continue while its branch stays saved',
    should: 'replace only the parent row and preserve its child and the correct open targets',
    actual: rows.map((row) => [row.title, row.depth, row.turns, row.path, row.target]),
    expected: [
      ['Atlas live', 0, 2, ROOT, { kind: 'live', id: 'live-root' }],
      ['Board', 1, 1, BRANCH, { kind: 'saved', path: BRANCH }],
    ],
  })
})

test('day chats fall back to the saved parent when a branch’s live parent id has gone', () => {
  const rows = dayChatRows(
    DAY,
    [saved(ROOT, 'Atlas')],
    [
      live({
        id: 'live-branch',
        title: 'Board',
        saved: BRANCH,
        parent: { id: 'ended-parent', chat: ROOT, turn: 1, title: 'Atlas' },
        inherited: 2,
        turns: 5,
      }),
      live({
        id: 'live-leaf',
        title: 'Budget',
        parent: { id: 'live-branch', chat: BRANCH, turn: 2, title: 'Board' },
        inherited: 4,
        turns: 6,
      }),
    ],
  )
  assert({
    given: 'a saved parent, its live branch carrying an old parent id, and a live grandchild',
    should: 'keep both branches nested, excluding inherited messages and an unfinished reply from their counts',
    actual: rows.map((row) => [row.title, row.depth, row.turns, row.path]),
    expected: [
      ['Atlas', 0, 1, ROOT],
      ['Board', 1, 1, BRANCH],
      ['Budget', 2, 1, null],
    ],
  })
})

test('day chats retain a live continuation when its saved file belongs to the viewed day', () => {
  const rows = dayChatRows(
    DAY,
    [saved(ROOT, 'Atlas')],
    [
      live({ saved: ROOT, day: '2026-01-28' }),
      live({ id: 'unrelated', day: '2026-01-28' }),
      live({ id: `day-${DAY}` }),
    ],
  )
  assert({
    given: 'a chat continued another day, an unrelated live chat, and the day’s own composer',
    should: 'show the continuation once for its saved file',
    actual: rows.map((row) => row.target),
    expected: [{ kind: 'live', id: 'live-root' }],
  })
})

test('day chats retain an absent parent’s name and tolerate cyclic parent keys', () => {
  const orphan = dayChatRows(DAY, [saved(BRANCH, 'Board', { chat: ROOT, turn: 1 })], [])
  const cycle = dayChatRows(
    DAY,
    [saved(ROOT, 'Atlas', { chat: BRANCH, turn: 1 }), saved(BRANCH, 'Board', { chat: ROOT, turn: 1 })],
    [],
  )
  assert({
    given: 'a branch whose parent is outside the day',
    should: 'show it with its parent’s name and branch point',
    actual: orphan.map((row) => [row.depth, row.parent]),
    expected: [[0, { title: 'Atlas', turn: 1 }]],
  })
  assert({
    given: 'a cycle in hand-edited parent keys',
    should: 'show each chat once',
    actual: cycle.map((row) => row.title).sort(),
    expected: ['Atlas', 'Board'],
  })
})
