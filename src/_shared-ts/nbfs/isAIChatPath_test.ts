import { assert, test } from '#test'
import isAIChatPath from './isAIChatPath.ts'

test('isAIChatPath recognises a saved chat wherever the path starts', () => {
  assert({
    given: 'an absolute path into the chats folder of a day',
    should: 'be a chat',
    actual: isAIChatPath('/notebook/time/2026/W14/03-31/actions/ai-chats/09-30_Atlas-Launch-Planning.md'),
    expected: true,
  })

  assert({
    given: 'a day-relative path, the form the day file links with',
    should: 'be a chat',
    actual: isAIChatPath('actions/ai-chats/09-30_Atlas-Launch-Planning.md'),
    expected: true,
  })

  assert({
    given: 'a branch, filed in the folder beside its parent',
    should: 'be a chat',
    actual: isAIChatPath(
      'time/2026/W14/03-31/actions/ai-chats/09-30_Atlas-Launch-Planning/10-05_Board-Prep-Instead.md',
    ),
    expected: true,
  })
})

test('isAIChatPath refuses what only resembles a chat', () => {
  assert({
    given: 'a message in the same day',
    should: 'not be a chat',
    actual: isAIChatPath('/notebook/time/2026/W14/03-31/actions/messages/09-30_slack_Jane-Doe.md'),
    expected: false,
  })

  assert({
    given: 'a file that carries the name of the chats folder',
    should: 'not be a chat, since only folder segments count',
    actual: isAIChatPath('/notebook/library/ai-chats.md'),
    expected: false,
  })

  assert({
    given: 'a folder whose name merely contains the name of the chats folder',
    should: 'not be a chat',
    actual: isAIChatPath('/notebook/time/2026/W14/03-31/actions/old-ai-chats/09-30_Atlas.md'),
    expected: false,
  })
})
