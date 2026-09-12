import { readFile, writeFile } from 'node:fs/promises'
import type { Page } from 'playwright'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { DayView } from './day/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-01-27')
const CONTENT = `---
started: 08:00
ended:
tz: America/Chicago
---

# A sample day

## Professional Commitments

- 09:30 > Check in with Jane Doe
- 14:00 > Review the launch plan

## Professional Todos

- Review the Atlas proposal
  Keep the attached notes.
- Outline the next release
- Share the launch checklist with the team

## Reminders

- Send the venue options
- Book a table for Friday
`

async function dragRow(page: Page, text: string, targetText: string, touch: boolean) {
  const row = page.locator('.sky-prow').filter({ hasText: text })
  const target = page.locator('.sky-prow').filter({ hasText: targetText })
  await row.scrollIntoViewIfNeeded()
  const from = (await row.locator('.sky-item-grip').boundingBox())!
  const to = (await target.boundingBox())!
  const x = from.x + from.width / 2,
    start = from.y + from.height / 2,
    end = to.y + to.height - 4
  const saved = page.waitForResponse((response) => response.url().endsWith('/item/organize/reorder'))
  if (touch) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: start }] })
    for (let step = 1; step <= 10; step++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: start + ((end - start) * step) / 10 }],
      })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
  } else {
    await page.mouse.move(x, start)
    await page.mouse.down()
    await page.mouse.move(x, end, { steps: 10 })
    await page.mouse.up()
  }
  const response = await saved
  assert({
    given: `${touch ? 'touch' : 'mouse'} dragging`,
    should: 'save the reordered list',
    actual: response.status(),
    expected: 200,
  })
}

test(
  {
    name: 'Organize supports desktop and touch reordering, mixed selections, date moves, Undo and single-item rescheduling',
    timeout: 90000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: CONTENT, file: `time/${dayFile(DAY)}`, tempPrefix: 'day-organizing-', day: true },
      async ({ page: desktop, origin, file, errors }) => {
        const browser = desktop.context().browser()!
        for (const mobile of [false, true]) {
          const context = await browser.newContext({
            viewport: mobile ? { width: 390, height: 844 } : { width: 1500, height: 1000 },
            isMobile: mobile,
            hasTouch: mobile,
          })
          const page = await context.newPage()
          const browserErrors: string[] = []
          page.on('pageerror', (error) => browserErrors.push(error.message))
          await page.route('**/schedule', (route) => route.fulfill({ json: { read: true, errors: [], meetings: [] } }))
          try {
            await writeFile(file, CONTENT)
            await page.goto(`${origin}/${DAY.ymd}`)
            await page.getByRole('button', { name: 'Organize', exact: true }).click()
            await dragRow(page, 'Review the Atlas proposal', 'Outline the next release', mobile)
            const savedOrder = await readFile(file, 'utf8')
            assert({
              given: 'a reordered task with notes',
              should: 'keep the note under its task in the saved file',
              actual: savedOrder.includes(
                '- Outline the next release\n- Review the Atlas proposal\n  Keep the attached notes.',
              ),
              expected: true,
            })
            await page.getByRole('button', { name: 'Done', exact: true }).click()
            await page.reload()
            await page.locator('.sky-prow').filter({ hasText: 'Review the Atlas proposal' }).waitFor()
            const displayed = await page
              .locator('[data-organize-list="Professional Todos"] .sky-ptext')
              .allTextContents()
            assert({
              given: 'a page reload',
              should: 'keep the manual order',
              actual: displayed[0],
              expected: 'Outline the next release',
            })
            const keyboardGrip = page.getByRole('button', { name: 'Reorder Review the Atlas proposal', exact: true })
            await page.getByRole('button', { name: 'Organize', exact: true }).click()
            await keyboardGrip.focus()
            const keyboardSave = page.waitForResponse((response) => response.url().endsWith('/item/organize/reorder'))
            await keyboardGrip.press('ArrowUp')
            await keyboardSave
            await page.getByRole('combobox', { name: 'Commitment order', exact: true }).selectOption('manual')
            await page.getByRole('button', { name: 'Reorder Check in with Jane Doe', exact: true }).waitFor()
            await page.locator('.sky-organize-toast').getByRole('button', { name: 'Undo', exact: true }).click()
            await page
              .getByRole('button', { name: 'Reorder Check in with Jane Doe', exact: true })
              .waitFor({ state: 'detached' })
            const repeatedOrder = page.waitForResponse((response) => response.url().endsWith('/item/organize/order'))
            await page.getByRole('combobox', { name: 'Commitment order', exact: true }).selectOption('manual')
            assert({
              given: 'repeating an action after Undo',
              should: 'save a new operation successfully',
              actual: (await repeatedOrder).status(),
              expected: 200,
            })
            await page.getByRole('button', { name: 'Reorder Check in with Jane Doe', exact: true }).waitFor()
            await dragRow(page, 'Check in with Jane Doe', 'Review the launch plan', mobile)
            await page.getByRole('combobox', { name: 'Commitment order', exact: true }).selectOption('time')
            await page
              .getByRole('button', { name: 'Reorder Check in with Jane Doe', exact: true })
              .waitFor({ state: 'detached' })
            for (const text of ['Review the Atlas proposal', 'Check in with Jane Doe', 'Send the venue options'])
              await page.getByRole('checkbox', { name: `Select ${text}`, exact: true }).click()
            const beforeMove = await readFile(file, 'utf8')
            const selection = await page.locator('.sky-organize-count').innerText()
            const footerVisible = await page
              .locator('.sky-organize-bar')
              .evaluate((node) => node.getBoundingClientRect().bottom <= innerHeight)
            assert({
              given: 'three selected items across three lists',
              should: 'keep selection separate from completion with the actions visible',
              actual: { selection, footerVisible, noStrikes: !beforeMove.includes('~~') },
              expected: { selection: '3 selected', footerVisible: true, noStrikes: true },
            })
            await page.getByRole('button', { name: mobile ? 'Tomorrow' : 'Move to tomorrow', exact: true }).click()
            await page.locator('.sky-organize-toast').getByText('3 items moved to tomorrow', { exact: true }).waitFor()
            await page.locator('.sky-organize-toast').getByRole('button', { name: 'Undo', exact: true }).click()
            await page.locator('.sky-prow').filter({ hasText: 'Send the venue options' }).waitFor()
            assert({
              given: 'Undo after moving to tomorrow',
              should: 'restore the source file exactly',
              actual: await readFile(file, 'utf8'),
              expected: beforeMove,
            })

            const sourceView = (await (await page.request.get(`${origin}/day/${DAY.ymd}`)).json()) as DayView
            const destination = new PlainDate(sourceView.today.ymd).addDays(4)
            await page.getByRole('button', { name: 'Organize', exact: true }).click()
            await page.getByRole('checkbox', { name: 'Select Review the Atlas proposal', exact: true }).click()
            await page.getByRole('checkbox', { name: 'Select Send the venue options', exact: true }).click()
            await page.getByRole('button', { name: 'Choose date…', exact: true }).click()
            const calendar = page.getByRole('dialog')
            if (!(await calendar.locator(`[data-date="${destination.ymd}"]`).count()))
              await calendar.getByRole('button', { name: 'Next month', exact: true }).click()
            await calendar.locator(`[data-date="${destination.ymd}"]`).click()
            const dateSave = page.waitForResponse((response) => response.url().endsWith('/item/organize/move'))
            await calendar.getByRole('button', { name: 'Move 2 items', exact: true }).click()
            const dateResponse = await dateSave
            if (!dateResponse.ok())
              throw new Error(`${mobile ? 'Mobile' : 'Desktop'} date move failed: ${await dateResponse.text()}`)
            const customUndo = (await dateResponse.json()) as { undo: string }
            await page.locator('.sky-organize-toast').getByRole('button', { name: 'Open date', exact: true }).click()
            await page.waitForURL(`${origin}/${destination.ymd}`)
            await page.locator('.sky-prow').filter({ hasText: 'Review the Atlas proposal' }).waitFor()
            const moved = (await (await page.request.get(`${origin}/day/${destination.ymd}`)).json()) as DayView
            assert({
              given: 'Choose date and Open date',
              should: 'show the new day containing the selected types',
              actual: {
                date: moved.day.ymd,
                todos: moved.record.todos.length,
                reminders: moved.record.reminders.length,
              },
              expected: { date: destination.ymd, todos: 1, reminders: 1 },
            })

            await page.goto(`${origin}/${DAY.ymd}`)
            const single = page.locator('.sky-prow').filter({ hasText: 'Outline the next release' })
            await single.getByRole('button', { name: 'Item details', exact: true }).click()
            const details = page.getByRole('dialog')
            await details.getByRole('button', { name: 'Tomorrow', exact: true }).click()
            await details.getByRole('button', { name: 'Save changes', exact: true }).click()
            await single.waitFor({ state: 'detached' })
            await page.locator('.sky-item-edit-undo').getByRole('button', { name: 'Undo', exact: true }).click()
            await single.waitFor()
            if (mobile) await page.setViewportSize({ width: 320, height: 640 })
            assert({
              given: 'single-item rescheduling and the narrow layout',
              should: 'support Undo with no overflow or browser errors',
              actual: {
                overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
                errors: browserErrors,
              },
              expected: { overflow: false, errors: [] },
            })
            // Restore the custom-date move before running the other viewport.
            const restored = await page.request.post(`${origin}/day/${DAY.ymd}/item/organize/undo`, {
              data: { id: customUndo.undo },
            })
            if (!restored.ok()) throw new Error(`Fixture cleanup failed: ${await restored.text()}`)
          } finally {
            await context.close()
          }
        }
        assert({ given: 'the browser runs', should: 'finish without app errors', actual: errors, expected: [] })
      },
    )
  },
)
