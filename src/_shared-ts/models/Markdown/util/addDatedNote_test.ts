import { assert, test } from '#test'
import addDatedNote from './addDatedNote.ts'

test('addDatedNote starts a Notes section at the end when there is none', () => {
  assert({
    given: 'a new profile body, with or without a final line break',
    should: 'add ## Notes after everything, with the day as its first entry',
    actual: [
      addDatedNote('# Jane Doe\n\n## Background', '2026-10-01', 'Met at the Atlas launch.'),
      addDatedNote('# Jane Doe\n\n## Background\n', '2026-10-01', ' Met at the Atlas launch.\n'),
    ],
    expected: [
      '# Jane Doe\n\n## Background\n\n## Notes\n\n### 2026-10-01\n\nMet at the Atlas launch.\n',
      '# Jane Doe\n\n## Background\n\n## Notes\n\n### 2026-10-01\n\nMet at the Atlas launch.\n',
    ],
  })
})

test('addDatedNote puts the newest day first and keeps a day together', () => {
  const notes = '# Jane Doe\n\n## Notes\n\n### 2026-10-01\n\nFirst.\n\n### 2026-09-01\n\nOlder.\n'
  assert({
    given: 'a note on a newer day',
    should: 'add that day above the older ones',
    actual: addDatedNote('# Jane Doe\n\n## Notes\n\n### 2026-09-01\n\nOlder.\n', '2026-10-01', 'Moved to Atlas.'),
    expected: '# Jane Doe\n\n## Notes\n\n### 2026-10-01\n\nMoved to Atlas.\n\n### 2026-09-01\n\nOlder.\n',
  })
  assert({
    given: 'a second note on a day that already has one',
    should: "add it after that day's notes, under the same heading",
    actual: addDatedNote(notes, '2026-10-01', 'Second.'),
    expected: '# Jane Doe\n\n## Notes\n\n### 2026-10-01\n\nFirst.\n\nSecond.\n\n### 2026-09-01\n\nOlder.\n',
  })
  assert({
    given: 'a day newer than today already in the list',
    should: 'keep the days in order, newest first',
    actual: addDatedNote('## Notes\n\n### 2026-12-25\n\nLater.\n\n### 2026-09-01\n\nOlder.\n', '2026-10-01', 'Now.'),
    expected: '## Notes\n\n### 2026-12-25\n\nLater.\n\n### 2026-10-01\n\nNow.\n\n### 2026-09-01\n\nOlder.\n',
  })
})

test('addDatedNote leaves every other line as it was', () => {
  assert({
    given: 'a Notes section between other sections, holding undated text',
    should: 'add the day inside Notes, below the undated text, and change nothing else',
    actual: addDatedNote(
      '# Jane Doe\n\nLead line.\n\n## Notes\n\nLikes coffee.\n\n## Info\n\n- jane@example.com\n\n\n',
      '2026-10-01',
      'Prefers tea now.',
    ),
    expected:
      '# Jane Doe\n\nLead line.\n\n## Notes\n\nLikes coffee.\n\n### 2026-10-01\n\nPrefers tea now.\n\n## Info\n\n- jane@example.com\n\n\n',
  })
  assert({
    given: 'hand-written headings with no blank lines between them',
    should: 'space out only the new lines',
    actual: addDatedNote('## Notes\n### 2026-09-01\nOld.\n## Info\n', '2026-10-01', 'New.'),
    expected: '## Notes\n\n### 2026-10-01\n\nNew.\n\n### 2026-09-01\nOld.\n## Info\n',
  })
  assert({
    given: 'a Notes heading inside a code block, and a blank note',
    should: 'not mistake the code for the section, and leave the document alone for nothing to add',
    actual: [
      addDatedNote('# Jane Doe\n\n```md\n## Notes\n```\n', '2026-10-01', 'Real note.'),
      addDatedNote('# Jane Doe\n', '2026-10-01', '  \n'),
    ],
    expected: ['# Jane Doe\n\n```md\n## Notes\n```\n\n## Notes\n\n### 2026-10-01\n\nReal note.\n', '# Jane Doe\n'],
  })
})
