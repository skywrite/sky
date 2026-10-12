import { assert, test } from '#test'
import {
  addAttachment,
  addKey,
  attachmentNames,
  isEmptyFrontmatter,
  readFrontmatter,
  removeAttachment,
  removeKey,
  writeChildValue,
  writeValue,
} from './model.ts'

const CAPTURE = `when: 2026-08-05 10:15 - 11:25
who: Jane Doe, Sam Park
medium: meeting
# kept as written
tags: atlas; planning
rel:
  - Jane Doe
  - Atlas
attachments:
  - { file: "report.pdf" }
summary: Agreed the launch moves.
created: 2026-08-05
`

test({ name: 'frontmatter model - the notebook shapes read as typed rows' }, () => {
  const { rows, error } = readFrontmatter(CAPTURE)
  assert({
    given: 'a day capture with the shapes the notebook writes',
    should: 'give each key its kind, chips for people, tags, rel and files, text otherwise',
    actual: [error, rows.map((row) => [row.key, row.kind, row.value])],
    expected: [
      undefined,
      [
        ['when', 'date', '2026-08-05 10:15 - 11:25'],
        ['who', 'people', ['Jane Doe', 'Sam Park']],
        ['medium', 'picker', 'meeting'],
        ['tags', 'tags', ['atlas', 'planning']],
        ['rel', 'rel', ['Jane Doe', 'Atlas']],
        ['attachments', 'files', ['report.pdf']],
        ['summary', 'long', 'Agreed the launch moves.'],
        ['created', 'auto', '2026-08-05'],
      ],
    ],
  })
  const person = readFrontmatter(
    'name: Jane Doe\nemail:\n  work: jane@acme.example\n  personal: jane@example.com\nmet: 2021\n',
  )
  assert({
    given: 'a person with a nested email map',
    should: 'show the map as sub-rows',
    actual: person.rows.map((row) => [
      row.key,
      row.kind,
      row.children?.map((child) => [child.key, child.value]) ?? row.value,
    ]),
    expected: [
      ['name', 'text', 'Jane Doe'],
      [
        'email',
        'map',
        [
          ['work', 'jane@acme.example'],
          ['personal', 'jane@example.com'],
        ],
      ],
      ['met', 'date', '2021'],
    ],
  })
  assert({
    given: 'YAML that does not parse, and no YAML at all',
    should: 'report the error, and give no rows',
    actual: [readFrontmatter('who: [a\n').error !== undefined, readFrontmatter('').rows, isEmptyFrontmatter('')],
    expected: [true, [], true],
  })
})

test({ name: 'frontmatter model - a change rewrites only its key, in the shape the notebook writes' }, () => {
  const withSam = writeValue(CAPTURE, 'who', 'people', ['Jane Doe', 'Sam Park', 'Ava Li'])
  const withTag = writeValue(CAPTURE, 'tags', 'tags', ['atlas', 'planning', 'q3'])
  const withRel = writeValue(CAPTURE, 'rel', 'rel', ['Jane Doe'])
  const withFile = writeValue(CAPTURE, 'attachments', 'files', ['report.pdf', 'whiteboard.png'])
  const withoutFile = writeValue(CAPTURE, 'attachments', 'files', [])
  const withSummary = writeValue(CAPTURE, 'summary', 'long', 'Rewritten.')
  const cleared = writeValue(CAPTURE, 'medium', 'picker', '')
  assert({
    given: 'people, tags, rel, files and text changed one at a time',
    should:
      'write one-line people, a `;` tag line, a rel list, `{ file }` entries, and plain text — the comment and the other lines untouched',
    actual: [withSam, withTag, withRel, withFile, withoutFile, withSummary, cleared].map((out) =>
      out.replace(CAPTURE.split('\n').slice(0, 1).join('\n'), ''),
    ),
    expected: [
      CAPTURE.replace('who: Jane Doe, Sam Park', 'who: Jane Doe, Sam Park, Ava Li').slice(
        'when: 2026-08-05 10:15 - 11:25'.length,
      ),
      CAPTURE.replace('tags: atlas; planning', 'tags: atlas; planning; q3').slice(
        'when: 2026-08-05 10:15 - 11:25'.length,
      ),
      CAPTURE.replace('rel:\n  - Jane Doe\n  - Atlas', 'rel:\n  - Jane Doe').slice(
        'when: 2026-08-05 10:15 - 11:25'.length,
      ),
      CAPTURE.replace('  - { file: "report.pdf" }', '  - { file: "report.pdf" }\n  - { file: "whiteboard.png" }').slice(
        'when: 2026-08-05 10:15 - 11:25'.length,
      ),
      CAPTURE.replace('attachments:\n  - { file: "report.pdf" }', 'attachments: []').slice(
        'when: 2026-08-05 10:15 - 11:25'.length,
      ),
      CAPTURE.replace('summary: Agreed the launch moves.', 'summary: Rewritten.').slice(
        'when: 2026-08-05 10:15 - 11:25'.length,
      ),
      CAPTURE.replace('medium: meeting', 'medium:').slice('when: 2026-08-05 10:15 - 11:25'.length),
    ],
  })
  assert({
    given: 'a key removed, a new key added, a sub-key set, and a first key in an empty block',
    should: 'drop the key, append the key empty, set the sub-key, and start the map',
    actual: [
      removeKey(CAPTURE, 'medium'),
      addKey('tags: a\n', 'rel', 'rel'),
      writeChildValue('email:\n  work: old@example.com\n', 'email', 'work', 'new@example.com'),
      writeValue('', 'tags', 'tags', ['first']),
      addKey('tags: a\n', 'tags', 'tags'),
    ],
    expected: [
      CAPTURE.replace('medium: meeting\n', ''),
      'tags: a\nrel: []\n',
      'email:\n  work: new@example.com\n',
      'tags: first\n',
      'tags: a\n',
    ],
  })
})

test({ name: 'frontmatter model - a file joins and leaves the attachments list in the notebook shape' }, () => {
  const added = addAttachment(CAPTURE, 'deck.pdf')
  const fresh = addAttachment('title: Notes\n', 'chart.png')
  const first = addAttachment('', 'chart.png')
  assert({
    given: 'a file added to a capture, to a block without the key, and to no block at all',
    should: 'append a `{ file }` entry after the ones there, create the key at the end, or start the block with it',
    actual: [
      added,
      attachmentNames(added),
      fresh,
      first,
      addAttachment(added, 'deck.pdf') === added,
      removeAttachment(added, 'deck.pdf') === CAPTURE,
      removeAttachment(CAPTURE, 'nothing.pdf') === CAPTURE,
    ],
    expected: [
      CAPTURE.replace('  - { file: "report.pdf" }\n', '  - { file: "report.pdf" }\n  - { file: "deck.pdf" }\n'),
      ['report.pdf', 'deck.pdf'],
      'title: Notes\nattachments:\n  - { file: "chart.png" }\n',
      'attachments:\n  - { file: "chart.png" }\n',
      true,
      true,
      true,
    ],
  })
})
