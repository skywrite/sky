import { assert, test } from '#test'
import type { ThreadSummary } from '../day/day.tsx'
import { sidebarChatRows } from './sidebarRows.ts'

const TODAY = '2026-11-24'

function thread(overrides: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id: 'atlas',
    title: 'Atlas API migration plan',
    state: 'done',
    line: null,
    when: '13:42',
    day: TODAY,
    turns: 2,
    busy: false,
    parent: null,
    inherited: 0,
    saved: null,
    ...overrides,
  }
}

test('sidebar chat rows filter day threads and nest live branches under their live parent', () => {
  const rows = sidebarChatRows(
    [
      thread({ id: 'day-2026-11-24', title: 'Day composer' }),
      thread({ id: 'pricing', title: 'Widget-V2 pricing', when: '14:15', state: 'thinking', busy: true }),
      thread({
        id: 'leaf',
        title: 'Latency fallback',
        parent: { id: 'branch', chat: 'actions/ai-chats/Rollback.md', turn: 2, title: 'Rollback checklist' },
      }),
      thread({
        id: 'branch-b',
        title: 'Canary rollout',
        parent: { id: 'atlas', chat: 'actions/ai-chats/Atlas.md', turn: 3, title: 'Atlas API migration plan' },
      }),
      thread({
        id: 'branch',
        title: 'Rollback checklist',
        saved: 'actions/ai-chats/Rollback.md',
        parent: { id: null, chat: 'actions/ai-chats/Atlas.md', turn: 1, title: 'Atlas API migration plan' },
      }),
      thread({ id: 'atlas', title: 'Atlas API migration plan', saved: 'actions/ai-chats/Atlas.md' }),
      thread({
        id: 'orphan',
        title: 'Closed parent branch',
        parent: { id: 'gone', chat: 'actions/ai-chats/Closed.md', turn: 1, title: 'Closed' },
      }),
    ],
    TODAY,
  )

  assert({
    given: 'root threads, branches matched by id or saved path, a grandchild, an orphan branch, and a day thread',
    should:
      'drop day threads, keep newest-first roots, and indent live branches by parent turn under their live parent',
    actual: rows.map((row) => [row.id, row.depth]),
    expected: [
      ['pricing', 0],
      ['atlas', 0],
      ['branch', 1],
      ['leaf', 2],
      ['branch-b', 1],
      ['orphan', 0],
    ],
  })
})

test('sidebar chat rows tolerate cyclic parent references without dropping any live chat', () => {
  const rows = sidebarChatRows([
    thread({
      id: 'first',
      title: 'First',
      parent: { id: 'second', chat: '', turn: 1, title: 'Second' },
    }),
    thread({
      id: 'second',
      title: 'Second',
      parent: { id: 'first', chat: '', turn: 1, title: 'First' },
    }),
  ])

  assert({
    given: 'two live chats pointing at each other as parents',
    should: 'render each chat exactly once',
    actual: rows.map((row) => row.id),
    expected: ['first', 'second'],
  })
})

test('sidebar chat rows map states, temporary flags, fallback titles, and tooltips', () => {
  const rows = sidebarChatRows(
    [
      thread({ id: 'reading', title: 'Reading check', state: 'reading', busy: true }),
      thread({ id: 'streaming', title: 'Draft reply', state: 'streaming', busy: true }),
      thread({ id: 'saving', title: 'Filing notes', state: 'saving', busy: true }),
      thread({ id: 'waiting', title: 'Q4 board memo', state: 'waiting', line: 'needs your go', saves: false }),
      thread({
        id: 'interrupted',
        title: 'Vendor contract',
        state: 'failed',
        line: 'sky restarted while replying — send it again',
        day: '2026-11-23',
        when: '17:20',
      }),
      thread({ id: 'errored', title: 'Broken call', state: 'failed', line: 'Timed out' }),
      thread({ id: 'temp', title: 'Quick regex check', state: 'done', saves: false, when: '12:30' }),
      thread({ id: 'untitled', title: null, state: 'new', when: null }),
    ],
    TODAY,
  )

  assert({
    given: 'threads across active, waiting, failed, temporary, historical-day, and untitled states',
    should: 'surface crisp status copy, prioritize waiting over temporary text, and format hover tooltips',
    actual: rows.map((row) => ({
      id: row.id,
      title: row.title,
      dotTone: row.dotTone,
      temporary: row.temporary,
      statusLabel: row.statusLabel,
      statusTone: row.statusTone,
      tooltip: row.tooltip,
    })),
    expected: [
      {
        id: 'reading',
        title: 'Reading check',
        dotTone: 'working',
        temporary: false,
        statusLabel: 'Reading notebook…',
        statusTone: 'working',
        tooltip: 'Reading check · 13:42',
      },
      {
        id: 'streaming',
        title: 'Draft reply',
        dotTone: 'working',
        temporary: false,
        statusLabel: 'Replying…',
        statusTone: 'working',
        tooltip: 'Draft reply · 13:42',
      },
      {
        id: 'saving',
        title: 'Filing notes',
        dotTone: 'working',
        temporary: false,
        statusLabel: 'Saving…',
        statusTone: 'working',
        tooltip: 'Filing notes · 13:42',
      },
      {
        id: 'waiting',
        title: 'Q4 board memo',
        dotTone: 'waiting',
        temporary: true,
        statusLabel: 'Needs your go',
        statusTone: 'waiting',
        tooltip: 'Q4 board memo · 13:42 · Temporary',
      },
      {
        id: 'interrupted',
        title: 'Vendor contract',
        dotTone: 'failed',
        temporary: false,
        statusLabel: 'Interrupted',
        statusTone: 'failed',
        tooltip: 'Vendor contract · 2026-11-23',
      },
      {
        id: 'errored',
        title: 'Broken call',
        dotTone: 'failed',
        temporary: false,
        statusLabel: 'Reply failed',
        statusTone: 'failed',
        tooltip: 'Broken call · 13:42',
      },
      {
        id: 'temp',
        title: 'Quick regex check',
        dotTone: 'live',
        temporary: true,
        statusLabel: 'Temporary',
        statusTone: 'temp',
        tooltip: 'Quick regex check · 12:30 · Temporary',
      },
      {
        id: 'untitled',
        title: 'New chat',
        dotTone: 'live',
        temporary: false,
        statusLabel: null,
        statusTone: null,
        tooltip: 'New chat',
      },
    ],
  })
})
