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

test('detectTypeFromPath - project overview paths are projects', () => {
  assert({
    given: 'a _project/overview.md path under a status dir',
    should: 'detect type project',
    actual: detectTypeFromPath('/nb/projects/open/Atlas/_project/overview.md'),
    expected: 'project',
  })
})

test('detectTypeFromPath - non-overview project files are documents', () => {
  assert({
    given: 'a markdown file in a project folder outside _project/',
    should: 'detect type document',
    actual: detectTypeFromPath('/nb/projects/open/Team-Survey/misc/to-go.md'),
    expected: 'document',
  })
})

test('detectTypeFromPath - project subdirs do not leak into later patterns', () => {
  assert({
    given: 'a project file under a subdir named like another pattern (meetings/)',
    should: 'detect type document, not meeting',
    actual: detectTypeFromPath('/nb/projects/completed/Skunkworks/meetings/kickoff-notes.md'),
    expected: 'document',
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
