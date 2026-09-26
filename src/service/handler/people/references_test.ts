import { assert, test } from '#test'
import { pathOccurrences, renameNames, scanNames } from './references.ts'

const doh = (token: { text: string }) => token.text.toLowerCase() === 'jane doh'

test('renameNames changes only the names it picks, in every field shape, and leaves the text alone', () => {
  const raw = [
    '---',
    '# People named here',
    'who: Alex Kim, Jane Doh, Sam Rivera',
    'from: "Jane Doh"',
    'to: [Jane Doh, Sam Rivera]',
    'rel:',
    '  - Jane Doh',
    '  - projects/Atlas',
    'cc: Jane Dohson',
    '---',
    '',
    'Jane Doh said hello.',
    '',
  ].join('\n')
  const edit = renameNames(raw, 'person', doh, 'Jane Doe')
  assert({
    given: 'a comma list, a quoted value, a flow list, a block list, a longer name, a comment and body text',
    should: 'rename the four references in place and keep every other character',
    actual: [edit.contents, edit.changes.map((change) => change.field), edit.problem],
    expected: [
      [
        '---',
        '# People named here',
        'who: Alex Kim, Jane Doe, Sam Rivera',
        'from: "Jane Doe"',
        'to: [Jane Doe, Sam Rivera]',
        'rel:',
        '  - Jane Doe',
        '  - projects/Atlas',
        'cc: Jane Dohson',
        '---',
        '',
        'Jane Doh said hello.',
        '',
      ].join('\n'),
      ['who', 'from', 'to', 'rel'],
      undefined,
    ],
  })
})

test('renameNames refuses what it cannot write exactly', () => {
  const folded = '---\nwho: Alex Kim,\n  Jane Doh\n---\n'
  const plain = '---\nwho: Alex Kim, Jane Doh\n---\n'
  assert({
    given: 'a participant list written across lines, and a new name that would need quotes',
    should: 'report the field it cannot read exactly, and leave the file as it is with the reason',
    actual: [scanNames(folded, 'person').unreadable, renameNames(plain, 'person', doh, 'Doe: Jane')],
    expected: [
      ['who'],
      { contents: plain, changes: [], problem: 'Doe: Jane cannot be written into who here as it stands.' },
    ],
  })
})

test("renameNames reads a person's organizations only when renaming an organization", () => {
  const raw = [
    '---',
    'name: Sam Rivera',
    'org: Atlas Labs',
    'orgs:',
    '  current: [Atlas Labs]',
    '  past: [Cedar]',
    '---',
    '',
  ].join('\n')
  const labs = (token: { text: string }) => token.text === 'Atlas Labs'
  assert({
    given: 'an organization named in org and in the orgs lists',
    should: 'rename it in both for an organization, and only in org for a person',
    actual: [
      renameNames(raw, 'org', labs, 'Atlas Studio').changes.map((change) => change.field),
      renameNames(raw, 'person', labs, 'Atlas Studio').changes.map((change) => change.field),
    ],
    expected: [['org', 'orgs'], ['org']],
  })
})

test('pathOccurrences finds a file path only where it is written whole', () => {
  const from = 'people/2026/ja/Jane-Doh'
  const text = [
    '{"path":"people/2026/ja/Jane-Doh.md","tokens":85}',
    '{"path":"people/2026/ja/Jane-Doh-2.md","tokens":12}',
    'See [[people/2026/ja/Jane-Doh]] and archive/people/2026/ja/Jane-Doh.md.',
    '[Jane](/explorer/people/2026/ja/Jane-Doh.md) and /Notebook/people/2026/ja/Jane-Doh.md',
    'Filed as people/2026/ja/Jane-Doh.',
    'people/2026/ja/Jane-Doh.mdx',
  ].join('\n')
  const lines = pathOccurrences(text, from, ['/Notebook/', '/explorer/', '/docs/']).map(
    ({ start }) => text.slice(0, start).split('\n').length,
  )
  assert({
    given:
      "a log record, a namesake's record, a link, another folder's path, a Sky link, the notebook's own folder, a sentence and a longer extension",
    should: 'match the record, the link, the Sky link, the notebook path and the sentence, and nothing else',
    actual: lines,
    expected: [1, 3, 4, 4, 5],
  })
})
