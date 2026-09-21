import { readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { Page, Request } from 'playwright'
import { exists } from '#shared/fs/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, Week, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
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
  const width = (await row.boundingBox())!.width
  const x = from.x + from.width / 2,
    start = from.y + from.height / 2,
    end = to.y + to.height - 4
  const saved = page.waitForResponse((response) => response.url().endsWith('/item/organize/reorder'))
  // The row in hand: a copy of the whole row rides under the pointer while its slot waits in the list.
  const inHand = async () => {
    const lift = page.locator('.sky-sort-lift')
    const box = (await lift.boundingBox())!
    assert({
      given: `${touch ? 'touch' : 'mouse'} dragging a row`,
      should: 'carry the whole row, text and all, under the pointer',
      actual: {
        text: (await lift.innerText()).includes(text),
        underPointer: box.y <= end && end <= box.y + box.height,
        wholeRow: box.width >= width,
        slots: await page.locator('.sky-prow[data-sort="slot"]').count(),
      },
      expected: { text: true, underPointer: true, wholeRow: true, slots: 1 },
    })
  }
  if (touch) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: start }] })
    for (let step = 1; step <= 10; step++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: start + ((end - start) * step) / 10 }],
      })
    await inHand()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
  } else {
    await page.mouse.move(x, start)
    await page.mouse.down()
    await page.mouse.move(x, end, { steps: 10 })
    await inHand()
    await page.mouse.up()
  }
  const response = await saved
  assert({
    given: `${touch ? 'touch' : 'mouse'} dragging`,
    should: 'save the reordered list',
    actual: response.status(),
    expected: 200,
  })
  await page.locator('.sky-sort-lift').waitFor({ state: 'detached' })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert({
    given: 'a dropped row',
    should: 'leave no copy, no row standing aside, and no focus ring on its grip',
    actual: {
      rowsAside: await page.locator('.sky-prow[data-sort]').count(),
      gripFocused: await page.evaluate(() => document.activeElement?.hasAttribute('data-sort-grip') ?? false),
    },
    expected: { rowsAside: 0, gripFocused: false },
  })
}

/** Escape during a drag puts the row back: nothing is saved and nothing is left floating. */
async function escapeDrag(page: Page, text: string, targetText: string, file: string) {
  const before = await readFile(file, 'utf8')
  const requests: string[] = []
  const watch = (request: Request) => {
    if (request.url().includes('/item/organize/')) requests.push(request.url())
  }
  page.on('request', watch)
  const row = page.locator('.sky-prow').filter({ hasText: text })
  const from = (await row.locator('.sky-item-grip').boundingBox())!
  const to = (await page.locator('.sky-prow').filter({ hasText: targetText }).boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, to.y + to.height - 4, { steps: 10 })
  await page.locator('.sky-sort-lift').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.sky-sort-lift').waitFor({ state: 'detached' })
  await page.mouse.up()
  page.off('request', watch)
  assert({
    given: 'Escape during a drag',
    should: 'put the row back and save nothing',
    actual: {
      requests,
      rowsAside: await page.locator('.sky-prow[data-sort]').count(),
      unchanged: (await readFile(file, 'utf8')) === before,
    },
    expected: { requests: [], rowsAside: 0, unchanged: true },
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
      {
        initialMarkdown: CONTENT,
        file: `time/${dayFile(DAY)}`,
        tempPrefix: 'day-organizing-',
        day: true,
        now: new ZonedDateTime('2026-01-27T08:00:00', 'UTC'),
      },
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
            if (!mobile) await escapeDrag(page, 'Review the Atlas proposal', 'Outline the next release', file)
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
            // The arrow keys keep their grip, so the next press moves the same row again.
            await page.waitForFunction(
              () => document.activeElement?.getAttribute('aria-label') === 'Reorder Review the Atlas proposal',
            )
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

test(
  {
    name: 'Sunday moves schedule next week and Open date shows the scheduled tasks on desktop and mobile',
    timeout: 60000,
  },
  async (t) => {
    const sunday = new PlainDate('2031-03-16')
    const monday = sunday.addDays(1)
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: CONTENT,
        file: `time/${dayFile(sunday)}`,
        tempPrefix: 'day-schedule-routing-',
        day: true,
        now: new ZonedDateTime('2031-03-16T08:00:00', 'UTC'),
      },
      async ({ page, origin, file, userDataDir, errors }) => {
        const timeDir = path.join(path.dirname(userDataDir), 'time')
        for (const mobile of [false, true]) {
          await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1500, height: 1000 })
          await page.goto(`${origin}/${sunday.ymd}`)
          const move = async () => {
            await page.getByRole('button', { name: 'Organize', exact: true }).click()
            await page.getByRole('checkbox', { name: 'Select Review the Atlas proposal', exact: true }).click()
            await page.getByRole('checkbox', { name: 'Select Send the venue options', exact: true }).click()
            const saved = page.waitForResponse((response) => response.url().endsWith('/item/organize/move'))
            await page.getByRole('button', { name: mobile ? 'Tomorrow' : 'Move to tomorrow', exact: true }).click()
            const response = await saved
            if (!response.ok()) throw new Error(await response.text())
            return (await response.json()) as { undo: string }
          }
          await move()
          await page
            .locator('.sky-organize-toast')
            .getByText('2 items scheduled for tomorrow', { exact: true })
            .waitFor()
          await page.locator('.sky-organize-toast').getByRole('button', { name: 'Undo', exact: true }).click()
          await page.locator('.sky-prow').filter({ hasText: 'Review the Atlas proposal' }).waitFor()
          assert({
            given: 'Undo of a Sunday-to-Monday move',
            should: 'restore the source exactly',
            actual: await readFile(file, 'utf8'),
            expected: CONTENT,
          })
          const result = await move()
          await page.locator('.sky-organize-toast').getByRole('button', { name: 'Open date', exact: true }).click()
          await page.waitForURL(`${origin}/week/${Week.of(monday)}`)
          await page.getByText('Review the Atlas proposal', { exact: true }).waitFor()
          await page.getByText('Send the venue options', { exact: true }).waitFor()
          assert({
            given: `${mobile ? 'mobile' : 'desktop'} Open date after a next-week move`,
            should: 'show the scheduled tasks, preserve attached notes, and create no future day',
            actual: {
              dayCreated: await exists(path.join(timeDir, dayFile(monday))),
              notes: (await readFile(path.join(timeDir, 'schedule-professional.md'), 'utf8')).includes(
                '  Keep the attached notes.',
              ),
              metadataVisible: (await page.locator('body').innerText()).includes('sky-list:'),
              overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            },
            expected: { dayCreated: false, notes: true, metadataVisible: false, overflow: false },
          })
          const undo = await page.request.post(`${origin}/day/${sunday.ymd}/item/organize/undo`, {
            data: { id: result.undo },
          })
          if (!undo.ok()) throw new Error(await undo.text())
        }
        assert({
          given: 'scheduled browser moves',
          should: 'finish without browser errors',
          actual: errors,
          expected: [],
        })
      },
    )
  },
)
