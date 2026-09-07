import { assert, test } from '#test'
import { searchLinks } from './catalog.ts'
import type { LinkItem } from './types.ts'

test('link search ranks names before newer matches in summaries and paths', () => {
  const items: LinkItem[] = [
    {
      value: 'Bob Example',
      title: 'Bob Example',
      path: 'people/Jay/Bob-Example.md',
      kind: 'person',
      date: '2026-01-28',
    },
    {
      value: 'Jane Doe',
      title: 'Jane Doe',
      path: 'people/Jane-Doe.md',
      kind: 'person',
      summary: 'Blue jay notes',
      date: '2026-01-27',
    },
    {
      value: 'Sanjay Example',
      title: 'Sanjay Example',
      path: 'people/Sanjay-Example.md',
      kind: 'person',
      date: '2026-01-26',
    },
    { value: 'Alex Jayden', title: 'Alex Jayden', path: 'people/Alex-Jayden.md', kind: 'person', date: '2026-01-25' },
    { value: 'Jayden Doe', title: 'Jayden Doe', path: 'people/Jayden-Doe.md', kind: 'person', date: '2026-01-24' },
    { value: 'Jay', title: 'Jay', path: 'people/Jay.md', kind: 'person', date: '2025-01-01' },
  ]
  assert({
    given: 'a short name with newer prefix, substring, summary and folder matches',
    should: 'put the exact name first, then name prefixes, then substrings, then context',
    actual: searchLinks(items, '  JAY  ', 'person', '', '').map((item) => item.title),
    expected: ['Jay', 'Jayden Doe', 'Alex Jayden', 'Sanjay Example', 'Bob Example', 'Jane Doe'],
  })
  assert({
    given: 'the same catalog with no query',
    should: 'keep browsing in date order',
    actual: searchLinks(items, '  ', 'person', '', '').map((item) => item.title),
    expected: items.map((item) => item.title),
  })
  assert({
    given: 'a multiword name typed in reverse order',
    should: 'match every term in the name',
    actual: searchLinks(items, 'doe jay', 'person', '', '').map((item) => item.title),
    expected: ['Jayden Doe', 'Jane Doe'],
  })
})

test('link search ranks a document title above contextual matches while retaining filters', () => {
  const items: LinkItem[] = [
    { value: 'notes/Atlas', path: 'notes/Atlas.md', title: 'Atlas review', kind: 'note', date: '2026-01-28' },
    {
      value: 'videos/Checklist',
      path: 'videos/Checklist.md',
      title: 'Checklist',
      people: 'Jane Doe',
      summary: 'Atlas review',
      kind: 'video',
      date: '2026-01-27',
    },
    {
      value: 'videos/Atlas',
      path: 'videos/Atlas.md',
      title: 'Atlas review',
      people: 'Jane Doe',
      kind: 'video',
      date: '2026-01-01',
    },
  ]
  assert({
    given: 'an older video whose title matches and a newer video whose summary matches',
    should: 'rank the title first and still find terms spread across title and people',
    actual: [
      searchLinks(items, 'atlas-review', 'video', '', '').map((item) => item.title),
      searchLinks(items, 'atlas jane', 'video', '', '').map((item) => item.title),
      searchLinks(items, 'atlas', 'video', '2026-01-27', '').map((item) => item.title),
      searchLinks(items, 'atlas', 'video', '', 'videos/Atlas.md').map((item) => item.title),
    ],
    expected: [['Atlas review', 'Checklist'], ['Checklist', 'Atlas review'], ['Checklist'], ['Checklist']],
  })
})
