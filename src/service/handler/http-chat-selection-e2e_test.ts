import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import { assert, test } from '#test'
import { replyThreadTestHost, type ReplyTestCall } from './chat/replyThreadsTestHelpers.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

test(
  { name: 'a selection opens a saved fresh-chat composer without inheriting the parent history', timeout: 90000 },
  async (t) => {
    const calls: ReplyTestCall[] = []
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Mock selection notebook\n',
        tempPrefix: 'sky-chat-selection-',
        day: true,
        chat: (base) => ({
          ...replyThreadTestHost(base, { calls }),
          title: async () => 'Planning the week',
          selectionStarts: {
            dir: path.join(base, 'selection-starts'),
            name: async () => 'Atlas Next Steps',
            now: () => '2025-03-15T12:34:56Z',
          },
        }),
      },
      async ({ page, origin, errors }) => {
        await page.setViewportSize({ width: 1780, height: 1100 })
        await page.goto(`${origin}/thread/selection-parent`)
        const main = page.locator('.sky-split-main')
        const input = main.getByRole('textbox', { name: 'Message sky…', exact: true })
        await input.fill('An unrelated private planning detail belongs only in this original conversation.')
        await main.getByRole('button', { name: 'Send', exact: true }).click()
        await main.getByText('All five agreements have been reviewed together.', { exact: true }).waitFor()
        await input.fill('Keep this unfinished message in the original chat.')
        const body = main.locator('[data-speaker="Sky"] .sky-rendered').first()
        const points = await body.evaluate((element) => {
          const paragraphs = element.querySelectorAll('p')
          const first = paragraphs[0]!.firstChild!
          const last = paragraphs[paragraphs.length - 1]!.lastChild!
          const start = document.createRange()
          start.setStart(first, 0)
          start.setEnd(first, 1)
          const end = document.createRange()
          end.setStart(last, last.textContent!.length - 1)
          end.setEnd(last, last.textContent!.length)
          const a = start.getBoundingClientRect()
          const b = end.getBoundingClientRect()
          return { x1: a.left, y1: a.top + a.height / 2, x2: b.right, y2: b.top + b.height / 2 }
        })
        await page.mouse.move(points.x1, points.y1)
        await page.mouse.down()
        await page.mouse.move(points.x2 - 30, points.y2, { steps: 6 })
        await page.waitForTimeout(2800)
        await page.mouse.move(points.x2, points.y2, { steps: 3 })
        await page.mouse.up()
        const dragged = await page.evaluate(() => document.getSelection()?.toString().trim())
        assert({
          given: 'the user drags across paragraphs while the chat refreshes',
          should: 'retain the full selection through the end of the drag',
          actual: dragged,
          expected:
            'All five agreements have been reviewed together.\n\nThe shared terms need to be aligned before we draft the team response.',
        })
        const select = () =>
          body.evaluate((element) => {
            const range = document.createRange()
            range.selectNodeContents(element)
            const selection = document.getSelection()!
            selection.removeAllRanges()
            selection.addRange(range)
            return selection.toString().trim()
          })
        const selected = dragged!
        const action = page.getByRole('menuitem', { name: 'New chat about this…', exact: true })
        await action.waitFor()
        await page.waitForTimeout(2800)
        assert({
          given: 'a paragraph-spanning selection during the normal background refresh',
          should: 'keep its text highlighted and show only the selection action',
          actual: {
            selection: await page.evaluate(() => document.getSelection()?.toString().trim()),
            items: await page.getByRole('menu', { name: 'Selected text' }).getByRole('menuitem').count(),
          },
          expected: { selection: selected, items: 1 },
        })
        await mkdir('/tmp/sky-chat-selection-browser', { recursive: true })
        await page.screenshot({ path: '/tmp/sky-chat-selection-browser/desktop.png' })
        await page.route(
          '**/chat/selections',
          (route) => route.fulfill({ status: 503, json: { message: 'Mock preparation failure.' } }),
          { times: 1 },
        )
        await action.click()
        await page.getByRole('alert').filter({ hasText: 'Mock preparation failure.' }).waitFor()
        assert({
          given: 'chat preparation fails',
          should: 'leave the source selection and unsent original message available for retry',
          actual: {
            selection: await page.evaluate(() => document.getSelection()?.toString().trim()),
            draft: await input.inputValue(),
          },
          expected: { selection: selected, draft: 'Keep this unfinished message in the original chat.' },
        })
        await page.evaluate(() => {
          const write = Storage.prototype.setItem
          Storage.prototype.setItem = function (key, value) {
            if (key.startsWith('sky-chat-draft:2025-03-15_123456_Atlas-Next-Steps')) {
              Storage.prototype.setItem = write
              throw new DOMException('Mock full storage', 'QuotaExceededError')
            }
            write.call(this, key, value)
          }
        })
        await action.click()
        await page.getByRole('alert').filter({ hasText: 'This draft could not be saved in this browser.' }).waitFor()
        assert({
          given: 'browser storage cannot save the quote',
          should: 'keep the original conversation and highlighted text available instead of opening an empty chat',
          actual: {
            path: new URL(page.url()).pathname,
            selection: await page.evaluate(() => document.getSelection()?.toString().trim()),
            draft: await input.inputValue(),
          },
          expected: {
            path: '/thread/selection-parent',
            selection: selected,
            draft: 'Keep this unfinished message in the original chat.',
          },
        })
        const popup = page.waitForEvent('popup')
        await action.click()
        const fresh = await popup
        await fresh.waitForURL(`${origin}/thread/2025-03-15_123456_Atlas-Next-Steps-2`)
        const freshInput = fresh.getByRole('textbox', { name: 'Message sky…', exact: true })
        await freshInput.waitFor()
        const quote = await freshInput.inputValue()
        const expectedQuote = `From [Planning the week](/thread/selection-parent#chat-selection-parent-reply-1) · Sky\n\n${selected
          .split('\n')
          .map((line) => (line ? `> ${line}` : '>'))
          .join('\n')}\n\n`
        await fresh.reload()
        await freshInput.waitFor()
        assert({
          given: 'a selection chat is opened and immediately reloaded',
          should: 'restore only the editable quote with the cursor below it, and make no conversational model call',
          actual: {
            text: await freshInput.inputValue(),
            originalText: await input.inputValue(),
            originalPath: new URL(page.url()).pathname,
            calls: calls.length,
            cursor: await freshInput.evaluate((element: HTMLTextAreaElement) => ({
              focused: element === document.activeElement,
              at: element.selectionStart,
            })),
          },
          expected: {
            text: expectedQuote,
            originalText: 'Keep this unfinished message in the original chat.',
            originalPath: '/thread/selection-parent',
            calls: 1,
            cursor: { focused: true, at: quote.length },
          },
        })
        await fresh.screenshot({ path: '/tmp/sky-chat-selection-browser/new-chat.png' })
        await freshInput.fill(`${quote}What should we investigate before drafting?`)
        await fresh.getByRole('button', { name: 'Send', exact: true }).click()
        await fresh.getByText('All five agreements have been reviewed together.', { exact: true }).last().waitFor()
        const state = await (await fresh.request.get(`${origin}/chat/2025-03-15_123456_Atlas-Next-Steps-2`)).json()
        const received = JSON.stringify(calls.at(-1)!.messages)
        assert({
          given: 'the first message is sent from the new conversation',
          should: 'start independently without the original user message, tool results, or parent relationship',
          actual: {
            calls: calls.length,
            inherited: state.inherited,
            parent: state.parent,
            selected: received.includes('All five agreements have been reviewed together.'),
            oldPrompt: received.includes('An unrelated private planning detail'),
            oldTools: received.includes('Mock contracts A, B, C, D and E'),
          },
          expected: { calls: 2, inherited: 0, parent: null, selected: true, oldPrompt: false, oldTools: false },
        })

        await page.bringToFront()
        await page.setViewportSize({ width: 390, height: 844 })
        await body.scrollIntoViewIfNeeded()
        await page.evaluate(() => document.getSelection()?.removeAllRanges())
        await page.waitForTimeout(50)
        await select()
        await action.waitFor()
        const menuBox = (await action.boundingBox())!
        assert({
          given: 'the same selection on a narrow screen',
          should: 'keep the whole action inside the viewport',
          actual:
            menuBox.x >= 0 && menuBox.x + menuBox.width <= 390 && menuBox.y >= 0 && menuBox.y + menuBox.height <= 844,
          expected: true,
        })
        await page.screenshot({ path: '/tmp/sky-chat-selection-browser/mobile.png' })
        await page.keyboard.press('Escape')
        await action.waitFor({ state: 'detached' })
        await page.keyboard.press('Shift+F10')
        await action.waitFor()
        assert({
          given: 'the selection menu is invoked from the keyboard',
          should: 'focus its action without dropping the selected text',
          actual: await action.evaluate((element) => element === document.activeElement),
          expected: true,
        })
        await page.evaluate(() => {
          window.open = () => null
        })
        await action.press('Enter')
        await page.waitForURL(`${origin}/thread/2025-03-15_123456_Atlas-Next-Steps-3`)
        assert({
          given: 'the browser blocks a new tab',
          should: 'open the saved quoted composer in this tab',
          actual: await page.getByRole('textbox', { name: 'Message sky…', exact: true }).inputValue(),
          expected: expectedQuote,
        })
        assert({
          given: 'the complete selection flow',
          should: 'produce no unexpected page errors',
          actual: errors.filter((error) => !error.includes('503')),
          expected: [],
        })
      },
    )
  },
)
