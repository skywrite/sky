import { assert, test } from '#test'
import { replyThreadTestHost, type ReplyTestCall } from './chat/replyThreadsTestHelpers.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

test(
  {
    name: 'five-document review continues in a Slack-style response thread with independent agent work',
    timeout: 60000,
  },
  async (t) => {
    let release!: () => void
    let started!: () => void
    const startedDraft = new Promise<void>((resolve) => {
      started = resolve
    })
    const drafting = new Promise<void>((resolve) => {
      release = resolve
    })
    let firstDraft = true
    const calls: ReplyTestCall[] = []
    try {
      await runWysiwygE2e(
        t,
        {
          initialMarkdown: '# Mock review notebook\n',
          tempPrefix: 'sky-reply-ui-',
          day: true,
          chat: (base) =>
            replyThreadTestHost(base, {
              calls,
              wait: async (call) => {
                if (call.reply && firstDraft) {
                  firstDraft = false
                  started()
                  await drafting
                }
              },
            }),
        },
        async ({ page, origin, errors }) => {
          await page.setViewportSize({ width: 1600, height: 1050 })
          await page.goto(`${origin}/thread/review`)
          const main = page.locator('.sky-split-main')
          const mainComposer = main.getByRole('textbox', { name: 'Message sky…', exact: true })
          await mainComposer.fill('Review these five related mock contracts together.')
          await main.locator('input[type="file"]').setInputFiles(
            ['A', 'B', 'C', 'D', 'E'].map((letter) => ({
              name: `mock-contract-${letter}.md`,
              mimeType: 'text/markdown',
              buffer: Buffer.from(`# Mock contract ${letter}\n\nThe shared term is Widget.`),
            })),
          )
          await main.getByRole('button', { name: 'Send', exact: true }).click()
          await main.getByText('All five agreements have been reviewed together.', { exact: true }).waitFor()
          await mainComposer.fill('A main-chat draft that must survive opening and closing the thread.')
          await main.getByRole('button', { name: 'Work on this…', exact: true }).click()
          const panel = page.getByRole('complementary', { name: 'Thread', exact: true })
          const replyComposer = panel.getByRole('textbox', { name: 'Discuss or request changes…', exact: true })
          await replyComposer.waitFor()
          const boxes = await Promise.all([main.boundingBox(), panel.boundingBox()])
          assert({
            given: 'Work on this on the combined review',
            should: 'open beside the original conversation with its own focused composer and no nested-thread actions',
            actual: {
              sideBySide: boxes[0]!.x + boxes[0]!.width <= boxes[1]!.x + 1,
              focused: await replyComposer.evaluate((element) => element === document.activeElement),
              nested: await panel.getByRole('button', { name: 'Work on this…', exact: true }).count(),
              source: await panel
                .getByText('All five agreements have been reviewed together.', { exact: true })
                .count(),
              earlierUser: await panel
                .getByText('Review these five related mock contracts together.', { exact: true })
                .count(),
            },
            expected: { sideBySide: true, focused: true, nested: 0, source: 1, earlierUser: 0 },
          })
          await replyComposer.fill('Draft a response to the team in my voice based on the five reviews.')
          await panel.getByRole('button', { name: 'Send', exact: true }).click()
          await startedDraft
          await panel.getByRole('button', { name: 'Close thread', exact: true }).click()
          assert({
            given: 'closing a thread while its specialist runs',
            should: 'keep the parent draft intact and the refinement out of the main transcript',
            actual: {
              draft: await mainComposer.inputValue(),
              leaked: await main
                .getByText('Draft a response to the team in my voice based on the five reviews.', { exact: true })
                .count(),
            },
            expected: { draft: 'A main-chat draft that must survive opening and closing the thread.', leaked: 0 },
          })
          await main.locator('.sky-reply-thread-link').waitFor()
          await main.locator('.sky-reply-thread-link').click()
          await replyComposer.waitFor()
          release()
          await panel.getByText('Dear team,', { exact: true }).waitFor()
          await replyComposer.fill('Make the response warmer.')
          await panel.getByRole('button', { name: 'Send', exact: true }).click()
          await panel.getByText('2 replies', { exact: true }).waitFor()
          await main.getByRole('button', { name: '2 replies', exact: true }).waitFor()

          // A paragraph-spanning selection survives parent polling and thread activity refreshes.
          const selection = await panel
            .locator('.sky-rendered')
            .first()
            .evaluate((element) => {
              const paragraphs = element.querySelectorAll('p')
              const range = document.createRange()
              range.setStart(paragraphs[0]!.firstChild!, 0)
              range.setEnd(paragraphs[1]!.lastChild!, paragraphs[1]!.lastChild!.textContent!.length)
              document.getSelection()!.removeAllRanges()
              document.getSelection()!.addRange(range)
              return document.getSelection()!.toString()
            })
          await page.waitForTimeout(2300)
          assert({
            given: 'a selection spanning both source paragraphs while the page refreshes thread status',
            should: 'preserve the browser selection',
            actual: await page.evaluate(() => document.getSelection()?.toString()),
            expected: selection,
          })
          const source = panel.locator('.sky-rendered').first()
          await source.scrollIntoViewIfNeeded()
          const drag = await source.evaluate((element) => {
            const paragraphs = element.querySelectorAll('p')
            const first = paragraphs[0]!.firstChild!
            const last = paragraphs[1]!.lastChild!
            const range = document.createRange()
            range.setStart(first, 0)
            range.setEnd(first, 1)
            const start = range.getBoundingClientRect()
            range.setStart(last, last.textContent!.length - 1)
            range.setEnd(last, last.textContent!.length)
            const end = range.getBoundingClientRect()
            document.getSelection()!.removeAllRanges()
            return {
              start: { x: start.left + 1, y: start.top + start.height / 2 },
              end: { x: end.right - 1, y: end.top + end.height / 2 },
            }
          })
          await page.mouse.move(drag.start.x, drag.start.y)
          await page.mouse.down()
          await page.mouse.move(drag.end.x, drag.end.y, { steps: 12 })
          await page.waitForTimeout(2300)
          await page.mouse.up()
          assert({
            given: 'a text-selection drag held across a thread-status refresh',
            should: 'keep the selection across both paragraphs',
            actual: await page.evaluate(() => {
              const selected = document.getSelection()?.toString() ?? ''
              return selected.includes('agreements have been reviewed together.') && selected.includes('shared terms')
            }),
            expected: true,
          })
          await page.screenshot({ path: '/tmp/sky-reply-thread-desktop.png', fullPage: true })
          await page.setViewportSize({ width: 430, height: 900 })
          await page.waitForFunction(() => document.querySelector('.sky-side')!.getBoundingClientRect().right <= 1)
          await replyComposer.waitFor()
          const phone = await panel.boundingBox()
          assert({
            given: 'a narrow screen',
            should: 'keep the thread in view and the composer unobstructed',
            actual: {
              inViewport: phone!.x >= 0 && phone!.x + phone!.width <= 431,
              reachable: await replyComposer.evaluate((element) => {
                const box = element.getBoundingClientRect()
                return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element
              }),
            },
            expected: { inViewport: true, reachable: true },
          })
          await page.screenshot({ path: '/tmp/sky-reply-thread-mobile.png', fullPage: true })
          await replyComposer.fill('An unfinished revision that belongs only to this reply thread.')
          await panel.locator('input[type="file"]').setInputFiles({
            name: 'Revision-notes.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('Synthetic revision notes.'),
          })
          await panel.locator('.sky-chat-draft-status').waitFor({ state: 'detached' })
          await panel.getByRole('button', { name: 'Close thread', exact: true }).click()
          await page.setViewportSize({ width: 1600, height: 1050 })
          await page.reload()
          await main.locator('.sky-reply-thread-link').waitFor()
          await main.locator('.sky-reply-thread-link').click()
          await panel.getByText('2 replies', { exact: true }).waitFor()
          await panel.getByRole('button', { name: 'Remove Revision-notes.txt', exact: true }).waitFor()
          assert({
            given: 'main and reply composers both held unfinished drafts before refresh',
            should: 'restore each draft and keep the reply attachment in its own thread',
            actual: {
              main: await mainComposer.inputValue(),
              reply: await replyComposer.inputValue(),
              mainFiles: await main.locator('.sky-composer .sky-chat-file').count(),
              replyFiles: await panel.locator('.sky-composer .sky-chat-file').count(),
              cursorAtEnd: await replyComposer.evaluate(
                (element: HTMLTextAreaElement) =>
                  element === document.activeElement &&
                  element.selectionStart === element.value.length &&
                  element.selectionEnd === element.value.length,
              ),
            },
            expected: {
              main: 'A main-chat draft that must survive opening and closing the thread.',
              reply: 'An unfinished revision that belongs only to this reply thread.',
              mainFiles: 0,
              replyFiles: 1,
              cursorAtEnd: true,
            },
          })
          assert({
            given: 'the thread reopened after a page reload',
            should: 'retain the review tools, all five documents, and the refinement exchanges without browser errors',
            actual: {
              reviews: ['A', 'B', 'C', 'D', 'E'].every((letter) =>
                JSON.stringify(calls.find((call) => call.reply)?.messages).includes(`Mock contract ${letter}`),
              ),
              refined: await panel.getByText('Make the response warmer.', { exact: true }).count(),
              errors,
            },
            expected: { reviews: true, refined: 1, errors: [] },
          })
        },
      )
    } finally {
      release?.()
    }
  },
)
