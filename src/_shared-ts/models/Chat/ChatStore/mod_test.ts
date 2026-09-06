import * as path from 'node:path'
import { assert, test } from '#test'
import { setUserSpeakerLabel } from '../document/mod.ts'
import { ancestorsOf, listDayChats, loadResumeSession } from './mod.ts'

setUserSpeakerLabel('Jane')

const CHATS_DIR = path.join(import.meta.dirname!, 'fixtures', 'ai-chats')

test('listDayChats - lists a day newest first, markdown only, branches from the folders beside their parents', async () => {
  const rows = await listDayChats(CHATS_DIR)

  assert({
    given: 'a day directory holding three transcripts and one text file',
    should: 'return the transcripts newest first with their listing fields',
    actual: rows.map((r) => ({
      name: path.basename(r.path),
      time: r.time,
      summary: r.summary,
      exchanges: r.exchanges,
    })),
    expected: [
      {
        name: '16-45_Vendor-Landscape-Review.md',
        time: '16:45',
        summary: 'Vendor Landscape Review',
        exchanges: 1,
      },
      {
        name: '14-15_Nimbus-Escrow-Timeline.md',
        time: '14:15',
        summary: 'Nimbus Escrow Timeline',
        exchanges: 1,
      },
      {
        name: '10-05_Board-Prep-Instead.md',
        time: '10:05',
        summary: 'Board Prep Instead',
        exchanges: 1,
      },
      {
        name: '09-30_Atlas-Launch-Planning.md',
        time: '09:30',
        summary: 'Atlas Launch Planning',
        exchanges: 2,
      },
    ],
  })

  assert({
    given: 'a listing row',
    should: 'carry an absolute path a host can open without rejoining',
    actual: rows.every((r) => path.isAbsolute(r.path)),
    expected: true,
  })
})

test('listDayChats - a day with no chats is empty, not an error', async () => {
  assert({
    given: 'a chats directory that does not exist',
    should: 'return no rows',
    actual: await listDayChats(path.join(import.meta.dirname!, 'fixtures', 'no-such-day')),
    expected: [],
  })
})

test('loadResumeSession - carries the frontmatter the save path must preserve', async () => {
  const session = await loadResumeSession(path.join(CHATS_DIR, '09-30_Atlas-Launch-Planning.md'))

  assert({
    given: 'a saved transcript with created, summary, rel, and tags',
    should: 'carry each forward verbatim for the write-back',
    actual: {
      created: session.created,
      summary: session.summary,
      rel: session.rel,
      tags: session.tags,
      frontmatterHealthy: session.frontmatterHealthy,
    },
    expected: {
      created: '2026-01-26',
      summary: 'Atlas Launch Planning',
      rel: ['projects/Atlas/Roadmap.md'],
      tags: ['Atlas/Launch'],
      frontmatterHealthy: true,
    },
  })

  assert({
    given: 'a two-exchange transcript',
    should: 'reseed the conversation in order',
    actual: session.state.conversation.map((m) => m.role),
    expected: ['user', 'assistant', 'user', 'assistant'],
  })

  assert({
    given: 'a stamped transcript whose second exchange happened the next day',
    should: 'reseed every turn with the stamp the file recorded, not the reading time',
    actual: session.state.conversation.map((m) => m.when),
    expected: ['2026-01-26 09:30', '2026-01-26 09:31', '2026-01-27 08:12', '2026-01-27 08:13'],
  })

  assert({
    given: 'a transcript whose context log recorded a universe and a later diff',
    should: 'restore the recorded universe rather than re-deriving it',
    actual: session.state.universePaths,
    expected: ['goals/2026.md', 'projects/Atlas/Roadmap.md', 'decisions/2026-01_Atlas-Tooling.md'],
  })

  assert({
    given: 'a log whose last turn evolved to two queries',
    should: 'resume from the query set in effect at that turn',
    actual: { queries: session.state.queries.length, lastTurn: session.state.lastTurn },
    expected: { queries: 2, lastTurn: 2 },
  })
})

test('loadResumeSession - malformed turns: marks the file unsafe to overwrite', async () => {
  const session = await loadResumeSession(path.join(CHATS_DIR, '16-45_Vendor-Landscape-Review.md'))

  assert({
    given: 'a transcript whose turns: folded the rel and tags keys into one scalar',
    should: 'report unhealthy frontmatter so the save path refuses the rewrite',
    actual: session.frontmatterHealthy,
    expected: false,
  })

  assert({
    given: 'the same transcript',
    should: 'still load its conversation so the session can continue read-only',
    actual: session.state.conversation.length,
    expected: 2,
  })
})

test('loadResumeSession - a transcript without created leaves the stamp to the caller', async () => {
  const session = await loadResumeSession(path.join(CHATS_DIR, '14-15_Nimbus-Escrow-Timeline.md'))

  assert({
    given: 'a transcript with no created key',
    should: 'report null rather than inventing a date inside the store',
    actual: session.created,
    expected: null,
  })
})

test('loadResumeSession - a pre-log transcript resumes with no recorded context', async () => {
  const session = await loadResumeSession(path.join(CHATS_DIR, '14-15_Nimbus-Escrow-Timeline.md'))

  assert({
    given: 'a transcript saved before the context log existed',
    should: 'restore the conversation with an empty context log, the signal to gather fresh',
    actual: {
      conversation: session.state.conversation.length,
      contextLog: session.state.contextLog.length,
      universePaths: session.state.universePaths.length,
      lastTurn: session.state.lastTurn,
    },
    expected: { conversation: 2, contextLog: 0, universePaths: 0, lastTurn: 0 },
  })

  assert({
    given: 'the same transcript, old enough to predate turn stamps too (bare `## Jane` headings)',
    should: 'still reseed both turns, unstamped',
    actual: session.state.conversation.map((m) => m.when),
    expected: [undefined, undefined],
  })
})

test('listDayChats - a branch row carries its parent key; a chat that began on its own carries none', async () => {
  const rows = await listDayChats(CHATS_DIR)
  assert({
    given: 'the day with one branch filed beside its parent',
    should: 'mark the branch with its parent and turn, and nothing else',
    actual: rows.map((r) => [path.basename(r.path), r.parent]),
    expected: [
      ['16-45_Vendor-Landscape-Review.md', null],
      ['14-15_Nimbus-Escrow-Timeline.md', null],
      ['10-05_Board-Prep-Instead.md', { chat: 'ai-chats/09-30_Atlas-Launch-Planning.md', turn: 1 }],
      ['09-30_Atlas-Launch-Planning.md', null],
    ],
  })
})

test("loadResumeSession - a branch loads as the whole thread: its parent's prefix, then its own turns", async () => {
  const branch = path.join(CHATS_DIR, '09-30_Atlas-Launch-Planning', '10-05_Board-Prep-Instead.md')
  const whole = await loadResumeSession(branch, { baseDir: path.dirname(CHATS_DIR) })
  const alone = await loadResumeSession(branch)
  const snapshot = await loadResumeSession(branch, { baseDir: path.dirname(CHATS_DIR), snapshot: true })

  assert({
    given: 'a branch left after turn 1 of a two-turn parent, loaded with, without, and as a snapshot',
    should:
      'join the first exchange to its own with the parent among its ancestors; stand alone without a root; count from the key as a snapshot',
    actual: {
      roles: whole.state.conversation.map((m) => m.role),
      inherited: whole.inherited,
      turns: whole.state.contextLog.map((e) => e.turn),
      ownMessages: whole.own.conversation.length,
      ancestors: whole.ancestors.map((a) => path.basename(a)),
      parent: whole.parent,
      aloneInherited: alone.inherited,
      aloneMessages: alone.state.conversation.length,
      snapshotInherited: snapshot.inherited,
    },
    expected: {
      roles: ['user', 'assistant', 'user', 'assistant'],
      inherited: 2,
      turns: [1, 2],
      ownMessages: 2,
      ancestors: ['09-30_Atlas-Launch-Planning.md'],
      parent: { chat: 'ai-chats/09-30_Atlas-Launch-Planning.md', turn: 1 },
      aloneInherited: 0,
      aloneMessages: 2,
      snapshotInherited: 2,
    },
  })
})

test('ancestorsOf - walks the parent keys up, nearest first, and stops where a file is missing', async () => {
  const branch = path.join(CHATS_DIR, '09-30_Atlas-Launch-Planning', '10-05_Board-Prep-Instead.md')
  const root = path.join(CHATS_DIR, '09-30_Atlas-Launch-Planning.md')
  assert({
    given: 'a branch and its root',
    should: 'name the root above the branch and nothing above the root',
    actual: {
      branch: (await ancestorsOf(branch, path.dirname(CHATS_DIR))).map((a) => path.basename(a)),
      root: await ancestorsOf(root, path.dirname(CHATS_DIR)),
    },
    expected: { branch: ['09-30_Atlas-Launch-Planning.md'], root: [] },
  })
})
