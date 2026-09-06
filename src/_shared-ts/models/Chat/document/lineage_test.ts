import { assert, test } from '#test'
import type { ConversationMessage } from '../type.d.ts'
import type { ContextTurnLog } from './ContextLog/mod.ts'
import { branchDir, inheritedMessages, joinLineage, ownOf, prefixOf } from './lineage.ts'
import type { ResumeState } from './resume.ts'

const msg = (role: 'user' | 'assistant', content: string): ConversationMessage => ({ role, content })

const LOG: ContextTurnLog[] = [
  {
    turn: 1,
    queries: ['q1'],
    universe: [
      { path: 'goals/2026.md', tokens: 10 },
      { path: 'time/d1/day.md', tokens: 20 },
    ],
  },
  { turn: 2, queries: ['q1', 'q2'], diff: [{ path: 'projects/Atlas/Roadmap.md', tokens: 30 }] },
  { turn: 3, queries: ['q3'], pruned: [{ path: 'time/d1/day.md', tokens: 20, cut: 'budget' }] },
]

const PARENT: ResumeState = {
  conversation: [
    msg('user', 'I need help with the week.'),
    msg('assistant', 'Here is what is on: finances, board prep, hiring.'),
    msg('user', 'Start with the finances.'),
    msg('assistant', 'Two things are due Friday.'),
    msg('user', 'Draft the email.'),
    msg('assistant', 'Here is a draft.'),
  ],
  universePaths: ['goals/2026.md', 'time/d1/day.md', 'projects/Atlas/Roadmap.md'],
  queries: ['q3'],
  lastTurn: 3,
  contextLog: LOG,
}

test('lineage - the prefix at a turn keeps the turns through it and the log they left', () => {
  const prefix = prefixOf(PARENT, 1)

  assert({
    given: 'a three-turn parent and a branch leaving after turn 1',
    should: 'keep the first exchange, the first log entry, its universe and its query set',
    actual: {
      messages: prefix.conversation.map((m) => m.content.slice(0, 12)),
      turns: prefix.contextLog.map((e) => e.turn),
      universe: prefix.universePaths,
      queries: prefix.queries,
      lastTurn: prefix.lastTurn,
      inherited: inheritedMessages(1),
    },
    expected: {
      messages: ['I need help ', 'Here is what'],
      turns: [1],
      universe: ['goals/2026.md', 'time/d1/day.md'],
      queries: ['q1'],
      lastTurn: 1,
      inherited: 2,
    },
  })
})

test('lineage - a branch joined to its prefix is the whole thread, and its own part comes back out', () => {
  const prefix = prefixOf(PARENT, 1)
  const own: ResumeState = {
    conversation: [msg('user', 'Let us do the board prep instead.'), msg('assistant', 'Three things by Thursday.')],
    universePaths: ['projects/Board/Pack.md'],
    queries: ['board'],
    lastTurn: 2,
    contextLog: [{ turn: 2, queries: ['board'], diff: [{ path: 'projects/Board/Pack.md', tokens: 40 }] }],
  }
  const whole = joinLineage(prefix, own)
  const back = ownOf(whole, prefix.conversation.length, 1)

  assert({
    given: "the prefix and the branch's own turns",
    should: 'read as one conversation with one log, the newest queries in effect, and split back to the own part',
    actual: {
      roles: whole.conversation.map((m) => m.role),
      turns: whole.contextLog.map((e) => e.turn),
      universe: whole.universePaths,
      queries: whole.queries,
      lastTurn: whole.lastTurn,
      ownMessages: back.conversation.length,
      ownTurns: back.contextLog.map((e) => e.turn),
    },
    expected: {
      roles: ['user', 'assistant', 'user', 'assistant'],
      turns: [1, 2],
      universe: ['goals/2026.md', 'time/d1/day.md', 'projects/Board/Pack.md'],
      queries: ['board'],
      lastTurn: 2,
      ownMessages: 2,
      ownTurns: [2],
    },
  })
})

test("lineage - a branch with no queries of its own keeps the prefix's", () => {
  const prefix = prefixOf(PARENT, 2)
  const own: ResumeState = {
    conversation: [msg('user', 'Anything else?'), msg('assistant', 'No.')],
    universePaths: [],
    queries: [],
    lastTurn: 3,
    contextLog: [{ turn: 3, queries: [] }],
  }

  assert({
    given: 'a branch whose own entries carry no queries',
    should: "leave the prefix's query set in effect",
    actual: joinLineage(prefix, own).queries,
    expected: ['q1', 'q2'],
  })
})

test('lineage - branches file in the folder beside the parent, carrying its name', () => {
  assert({
    given: 'a parent transcript path',
    should: 'name the folder by dropping the extension',
    actual: branchDir('/nb/time/2026/W36/09-03/actions/ai-chats/09-12_Help-with-the-week.md'),
    expected: '/nb/time/2026/W36/09-03/actions/ai-chats/09-12_Help-with-the-week',
  })
})
