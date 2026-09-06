import * as path from 'node:path'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import dayAIChatsDir, { ACTIONS_DIR, AI_CHATS_DIR } from './dayAIChatsDir.ts'
import dayDir from './dayDir.ts'

test('dayAIChatsDir is the chats folder inside the day directory', () => {
  const day = new PlainDate('2026-03-31')

  assert({
    given: 'a PlainDate',
    should: 'join the day directory, the actions folder, and the chats folder',
    actual: dayAIChatsDir(day),
    expected: path.join(dayDir(day), ACTIONS_DIR, AI_CHATS_DIR),
  })
})

test('dayAIChatsDir accepts a YMD string like dayDir', () => {
  assert({
    given: 'the same day as a string and as a PlainDate',
    should: 'build the same path',
    actual: dayAIChatsDir('2026-03-31'),
    expected: dayAIChatsDir(new PlainDate('2026-03-31')),
  })
})

test('dayAIChatsDir is relative to time/, ready to join with a time directory', () => {
  const rel = dayAIChatsDir(new PlainDate('2026-03-31'))

  assert({
    given: 'the built path',
    should: 'not start at the filesystem root',
    actual: rel.startsWith('/'),
    expected: false,
  })

  assert({
    given: 'the built path joined to a time directory',
    should: 'end in the actions and chats folders',
    actual: path.join('/notebook/time', rel).endsWith(`/${ACTIONS_DIR}/${AI_CHATS_DIR}`),
    expected: true,
  })
})
