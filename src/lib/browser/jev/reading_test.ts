import type { ResolvedModel } from '#shared/ai/models.ts'
import { assert, test } from '#test'
import { pageText, READING_INSTRUCTIONS, readPage } from './reading.ts'

const PAGE = `- Page URL: https://atlas.example/reports/orders
- Page Title: Orders by region - Atlas Analytics
- Viewport: 1280x900

\`\`\`yaml
- heading "Orders by region" [level=1] [ref=e2]
- button "Dismiss" [ref=e5] [cursor=pointer]
- table [ref=e9] [box=8,300,900,400]:
  - row "North 1,204 32%" [ref=e10]
  - row "South 980 26%" [ref=e11]
\`\`\``

test('the page goes to the reader without references, boxes or pointer hints, cut to fit', () => {
  const clean = pageText(PAGE)
  assert({
    given: 'a snapshot with element references, a box, a pointer hint and a viewport line',
    should: 'keep the words and structure only',
    actual: [/\[(ref|box|cursor)=/.test(clean), clean.includes('Viewport'), clean.includes('- row "South 980 26%"')],
    expected: [false, false, true],
  })
  assert({
    given: 'a page longer than the reading allows',
    should: 'cut it and say so',
    actual: pageText('x'.repeat(50), 20),
    expected: `${'x'.repeat(20)}\n… (the rest of the page was cut to fit)`,
  })
})

test('a reading answers from the page and never raises', async () => {
  const asked: { system: string; prompt: string }[] = []
  const read = await readPage({
    model: {} as ResolvedModel,
    goal: 'Open the orders report and tell me the top regions.',
    page: PAGE,
    outcome: 'The page did not change after 3 moves in a row.',
    reply: async (system, prompt) => {
      asked.push({ system, prompt })
      return '\nNorth: 1,204 orders (32%)\nSouth: 980 orders (26%)\n'
    },
  })
  assert({
    given: 'a task that stopped on a report page',
    should: 'send the task, how the moves ended and the clean page, and return the reply trimmed',
    actual: [
      asked[0]?.system === READING_INSTRUCTIONS,
      asked[0]?.prompt.startsWith('The task: Open the orders report and tell me the top regions.'),
      asked[0]?.prompt.includes('How the moves ended: The page did not change after 3 moves in a row.'),
      asked[0]?.prompt.includes('[ref='),
      read.text,
      read.failed,
    ],
    expected: [true, true, true, false, 'North: 1,204 orders (32%)\nSouth: 980 orders (26%)', undefined],
  })
  const failed = await readPage({
    model: {} as ResolvedModel,
    goal: 'Open the orders report and tell me the top regions.',
    page: PAGE,
    outcome: 'Jev judged the goal done (96%).',
    reply: async () => {
      throw new Error('The reply was not valid.')
    },
  })
  assert({
    given: 'a reader that fails with an error that is not network trouble',
    should: 'report the failure at once instead of raising it',
    actual: [failed.text, failed.failed],
    expected: ['', 'The reply was not valid.'],
  })
})
