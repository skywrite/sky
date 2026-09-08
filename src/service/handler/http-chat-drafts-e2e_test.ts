import { assert, test } from '#test'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DRAFT = [
  'Here is the draft:',
  '',
  '```',
  '*Atlas update*',
  '*============*',
  '',
  'The proposal is ready for review. '.repeat(10).trim(),
  '',
  'Please confirm the owner and the next step before we send it.',
  '',
  '1. Read <https://example.com/plan|the plan>.',
  '2. Confirm the owner.',
  '```',
  '',
  'A separate code example:',
  '',
  '```typescript',
  `const example = "${'literal_value_'.repeat(40)}"`,
  '```',
].join('\n')

test(
  { name: 'chat drafts stay readable and selectable through polling, replies, and reloads', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: '# Test notebook\n', tempPrefix: 'chat-drafts-', day: true },
      async ({ page, origin, errors }) => {
        let content = DRAFT
        let busy = true
        const turns = () => [
          { role: 'user', content: 'Draft an update for Atlas.' },
          { role: 'assistant', content },
        ]
        await page.route('**/chat', (route) =>
          route.fulfill({
            json: {
              threads: [
                { id: 'draft', title: 'Atlas update', day: '2026-01-27', when: '09:30', state: 'done', turns: 2 },
              ],
            },
          }),
        )
        await page.route('**/chat/draft', (route) =>
          route.fulfill({ json: { turns: turns(), documents: 0, kept: 0, busy } }),
        )
        await page.route('**/chat/draft/settings', (route) =>
          route.fulfill({
            json: {
              model: {
                current: 'test',
                default: 'test',
                choices: [{ name: 'test', label: 'Test model', provider: 'Test', roles: ['Thinking'] }],
              },
              contextTokens: 0,
              saves: false,
              kept: 0,
              documents: 0,
            },
          }),
        )
        await page.route('**/chat/draft/messages', (route) => {
          content = DRAFT.replace('Atlas update', 'Atlas revised update')
          return route.fulfill({
            contentType: 'text/event-stream',
            body: `event: turn\ndata: ${JSON.stringify({ text: content })}\n\n`,
          })
        })
        const poll = async () => {
          await page.waitForResponse((response) => new URL(response.url()).pathname === '/chat/draft')
          await page.evaluate(
            () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
          )
        }
        const selection = () => page.evaluate(() => window.getSelection()?.toString())
        const fits = () =>
          page
            .locator('.sky-body.sky-rendered')
            .last()
            .evaluate((body) => ({
              body: body.scrollWidth <= body.clientWidth + 1,
              code: [...body.querySelectorAll('pre')].every((pre) => pre.scrollWidth <= pre.clientWidth + 1),
              wrapping: getComputedStyle(body.querySelector('pre')!).whiteSpace,
            }))

        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.goto(`${origin}/thread/draft`)
        const body = page.locator('.sky-body.sky-rendered').first()
        await body.locator('strong').filter({ hasText: 'Atlas update' }).waitFor()
        assert({
          given: 'a saved reply containing a long fenced Slack draft beside real code',
          should: 'quote the formatted draft separately from commentary and wrap code inside the desktop column',
          actual: {
            quotes: await body.locator('blockquote').count(),
            subject: await body.locator('blockquote strong').textContent(),
            commentary: await body.locator(':scope > p').allTextContents(),
            lists: await body.locator('ol').count(),
            link: await body.getByRole('link', { name: 'the plan' }).getAttribute('href'),
            codeBlocks: await body.locator('pre').count(),
            underline: (await body.textContent())!.includes('============'),
            fits: await fits(),
          },
          expected: {
            quotes: 1,
            subject: 'Atlas update',
            commentary: ['Here is the draft:', 'A separate code example:'],
            lists: 1,
            link: 'https://example.com/plan',
            codeBlocks: 1,
            underline: false,
            fits: { body: true, code: true, wrapping: 'pre-wrap' },
          },
        })

        const selected = await body.evaluate((element) => {
          const paragraphs = element.querySelectorAll('p')
          const range = document.createRange()
          range.setStart(paragraphs[2]!.firstChild!, 4)
          range.setEnd(paragraphs[3]!.firstChild!, 20)
          const current = window.getSelection()!
          current.removeAllRanges()
          current.addRange(range)
          return current.toString()
        })
        await poll()
        assert({
          given: 'a selection spanning draft paragraphs',
          should: 'survive a background refresh',
          actual: await selection(),
          expected: selected,
        })

        await body.locator('p').nth(2).scrollIntoViewIfNeeded()
        const points = await body.evaluate((element) => {
          const paragraphs = element.querySelectorAll('p')
          const at = (node: Node, offset: number) => {
            const range = document.createRange()
            range.setStart(node, offset)
            range.setEnd(node, offset + 1)
            const rect = range.getBoundingClientRect()
            return { x: rect.x + 1, y: rect.y + rect.height / 2 }
          }
          return { from: at(paragraphs[2]!.firstChild!, 0), to: at(paragraphs[3]!.firstChild!, 20) }
        })
        await page.mouse.move(points.from.x, points.from.y)
        await page.mouse.down()
        await page.mouse.move(points.to.x, points.to.y, { steps: 10 })
        const dragged = await selection()
        await poll()
        await page.mouse.up()
        assert({
          given: 'a drag spanning paragraphs while the chat refreshes',
          should: 'keep the selected text after releasing the mouse',
          actual: { nonempty: Boolean(dragged), selected: await selection() },
          expected: { nonempty: true, selected: dragged },
        })

        content = DRAFT.replace('Atlas update', 'Atlas updated draft')
        busy = false
        await body.locator('strong').filter({ hasText: 'Atlas updated draft' }).waitFor()
        await page.getByRole('textbox', { name: 'Message sky…', exact: true }).fill('Revise the draft.')
        await page.getByRole('button', { name: 'Send', exact: true }).click()
        await page.getByText('Atlas revised update', { exact: true }).waitFor()
        await page.reload()
        await page.getByText('Atlas revised update', { exact: true }).waitFor()
        await page.setViewportSize({ width: 390, height: 844 })
        assert({
          given: 'a changed draft, a completed reply, and a reload on a phone-sized viewport',
          should: 'retain rich formatting and readable line wrapping without browser errors',
          actual: { quotes: await body.locator('blockquote').count(), fits: await fits(), errors },
          expected: { quotes: 1, fits: { body: true, code: true, wrapping: 'pre-wrap' }, errors: [] },
        })
      },
    )
  },
)
