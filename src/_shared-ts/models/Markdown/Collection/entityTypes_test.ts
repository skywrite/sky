/**
 * Tests for entity type detection from file paths.
 */

import { assert, test } from '#test'
import { detectTypeFromPath } from './entityTypes.ts'

test('detectTypeFromPath - ai-chats paths are chats', () => {
  assert({
    given: 'a day-nested ai-chats path',
    should: 'detect type chat',
    actual: detectTypeFromPath('/nb/time/2026/02/02-08/03/actions/ai-chats/09-15_Planning-the-Widget-Launch.md'),
    expected: 'chat',
  })
})

test('detectTypeFromPath - open-day ai-chats paths are chats', () => {
  assert({
    given: 'an ai-chats path under an open (x-prefixed) day dir',
    should: 'detect type chat',
    actual: detectTypeFromPath('/nb/time/2026/06/29-05/x04/actions/ai-chats/11-25_Some-Topic.md'),
    expected: 'chat',
  })
})

test('detectTypeFromPath - messages still detected alongside chat pattern', () => {
  assert({
    given: 'a messages path',
    should: 'detect type message',
    actual: detectTypeFromPath('/nb/time/2026/02/02-08/03/actions/messages/slack_Jane-to-Joe_Update.md'),
    expected: 'message',
  })
})

test('detectTypeFromPath - unmatched paths fall back to document', () => {
  assert({
    given: 'a path matching no pattern',
    should: 'detect type document',
    actual: detectTypeFromPath('/nb/time/2026/02/02-08/03/meeting_jane-doe.md'),
    expected: 'document',
  })
})
