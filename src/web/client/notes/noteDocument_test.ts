import { assert, test } from '#test'
import {
  BLANK_NOTE,
  frontmatterOf,
  hasBody,
  insertOptions,
  noteTimeOf,
  noteTitleOf,
  saveDelay,
  slashQuery,
} from './noteDocument.ts'
import { noteHref, noteHrefOf, noteRouteOf } from './noteRoute.ts'

test('a note page names its day and its file, and a day’s note file names its page', () => {
  assert({
    given: 'a note page, a blank one, a name with a space, another page, and note and meeting files',
    should: 'read the day and name, encode the name, and link only a day’s note',
    actual: [
      noteRouteOf('/2026-10-28/notes/Atlas-launch-plan'),
      noteRouteOf('/2026-10-28/notes/new'),
      noteHref('2026-10-28', 'Board prep'),
      noteRouteOf('/2026-10-28/meetings/x'),
      noteHrefOf('time/2026/W44/10-28/actions/notes/Atlas-launch-plan.md'),
      noteHrefOf('time/2026/W44/10-28/actions/meetings/Atlas.md'),
    ],
    expected: [
      { ymd: '2026-10-28', slug: 'Atlas-launch-plan' },
      { ymd: '2026-10-28', slug: 'new' },
      '/2026-10-28/notes/Board%20prep',
      null,
      '/2026-10-28/notes/Atlas-launch-plan',
      null,
    ],
  })
})

test('a note’s title, body, time, and when its first save happens', () => {
  const titled = '---\ntype: Notes\n---\n\n# The **Atlas** plan\n\n'
  const written = '---\ntype: Notes\nwhen: 10:30\n---\n\n# Atlas\n\nLaunch moves.\n'
  assert({
    given: 'a blank note, one with only a title, one with a title and a line, and one with a line and no title',
    should: 'wait while blank, give a title time to finish, save a body soon, and always save soon once it has a file',
    actual: [
      [noteTitleOf(BLANK_NOTE), hasBody(BLANK_NOTE), saveDelay(BLANK_NOTE, false)],
      [noteTitleOf(titled), hasBody(titled), saveDelay(titled, false)],
      [noteTitleOf(written), hasBody(written), saveDelay(written, false), noteTimeOf(frontmatterOf(written))],
      [hasBody('# \n\nCalled Jamal\n'), saveDelay('# \n\nCalled Jamal\n', false), saveDelay(BLANK_NOTE, true)],
    ],
    expected: [
      ['', false, null],
      ['The Atlas plan', false, 2500],
      ['Atlas', true, 800, '10:30'],
      [true, 800, 800],
    ],
  })
})

test('the "/" a line types asks for a block, and the words after it narrow the choices', () => {
  assert({
    given: 'a lone slash, one with words, one inside a sentence, one with the caret back, and a long run',
    should: 'ask only when the slash starts the line and the caret ends it',
    actual: [
      slashQuery('/', 1),
      slashQuery('/ta', 3),
      slashQuery('and/or', 6),
      slashQuery('/ta', 1),
      slashQuery(`/${'x'.repeat(30)}`, 31),
    ],
    expected: ['', 'ta', null, null, null],
  })
  assert({
    given: 'nothing typed, "ta", "todo", "h2", "list", and words nothing answers',
    should: 'offer everything, then what the words name, names before the words people type for them',
    actual: [
      insertOptions('').length,
      insertOptions('ta').map((option) => option.label),
      insertOptions('todo').map((option) => option.label),
      insertOptions('h2').map((option) => option.label),
      insertOptions('list').map((option) => option.label),
      insertOptions('zebra'),
    ],
    expected: [
      12,
      ['Table', 'Checklist'],
      ['Checklist'],
      ['Heading 2'],
      ['Bulleted list', 'Numbered list', 'Checklist'],
      [],
    ],
  })
})
