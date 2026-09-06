import * as path from 'node:path'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { ACTION_KIND_DIRS, ACTIONS_DIR, actionKindRel, dayActionDir, hasFolder, isActionPath } from './actionKinds.ts'
import dayDir from './dayDir.ts'

test('dayActionDir is the kind folder inside the day directory', () => {
  const day = new PlainDate('2026-03-31')

  assert({
    given: 'the recap kind and a PlainDate',
    should: 'join the day directory, the actions folder, and the recaps folder',
    actual: dayActionDir('recap', day),
    expected: path.join(dayDir(day), ACTIONS_DIR, ACTION_KIND_DIRS.recap),
  })

  assert({
    given: 'the same day as a string',
    should: 'build the same path',
    actual: dayActionDir('recap', '2026-03-31'),
    expected: dayActionDir('recap', day),
  })
})

test('actionKindRel is the day-relative form the day file links with', () => {
  assert({
    given: 'the message kind',
    should: 'be the actions folder and the messages folder',
    actual: actionKindRel('message'),
    expected: `${ACTIONS_DIR}/${ACTION_KIND_DIRS.message}`,
  })
})

test('isActionPath recognises a kind by its folder, wherever the path starts', () => {
  assert({
    given: 'an absolute path into the meetings folder of a day',
    should: 'be a meeting',
    actual: isActionPath('meeting', '/notebook/time/2026/W14/03-31/actions/meetings/10-00_zoom_Atlas-sync.md'),
    expected: true,
  })

  assert({
    given: 'a day-relative message path',
    should: 'be a message and not a meeting',
    actual: [
      isActionPath('message', 'actions/messages/09-30_slack_Jane-Doe.md'),
      isActionPath('meeting', 'actions/messages/09-30_slack_Jane-Doe.md'),
    ],
    expected: [true, false],
  })

  assert({
    given: 'a file that carries the name of a kind folder',
    should: 'not be that kind, since only folder segments count',
    actual: isActionPath('note', '/notebook/library/notes.md'),
    expected: false,
  })
})

test('hasFolder matches a folder of several segments as one run', () => {
  assert({
    given: 'a path through ai/chats and the folder ai/chats',
    should: 'match',
    actual: hasFolder('time/2026/W14/03-31/actions/ai/chats/09-30_Atlas.md', 'ai/chats'),
    expected: true,
  })

  assert({
    given: 'paths through ai/memory and through a bare chats folder',
    should: 'not match ai/chats',
    actual: [
      hasFolder('ai/memory/word-economy.md', 'ai/chats'),
      hasFolder('time/2026/W14/03-31/actions/chats/09-30_Atlas.md', 'ai/chats'),
    ],
    expected: [false, false],
  })
})

test('no two kinds share a folder', () => {
  const folders = Object.values(ACTION_KIND_DIRS)

  assert({
    given: 'the kind table',
    should: 'name every folder once',
    actual: new Set(folders).size,
    expected: folders.length,
  })
})
