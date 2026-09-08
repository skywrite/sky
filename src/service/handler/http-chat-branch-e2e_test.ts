import { assert, test } from '#test'
import type { BranchPoint } from './chat/branchPoint.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const FIRST: BranchPoint = { turn: 1, key: 'first-server-reply' }
const SECOND: BranchPoint = { turn: 2, key: 'second-server-reply' }
const FIRST_TURNS = [
  { role: 'user', content: 'Plan the Atlas launch.' },
  { role: 'assistant', content: 'Start with the demo.' },
]
const NEXT_TURNS = [
  ...FIRST_TURNS,
  { role: 'user', content: 'What comes next?' },
  { role: 'assistant', content: 'Assign an owner.' },
]
const CONFLICT =
  'This reply no longer matches the chat held by Sky. Keep this page open to preserve the messages shown here.'

test(
  {
    name: 'chat branches from the server reply after a restart leaves an interrupted reply on the page',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: '# Test notebook\n', tempPrefix: 'chat-branch-', day: true },
      async ({ page, origin, errors }) => {
        let sends = 0
        let refuse = true
        const requests: BranchPoint[] = []
        await page.route('**/chat', (route) => route.fulfill({ json: { threads: [] } }))
        await page.route('**/chat/**', async (route) => {
          const pathname = new URL(route.request().url()).pathname
          if (pathname.endsWith('/settings')) {
            return route.fulfill({
              json: {
                model: {
                  current: 'test',
                  default: 'test',
                  choices: [{ name: 'test', label: 'Test model', provider: 'Test', roles: ['Thinking'] }],
                },
                contextTokens: 0,
                saves: true,
                kept: 0,
                documents: 0,
              },
            })
          }
          if (pathname.endsWith('/messages')) {
            sends++
            // A closed stream with only partial text takes the actual reconnect
            // path. The following GET has recovered only the first exchange.
            const event = sends === 1 ? 'text-delta' : 'turn'
            const data =
              sends === 1 ? { text: 'An unfinished thought.' } : { text: 'Assign an owner.', branchPoint: SECOND }
            return route.fulfill({
              contentType: 'text/event-stream',
              body: `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            })
          }
          if (pathname.endsWith('/branch')) {
            requests.push(route.request().postDataJSON() as BranchPoint)
            return refuse
              ? route.fulfill({ status: 409, json: { message: CONFLICT } })
              : route.fulfill({ status: 201, json: { id: 'branch-child' } })
          }
          const child = pathname === '/chat/branch-child'
          return route.fulfill({
            json: {
              turns: sends < 2 ? FIRST_TURNS : NEXT_TURNS,
              branchPoints: sends < 2 ? [null, FIRST] : [null, FIRST, null, SECOND],
              documents: 0,
              kept: 0,
              busy: false,
              inherited: child ? 4 : 0,
              parent: child ? { id: 'parent', chat: 'mock-parent.md', turn: 2, title: 'Atlas launch' } : null,
              interrupted: sends === 1 ? { message: 'What comes next?' } : null,
            },
          })
        })
        await page.goto(`${origin}/thread/parent`)
        await page.getByText('Start with the demo.', { exact: true }).waitFor()
        // Exercise the supported popup-blocked fallback in this one page.
        await page.evaluate(() => {
          window.open = () => null
        })
        const composer = page.getByRole('textbox', { name: 'Message sky…', exact: true })
        await composer.fill('What comes next?')
        await page.getByRole('button', { name: 'Send', exact: true }).click()
        await page.getByText('turn failed — sky restarted while replying. Send it again.', { exact: true }).waitFor()
        await composer.fill('What comes next?')
        await page.getByRole('button', { name: 'Send', exact: true }).click()
        await page.getByText('Assign an owner.', { exact: true }).waitFor()
        const buttons = page.getByRole('button', { name: 'New chat from here…', exact: true })
        assert({
          given: 'two completed replies with an interrupted reply still displayed between them',
          should: 'offer branching only on completed replies while preserving the interrupted text',
          actual: {
            turns: await page.locator('.sky-turn').count(),
            branches: await buttons.count(),
            interrupted: await page.getByText('An unfinished thought.', { exact: true }).isVisible(),
          },
          expected: { turns: 6, branches: 2, interrupted: true },
        })
        await buttons.last().click()
        await page.getByText(`— Couldn't start a new chat from here — ${CONFLICT} —`, { exact: true }).waitFor()
        assert({
          given: 'the server refuses a stale branch reference',
          should: 'keep the existing conversation and explain the refusal',
          actual: { path: new URL(page.url()).pathname, turns: await page.locator('.sky-turn').count() },
          expected: { path: '/thread/parent', turns: 6 },
        })
        refuse = false
        await buttons.last().click()
        await page.waitForURL(`${origin}/thread/branch-child`)
        await page.getByText('Assign an owner.', { exact: true }).waitFor()
        assert({
          given: 'the third displayed reply belongs to the second server exchange',
          should: 'send the server reference on both attempts and open the branch with its inherited history',
          actual: {
            requests,
            inherited: await page.locator('.sky-turn[data-shared="true"]').count(),
            errors: errors.filter((error) => !error.includes('409')),
          },
          expected: { requests: [SECOND, SECOND], inherited: 4, errors: [] },
        })
      },
    )
  },
)
