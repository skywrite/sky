import { assert, test } from '#test'
import type { SearchResponse } from '../search/types.ts'
import { notebookSearchTool, SEARCH_NOTEBOOK_TOOL } from './notebookSearch.ts'

const RESPONSE: SearchResponse = {
  query: 'atlas',
  total: 14,
  offset: 0,
  today: '2026-03-12',
  dayItems: [],
  results: [
    {
      relativePath: 'time/2026/W11/03-11/actions/meetings/10-00_Zoom_Jane-Doe_Atlas-review.md',
      href: '/explorer/x',
      title: 'Atlas review',
      kind: 'meeting',
      date: '2026-03-11',
      snippet: 'We agreed to   ship the Atlas plan\non Friday.',
      properties: [{ label: 'Who', value: 'Jane Doe' }],
    },
    {
      relativePath: 'projects/open/Atlas/README.md',
      href: '/explorer/y',
      title: 'Atlas',
      kind: 'project',
      properties: [],
    },
  ],
}

test('search_notebook asks the service index and answers with full paths a narrow read can open', async () => {
  const asked: string[] = []
  const tool = notebookSearchTool({
    port: 9999,
    notebookDir: '/notebook',
    fetcher: async (url) => {
      asked.push(url)
      return Response.json(RESPONSE)
    },
  })
  const output = await tool.run({ query: ' atlas ', kind: 'meeting', newest: true, limit: 50 })
  assert({
    given: 'a query filtered to meetings, newest first, asking for more than the limit allows',
    should: 'send one bounded request and list each result with its absolute path, kind, date and snippet',
    actual: { name: tool.definition.name, asked, output },
    expected: {
      name: SEARCH_NOTEBOOK_TOOL,
      asked: ['http://localhost:9999/search/_api?q=atlas&limit=20&kind=meeting&sort=newest'],
      output: [
        '14 matches for "atlas" in meeting records newest first (showing 2). Today is 2026-03-12.',
        '1. meeting · 2026-03-11 · Atlas review',
        '   path: /notebook/time/2026/W11/03-11/actions/meetings/10-00_Zoom_Jane-Doe_Atlas-review.md',
        '   Who: Jane Doe',
        '   snippet: We agreed to ship the Atlas plan on Friday.',
        '2. project · Atlas',
        '   path: /notebook/projects/open/Atlas/README.md',
      ].join('\n'),
    },
  })
})

test('search_notebook says what it needs, and passes on the index being unavailable', async () => {
  const tool = notebookSearchTool({
    port: 9999,
    notebookDir: '/notebook',
    fetcher: async () =>
      Response.json({ message: 'The notebook search is still loading. Try again shortly.' }, { status: 503 }),
  })
  assert({
    given: 'no query and no kind, then an index that is still loading',
    should: 'ask for a query without calling the service, then report the service’s reason',
    actual: [await tool.run({}), await tool.run({ query: 'atlas' })],
    expected: [
      'Give a query, or a kind with newest, to search the notebook.',
      'The notebook search could not answer (503): The notebook search is still loading. Try again shortly. If it keeps failing, use ai_research.',
    ],
  })
})

test('search_notebook names an unknown kind instead of searching everything', async () => {
  const asked: string[] = []
  const tool = notebookSearchTool({
    port: 9999,
    notebookDir: '/notebook',
    fetcher: async (url) => {
      asked.push(url)
      return Response.json(RESPONSE)
    },
  })
  const output = (await tool.run({ query: 'atlas', kind: 'meetings' })) as string
  assert({
    given: 'a kind that does not exist',
    should: 'ask for a real kind without calling the service',
    actual: { asked, start: output.split(':')[0], listsMeeting: output.includes('meeting') },
    expected: { asked: [], start: 'There is no "meetings" kind. Use one of', listsMeeting: true },
  })
})

test("a date search adds the day's record and its other records only when the results do not already hold them", async () => {
  const message = {
    relativePath: 'time/2026/W11/03-11/actions/messages/09-10_email_Jane-Doe.md',
    href: '/explorer/z',
    title: 'Atlas contract',
    kind: 'message' as const,
    date: '2026-03-11',
    properties: [],
  }
  const dated: SearchResponse = {
    ...RESPONSE,
    query: '2026-03-11',
    day: { ...RESPONSE.results[0]!, kind: 'day', relativePath: 'time/2026/W11/03-11/day.md', title: 'Wednesday' },
    dayItems: [RESPONSE.results[0]!, message],
  }
  const output = (await notebookSearchTool({
    port: 9999,
    notebookDir: '/notebook',
    fetcher: async () => Response.json(dated),
  }).run({ query: '2026-03-11', kind: 'meeting' })) as string
  assert({
    given: "a date search whose results already hold one of the day's records",
    should: 'name the day record and the record not already listed, with its kind and path, and nothing twice',
    actual: [
      output.includes('Day record: /notebook/time/2026/W11/03-11/day.md'),
      output.includes(
        'Other records dated that day:\n- message · Atlas contract (path: /notebook/time/2026/W11/03-11/actions/messages/09-10_email_Jane-Doe.md)',
      ),
      output.split('Atlas review').length - 1,
      output.includes('Items on that day'),
    ],
    expected: [true, true, 1, false],
  })
})
