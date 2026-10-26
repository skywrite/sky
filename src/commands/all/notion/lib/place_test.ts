import type { NotionTarget, NotionTeamspace } from '#lib/notion/mod.ts'
import { assert, test } from '#test'
import { type Finder, placeFor } from './place.ts'

const PAGE = 'https://app.notion.com/p/0123456789abcdef0123456789abcdef'
const TABLE = 'https://app.notion.com/p/fedcba9876543210fedcba9876543210'
const TWO_SOURCES = 'https://app.notion.com/p/00000000000000000000000000000002'
const VIEW = 'https://app.notion.com/p/00000000000000000000000000000003'

const teams: NotionTeamspace[] = [
  { id: 't-1', name: 'Engineering', joined: true },
  { id: 't-2', name: 'Engineering Ops', joined: true },
  { id: 't-3', name: 'Design', joined: false },
  { id: 't-4', name: 'Design', joined: true },
]

/** A workspace with one page, two tables, a saved view, and the teamspaces above; searches match by substring. */
const finder: Finder = {
  target: async (id: string): Promise<NotionTarget> => {
    if (id === PAGE) return { kind: 'page', id: '0123456789abcdef0123456789abcdef', title: 'Atlas' }
    if (id === TABLE) return { kind: 'table', title: 'Atlas tasks', dataSources: [{ id: 'ds-1', titleColumn: 'Task' }] }
    if (id === TWO_SOURCES) return { kind: 'table', title: 'Roadmap', dataSources: [{ id: 'ds-2' }, { id: 'ds-3' }] }
    return { kind: 'other', ...(id === VIEW ? { title: 'Board' } : {}) }
  },
  teamspaces: async (query?: string) =>
    teams.filter((team) => !query || team.name.toLowerCase().includes(query.toLowerCase())),
}

test('notion place - a link is a sub-page or a row, other words a teamspace, and nothing a private page', async () => {
  assert({
    given: 'no parent, a page’s link, a table’s link, and a teamspace named exactly but for case',
    should: 'make it private, a sub-page, a row with the table’s title column, and a page at the teamspace’s top',
    actual: [
      await placeFor(finder, '  '),
      await placeFor(finder, PAGE),
      await placeFor(finder, TABLE),
      await placeFor(finder, 'engineering'),
    ],
    expected: [
      { where: 'as a private page' },
      { parent: { page: '0123456789abcdef0123456789abcdef' }, where: 'under “Atlas”' },
      { parent: { dataSource: 'ds-1' }, where: 'as a row in “Atlas tasks”', titleColumn: 'Task' },
      { parent: { teamspace: 't-1' }, where: 'at the top of the Engineering teamspace' },
    ],
  })
})

test('notion place - a place it cannot tell is a sentence that says what to pass instead', async () => {
  assert({
    given: 'a table with two sources, a saved view, two teamspaces sharing a name, several partial matches, none',
    should: 'list the sources, say the link is not a page, take the person’s own teamspace, and name the choices',
    actual: [
      await placeFor(finder, TWO_SOURCES),
      await placeFor(finder, VIEW),
      await placeFor(finder, 'Design'),
      await placeFor(finder, 'Eng'),
      await placeFor(finder, 'Finance'),
    ],
    expected: [
      '“Roadmap” has more than one data source. Pass the one the row belongs in: collection://ds-2, collection://ds-3.',
      'That link is not a Notion page or table (“Board”).',
      { parent: { teamspace: 't-4' }, where: 'at the top of the Design teamspace' },
      'More than one teamspace matches “Eng”: Engineering, Engineering Ops. Say which one.',
      'No teamspace is named “Finance”. Teamspaces you are in include Engineering, Engineering Ops, Design. ' +
        'To put it under a page instead, pass the page’s link.',
    ],
  })
})
