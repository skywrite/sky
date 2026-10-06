import { assert, test } from '#test'
import { replyThreadTestHost } from './chat/replyThreadsTestHelpers.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const paragraphs = (label: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${label} ${index + 1}: The Atlas plan has another step to review.`).join(
    '\n\n',
  ) + '\n\n'

const PARTS = [
  paragraphs('Opening', 24),
  paragraphs('Following', 24),
  paragraphs('Still streaming', 24),
  paragraphs('Reading earlier', 12),
  paragraphs('Following again', 12),
  'The Atlas summary is complete.',
]

for (const surface of ['chat', 'reply', 'mobile'] as const) {
  test({ name: `${surface} lets readers scroll up during a streaming reply`, timeout: 60000 }, async (t) => {
    const gates = PARTS.slice(1).map(() => Promise.withResolvers<void>())
    let calls = 0
    try {
      await runWysiwygE2e(
        t,
        {
          initialMarkdown: '# Mock scrolling notebook\n',
          tempPrefix: 'sky-chat-scroll-',
          chat: (base) =>
            replyThreadTestHost(base, {
              invokeModel: async ({ sink }) => {
                if (surface === 'reply' && calls++ === 0) {
                  const text = 'The Atlas plan is ready to discuss.'
                  sink.write(text)
                  return { text, content: [], steps: [], responseMessages: [{ role: 'assistant', content: text }] }
                }
                sink.write(PARTS[0]!)
                for (const [index, gate] of gates.entries()) {
                  await gate.promise
                  sink.write(PARTS[index + 1]!)
                }
                const text = PARTS.join('')
                return { text, content: [], steps: [], responseMessages: [{ role: 'assistant', content: text }] }
              },
            }),
        },
        async ({ page, origin, errors }) => {
          await page.setViewportSize(surface === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 })
          await page.goto(`${origin}/thread/scrolling`)
          const main = page.locator('.sky-split-main')
          await main.getByRole('textbox', { name: 'Message sky…', exact: true }).fill('Review the Atlas plan.')
          await main.getByRole('button', { name: 'Send', exact: true }).click()
          if (surface === 'reply') {
            await main.getByText('The Atlas plan is ready to discuss.', { exact: true }).waitFor()
            await main.getByRole('button', { name: 'Work on this…', exact: true }).click()
            const panel = page.getByRole('complementary', { name: 'Thread', exact: true })
            await panel
              .getByRole('textbox', { name: 'Discuss or request changes…', exact: true })
              .fill('Expand the plan.')
            await panel.getByRole('button', { name: 'Send', exact: true }).click()
          }
          const selector = surface === 'reply' ? '.sky-reply-panel-scroll' : '.sky-split-main .sky-scroll'
          const scroll = page.locator(selector)
          const streaming = scroll.locator('[data-speaker="Sky"][data-streaming] .sky-rendered')
          const atBottom = () =>
            page.waitForFunction((selector) => {
              const area = document.querySelector(selector)!
              return area.scrollTop > 0 && area.scrollHeight - area.scrollTop - area.clientHeight <= 2
            }, selector)
          const position = () => scroll.evaluate((area) => area.scrollTop)
          const wheel = async (amount: number) => {
            const bounds = (await scroll.boundingBox())!
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
            await page.mouse.wheel(0, amount)
          }
          const scrollUp = async (amount: number) => {
            await wheel(-amount)
            await page.waitForFunction((selector) => {
              const area = document.querySelector(selector)!
              return area.scrollHeight - area.scrollTop - area.clientHeight > 20
            }, selector)
          }
          await streaming.getByText('Opening 24:', { exact: false }).waitFor()
          await atBottom()
          gates[0]!.resolve()
          await streaming.getByText('Following 24:', { exact: false }).waitFor()
          await atBottom()

          await scrollUp(80)
          const nearBottom = await position()
          const height = await scroll.evaluate((area) => area.scrollHeight)
          gates[1]!.resolve()
          await streaming.getByText('Still streaming 24:', { exact: false }).waitFor()
          assert({
            given: 'a small upward scroll while a response is streaming',
            should: 'keep the reading position while the response continues to grow',
            actual: {
              held: Math.abs((await position()) - nearBottom) <= 2,
              grew: (await scroll.evaluate((area) => area.scrollHeight)) > height,
            },
            expected: { held: true, grew: true },
          })

          await scroll.evaluate((area) => {
            area.scrollTop = 0
          })
          await page.waitForFunction((selector) => document.querySelector(selector)!.scrollTop === 0, selector)
          gates[2]!.resolve()
          await streaming.getByText('Reading earlier 12:', { exact: false }).waitFor()
          assert({
            given: 'scrolling to earlier content without the mouse wheel',
            should: 'keep that content in view as more text streams',
            actual: await position(),
            expected: 0,
          })

          await wheel(100000)
          await atBottom()
          gates[3]!.resolve()
          await streaming.getByText('Following again 12:', { exact: false }).waitFor()
          await atBottom()

          await scrollUp(80)
          const beforeFinish = await position()
          gates[4]!.resolve()
          await scroll
            .locator('[data-speaker="Sky"]:not([data-streaming])')
            .getByText('The Atlas summary is complete.')
            .waitFor()
          assert({
            given: 'the response finishes while the reader has scrolled up again',
            should: 'finish in place with no browser errors',
            actual: { held: Math.abs((await position()) - beforeFinish) <= 2, errors },
            expected: { held: true, errors: [] },
          })
        },
      )
    } finally {
      for (const gate of gates) gate.resolve()
    }
  })
}
