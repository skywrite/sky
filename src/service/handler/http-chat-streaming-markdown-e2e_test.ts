import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { replyThreadTestHost } from './chat/replyThreadsTestHelpers.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const PARTS = [
  'The outline is **settled**.\n\nBreaking it into tabs: **Vis',
  'ion** and `sky day:st',
  'art`.\n\n- one\n- two',
]

test({ name: 'a reply reads as rendered markdown while it is being written', timeout: 90000 }, async (t) => {
  const gates = PARTS.slice(1).map(() => Promise.withResolvers<void>())
  await runWysiwygE2e(
    t,
    {
      initialMarkdown: '# Mock streaming notebook\n',
      tempPrefix: 'sky-chat-streaming-markdown-',
      chat: (base) =>
        replyThreadTestHost(base, {
          invokeModel: async ({ sink }) => {
            sink.write(PARTS[0]!)
            for (const [i, gate] of gates.entries()) {
              await gate.promise
              sink.write(PARTS[i + 1]!)
            }
            const text = PARTS.join('')
            return { text, content: [], steps: [], responseMessages: [{ role: 'assistant', content: text }] }
          },
        }),
    },
    async ({ page, origin, errors }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.goto(`${origin}/thread/streaming-markdown`)
      await page.getByRole('textbox', { name: 'Message sky…', exact: true }).fill('Break the page into tabs.')
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      const body = page.locator('[data-speaker="Sky"][data-streaming] .sky-rendered')
      const read = () =>
        body.evaluate((element) => ({
          text: (element as HTMLElement).innerText,
          bold: [...element.querySelectorAll('strong')].map((node) => node.textContent),
          code: [...element.querySelectorAll('code')].map((node) => node.textContent),
          carets: element.querySelectorAll('.sky-caret').length,
          caretIn: element.querySelector('.sky-caret')?.parentElement?.tagName,
        }))
      await body.locator('strong', { hasText: 'Vis' }).waitFor()
      assert({
        given: 'a reply that has stopped inside a bold phrase',
        should: 'show the phrase bold with the caret after it, and no raw marks',
        actual: await read(),
        expected: {
          text: 'The outline is settled.\n\nBreaking it into tabs: Vis',
          bold: ['settled', 'Vis'],
          code: [],
          carets: 1,
          caretIn: 'STRONG',
        },
      })
      const screenshot = env.get('SKY_BROWSER_SCREENSHOT')
      if (screenshot) await page.screenshot({ path: screenshot })

      // The paragraph already written keeps its nodes, so reading it is not interrupted by the words after it.
      const first = await body.locator('p').first().elementHandle()
      await first!.evaluate((paragraph) => {
        const range = document.createRange()
        range.selectNodeContents(paragraph)
        const selection = document.getSelection()!
        selection.removeAllRanges()
        selection.addRange(range)
      })
      gates[0]!.resolve()
      await body.locator('code', { hasText: 'sky day:st' }).waitFor()
      assert({
        given: 'more of the reply arriving while its first paragraph is selected',
        should: 'keep the selection and the paragraph, and show the next words formatted',
        actual: {
          selection: await page.evaluate(() => document.getSelection()?.toString()),
          kept: await first!.evaluate((paragraph) => paragraph.isConnected),
          ...(await read()),
        },
        expected: {
          selection: 'The outline is settled.',
          kept: true,
          text: 'The outline is settled.\n\nBreaking it into tabs: Vision and sky day:st',
          bold: ['settled', 'Vision'],
          code: ['sky day:st'],
          carets: 1,
          caretIn: 'CODE',
        },
      })
      if (screenshot) await page.screenshot({ path: screenshot.replace('.png', '-later.png') })

      gates[1]!.resolve()
      const done = page.locator('[data-speaker="Sky"]:not([data-streaming]) .sky-rendered')
      await done.locator('li', { hasText: 'two' }).waitFor()
      assert({
        given: 'the finished reply',
        should: 'show the whole reply rendered, without a caret or page errors',
        actual: {
          html: await done.innerHTML(),
          streaming: await body.count(),
          errors,
        },
        expected: {
          html: [
            '<p>The outline is <strong>settled</strong>.</p>',
            '<p>Breaking it into tabs: <strong>Vision</strong> and <code>sky day:start</code>.</p>',
            '<ul><li>one</li>\n<li>two</li></ul>',
          ].join('\n'),
          streaming: 0,
          errors: [],
        },
      })
      if (screenshot) await page.screenshot({ path: screenshot.replace('.png', '-done.png') })
    },
  )
})
