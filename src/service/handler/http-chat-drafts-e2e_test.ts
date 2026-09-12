import { assert, test } from '#test'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const MESSAGE = [
  '> Please turn the plan into **clear next steps**.',
  '',
  'I can own the review.',
  'Keep this on its own line.',
  '',
  '---',
  '',
  '## Next steps',
  '',
  '- **Confirm** the owner.',
  '- Read [the proposal](https://example.com/proposal).',
  '',
  'Keep `status = ready` as code. Visit https://example.com/status.',
  '',
  '```slack',
  '*Literal source*',
  '```',
  '',
  '<span data-example="raw">Literal HTML</span>',
].join('\n')

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
  {
    name: 'chat messages and drafts stay readable and selectable through polling, replies, and reloads',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: '# Test notebook\n', tempPrefix: 'chat-drafts-', day: true },
      async ({ page, origin, errors }) => {
        let content = DRAFT
        let message = MESSAGE
        let submitted = ''
        let busy = true
        const approval = {
          id: 'email-draft',
          toolName: 'google_email_draft_new',
          lines: [
            '  Account: (default)',
            '  To:      Jane Doe &lt;jane@example.com&gt;',
            '  Subject: Atlas &amp; Widget-V2',
            '',
            '---',
            '',
            'Please review the proposal.',
            '',
            'Keep &lt;script&gt;alert(1)&lt;/script&gt; as text.',
          ],
        }
        const turns = () => [
          { role: 'user', content: message },
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
          route.fulfill({ json: { turns: turns(), documents: 0, kept: 0, busy, pending: [approval] } }),
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
          submitted = route.request().postDataJSON().message
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
        const user = page.locator('.sky-bubble-text.sky-rendered').first()
        const card = page.locator('.sky-ask')
        const preview = card.locator('.sky-ask-body.sky-rendered')
        await body.locator('strong').filter({ hasText: 'Atlas update' }).waitFor()
        assert({
          given: 'a Gmail approval with encoded recipient brackets and literal HTML',
          should: 'show the readable address and subject while keeping HTML inert',
          actual: {
            paragraphs: await preview.locator('p').allTextContents(),
            scripts: await preview.locator('script').count(),
          },
          expected: {
            paragraphs: [
              '  Account: (default)\n  To:      Jane Doe <jane@example.com>\n  Subject: Atlas & Widget-V2',
              'Please review the proposal.',
              'Keep <script>alert(1)</script> as text.',
            ],
            scripts: 0,
          },
        })
        await card.getByRole('button', { name: 'Raw', exact: true }).click()
        assert({
          given: 'the Raw view of the same approval',
          should: 'retain the original payload including its encoded characters',
          actual: await card.locator('pre.sky-ask-body').textContent(),
          expected: approval.lines.join('\n'),
        })
        await card.getByRole('button', { name: 'Rich', exact: true }).click()
        assert({
          given: 'a user message with Markdown, literal code, and HTML text',
          should: 'format the message inside its bubble without treating its code as an assistant draft',
          actual: {
            quote: await user.locator('blockquote strong').textContent(),
            heading: await user.getByRole('heading').textContent(),
            rule: await user.locator('hr').count(),
            items: await user.getByRole('listitem').count(),
            link: await user.getByRole('link', { name: 'the proposal' }).getAttribute('href'),
            bareLink: await user.getByRole('link', { name: 'https://example.com/status' }).getAttribute('href'),
            literal: await user.locator('pre code').textContent(),
            rawHtml: await user.locator('[data-example="raw"]').count(),
          },
          expected: {
            quote: 'clear next steps',
            heading: 'Next steps',
            rule: 1,
            items: 2,
            link: 'https://example.com/proposal',
            bareLink: 'https://example.com/status',
            literal: '*Literal source*',
            rawHtml: 0,
          },
        })
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

        for (const [surface, start, end] of [
          [body, 2, 3],
          [user, 0, 1],
          [preview, 0, 1],
        ] as const) {
          const selected = await surface.evaluate(
            (element, [start, end]) => {
              const paragraphs = element.querySelectorAll('p')
              const range = document.createRange()
              range.setStart(paragraphs[start]!.firstChild!, 4)
              range.setEnd(paragraphs[end]!.firstChild!, 20)
              const current = window.getSelection()!
              current.removeAllRanges()
              current.addRange(range)
              return current.toString()
            },
            [start, end],
          )
          await poll()
          assert({
            given: 'a selection spanning message paragraphs',
            should: 'survive a background refresh',
            actual: await selection(),
            expected: selected,
          })

          await surface.locator('p').nth(start).scrollIntoViewIfNeeded()
          const points = await surface.evaluate(
            (element, [start, end]) => {
              const paragraphs = element.querySelectorAll('p')
              const at = (node: Node, offset: number) => {
                const range = document.createRange()
                range.setStart(node, offset)
                range.setEnd(node, offset + 1)
                const rect = range.getBoundingClientRect()
                return { x: rect.x + 1, y: rect.y + rect.height / 2 }
              }
              return { from: at(paragraphs[start]!.firstChild!, 0), to: at(paragraphs[end]!.firstChild!, 20) }
            },
            [start, end],
          )
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
        }

        content = DRAFT.replace('Atlas update', 'Atlas updated draft')
        message = MESSAGE.replace('I can own the review.', 'I can own the final review.')
        approval.lines[2] = '  Subject: Atlas &amp; Widget-V2 revised'
        busy = false
        await body.locator('strong').filter({ hasText: 'Atlas updated draft' }).waitFor()
        await user.locator('p').filter({ hasText: 'I can own the final review.' }).waitFor()
        await preview.getByText('Subject: Atlas & Widget-V2 revised', { exact: false }).waitFor()
        await page.getByRole('textbox', { name: 'Message sky…', exact: true }).fill('Please **revise** the draft.')
        await page.getByRole('button', { name: 'Send', exact: true }).click()
        await page.getByText('Atlas revised update', { exact: true }).waitFor()
        assert({
          given: 'a newly submitted Markdown message',
          should: 'display formatting immediately and send the original source',
          actual: {
            emphasis: await page.locator('.sky-turn-user strong').last().textContent(),
            submitted,
          },
          expected: { emphasis: 'revise', submitted: 'Please **revise** the draft.' },
        })
        await page.reload()
        await page.getByText('Atlas revised update', { exact: true }).waitFor()
        await page.setViewportSize({ width: 390, height: 844 })
        assert({
          given: 'a changed draft, a completed reply, and a reload on a phone-sized viewport',
          should: 'retain rich formatting and readable line wrapping without browser errors',
          actual: {
            quotes: await body.locator('blockquote').count(),
            userQuote: await user.locator('blockquote strong').textContent(),
            userFits: await user.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
            fits: await fits(),
            errors,
          },
          expected: {
            quotes: 1,
            userQuote: 'clear next steps',
            userFits: true,
            fits: { body: true, code: true, wrapping: 'pre-wrap' },
            errors: [],
          },
        })
      },
    )
  },
)
