import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { type ContextTurnLog, serializeContextLog } from '#shared/models/Chat/document/ContextLog/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { gatherMemoryUsage } from './usage.ts'

const TODAY = new PlainDate('2026-06-01')

test('gatherMemoryUsage - counts shipped memory docs from saved chats, skipping cut ones', async () => {
  const timeDir = await mkdtemp(path.join(os.tmpdir(), 'memory-usage-'))
  try {
    const log: ContextTurnLog[] = [
      {
        turn: 1,
        queries: [],
        universe: [
          { path: 'ai/memory/big-deck.md', tokens: 40, score: 12 },
          { path: 'ai/memory/stale-note.md', tokens: 40, score: 1, cut: 'floor' },
          { path: 'time/2026/05/25-31/05-30/day.md', tokens: 900, score: 9 },
        ],
      },
      {
        turn: 2,
        queries: [],
        diff: [{ path: 'ai/memory/big-deck.md', tokens: 40, score: 14 }],
      },
    ]
    const chatsDir = path.join(timeDir, dayDir(TODAY.addDays(-2)), 'actions', 'ai-chats')
    await mkdir(chatsDir, { recursive: true })
    await writeFile(path.join(chatsDir, '09-00_Atlas-Chat.md'), `# Chat\n${serializeContextLog(log)}`)

    const report = await gatherMemoryUsage({ timeDir, today: TODAY, days: 7 })
    assert({
      given: 'one saved chat shipping a memory twice and cutting another',
      should: 'count only the shipped memory, with the chat day as lastShipped',
      actual: {
        chatsScanned: report.chatsScanned,
        bigDeck: report.usage.get('big-deck'),
        staleNote: report.usage.get('stale-note'),
      },
      expected: {
        chatsScanned: 1,
        bigDeck: { ships: 2, lastShipped: TODAY.addDays(-2).toString() },
        staleNote: undefined,
      },
    })
  } finally {
    await rm(timeDir, { recursive: true, force: true })
  }
})

test('gatherMemoryUsage - empty window reports zero scanned, not zero usage', async () => {
  const timeDir = await mkdtemp(path.join(os.tmpdir(), 'memory-usage-'))
  try {
    const report = await gatherMemoryUsage({ timeDir, today: TODAY, days: 7 })
    assert({
      given: 'a time tree with no chats at all',
      should: 'report nothing scanned so callers treat usage as unknown',
      actual: { chatsScanned: report.chatsScanned, size: report.usage.size },
      expected: { chatsScanned: 0, size: 0 },
    })
  } finally {
    await rm(timeDir, { recursive: true, force: true })
  }
})
