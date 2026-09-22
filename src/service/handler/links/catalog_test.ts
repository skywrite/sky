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

test('link type filters combine inclusively with search, date and self-exclusion', () => {
  const items: LinkItem[] = [
    {
      value: 'Jane Doe',
      title: 'Jane Doe',
      path: 'people/Jane.md',
      kind: 'person',
      summary: 'Atlas',
      date: '2026-01-28',
    },
    { value: 'projects/Atlas', title: 'Atlas', path: 'projects/open/Atlas', kind: 'project', date: '2026-01-28' },
    {
      value: 'Example Studio',
      title: 'Example Studio',
      path: 'orgs/Example.md',
      kind: 'org',
      summary: 'Atlas',
      date: '2026-01-28',
    },
    {
      value: 'projects/Widget-V2',
      title: 'Widget-V2',
      path: 'projects/open/Widget-V2',
      kind: 'project',
      date: '2026-01-27',
    },
  ]
  assert({
    given: 'People and Projects checked together',
    should: 'include either type while keeping the other filters conjunctive',
    actual: [
      searchLinks(items, '', ['person', 'project'], '', '').map((item) => item.value),
      searchLinks(items, 'Atlas', ['person', 'project'], '2026-01-28', 'projects/open/Atlas').map((item) => item.value),
      searchLinks(items, '', [], '', '').length,
    ],
    expected: [['projects/Atlas', 'Jane Doe', 'projects/Widget-V2'], ['Jane Doe'], 4],
  })
})

test('frequent entities lead browsing without crowding out recent records or exact search matches', () => {
  const entities: LinkItem[] = Array.from({ length: 45 }, (_, index) => ({
    value: `Person ${index}`,
    title: `Person ${index}`,
    path: `people/Person-${index}.md`,
    kind: 'person',
    linkCount: index + 1,
    date: '2025-01-01',
    summary: 'Atlas',
  }))
  const message: LinkItem = {
    value: 'messages/Atlas',
    title: 'Atlas',
    path: 'messages/Atlas.md',
    kind: 'message',
    date: '2026-01-28',
  }
  const items = [...entities, message]
  const all = searchLinks(items, '', [], '', '')
  assert({
    given: 'more than a page of frequently linked people and a recent message',
    should: 'promote six people in All, rank all people by frequency in People, and preserve name relevance',
    actual: [
      all.filter((item) => item.frequent).length,
      all[0]?.value,
      all[6]?.value,
      searchLinks(items, '', ['person'], '', '')
        .slice(0, 2)
        .map((item) => item.linkCount),
      searchLinks(items, 'Atlas', [], '', '')[0]?.value,
      searchLinks(items, '', ['message'], '', '')[0]?.frequent,
    ],
    expected: [6, 'Person 44', message.value, [45, 44], message.value, undefined],
  })
})

test('typed names favor entities and use link frequency within equally good name matches', () => {
  const items: LinkItem[] = [
    { value: 'Jane Adams', title: 'Jane Adams', path: 'people/Jane-Adams.md', kind: 'person', date: '2026-01-28' },
    {
      value: 'Jane Doe',
      title: 'Jane Doe',
      path: 'people/Jane-Doe.md',
      kind: 'person',
      date: '2025-01-01',
      linkCount: 20,
    },
    { value: 'Jane Studio', title: 'Jane Studio', path: 'orgs/Jane-Studio.md', kind: 'org', linkCount: 10 },
    {
      value: 'projects/Jane-Launch',
      title: 'Jane Launch',
      path: 'projects/open/Jane-Launch',
      kind: 'project',
      linkCount: 5,
    },
    {
      value: 'Alex Example',
      title: 'Alex Example',
      aliases: ['Jane'],
      path: 'people/Alex-Example.md',
      kind: 'person',
    },
    {
      value: 'messages/Follow-up',
      title: 'Jane follow-up',
      path: 'messages/Follow-up.md',
      kind: 'message',
      date: '2026-01-28',
    },
    {
      value: 'meetings/Review',
      title: 'Jane review',
      path: 'meetings/Review.md',
      kind: 'meeting',
      date: '2023-01-09',
    },
    {
      value: 'meetings/Jane',
      title: 'Equity review',
      aliases: ['Jane'],
      people: 'Jane Doe',
      path: 'meetings/Jane.md',
      kind: 'meeting',
      date: '2023-01-10',
    },
  ]
  assert({
    given: 'a first name shared by contacts, entities, titles and an old meeting filename',
    should: 'rank entity names first, break name-match ties by frequency, and keep recent related titles ahead',
    actual: searchLinks(items, 'Jane', [], '', '').map((item) => item.title),
    expected: [
      'Alex Example',
      'Jane Doe',
      'Jane Studio',
      'Jane Launch',
      'Jane Adams',
      'Jane follow-up',
      'Jane review',
      'Equity review',
    ],
  })
  assert({
    given: 'only People and Projects included in the same typed search',
    should: 'keep frequency ranking within the selected types',
    actual: searchLinks(items, 'Jane', ['person', 'project'], '', '').map((item) => item.title),
    expected: ['Alex Example', 'Jane Doe', 'Jane Launch', 'Jane Adams'],
  })
})

test('specific record searches beat incidental matches on frequently linked people', () => {
  const items: LinkItem[] = [
    {
      value: 'Jane Doe',
      title: 'Jane Doe',
      path: 'people/Jane-Doe.md',
      kind: 'person',
      summary: 'Equity planning',
      date: '2026-01-28',
      linkCount: 100,
    },
    {
      value: 'messages/Update',
      title: 'Jane update',
      path: 'messages/Update.md',
      kind: 'message',
      summary: 'Equity planning',
      date: '2026-01-27',
    },
    {
      value: 'meetings/Jane',
      title: 'Jane equity review',
      path: 'meetings/Jane.md',
      kind: 'meeting',
      aliases: ['Jane'],
      date: '2023-01-09',
    },
  ]
  assert({
    given: 'a name plus a specific topic or the complete record title',
    should: 'find the older meeting ahead of a frequently linked person with an incidental topic match',
    actual: ['Jane equity', 'Jane equity review'].map((query) => searchLinks(items, query, [], '', '')[0]?.title),
    expected: ['Jane equity review', 'Jane equity review'],
  })
})
