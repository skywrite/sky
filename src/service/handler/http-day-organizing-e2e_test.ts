import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { Page, Request, Response } from 'playwright'
import { exists } from '#shared/fs/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { planSection } from './day/editingText.ts'
import type { DayView } from './day/mod.ts'
import { dayItemKey, type DayItemAddress } from './day/organizingTypes.ts'
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
  await page.locator('.sky-organize-bar').getByRole('button', { name: 'Done', exact: true }).waitFor()
  // Organize animates row padding; measuring mid-transition gives the touch stale drop coordinates.
  await page.evaluate(() =>
    Promise.all(
      [...document.querySelectorAll('.sky-prow[data-organize-key]')]
        .flatMap((row) => row.getAnimations())
        .map((animation) => animation.finished.catch(() => {})),
    ),
  )
  const targetKey = await target.getAttribute('data-organize-key')
  const expectedOrder = await row.evaluate((node, targetKey) => {
    const rows = [...node.parentElement!.querySelectorAll<HTMLElement>(':scope > [data-organize-key]')].filter(
      (row) => row.dataset.organizeList === (node as HTMLElement).dataset.organizeList,
    )
    const target = rows.find((row) => row.dataset.organizeKey === targetKey)!
    const scroll = node.closest('.sky-scroll')!
    const from = node.getBoundingClientRect()
    const to = target.getBoundingClientRect()
    const bounds = scroll.getBoundingClientRect()
    // Both rows must clear the scroll edges: holding a touch there intentionally keeps scrolling the list.
    scroll.scrollTop +=
      (Math.min(from.top, to.top) + Math.max(from.bottom, to.bottom)) / 2 -
      (bounds.top + Math.min(bounds.bottom, innerHeight)) / 2
    const ordered = rows.filter((row) => row !== node)
    ordered.splice(ordered.indexOf(target) + 1, 0, node as HTMLElement)
    return ordered.map((row) => row.dataset.organizeKey!)
  }, targetKey)
  const from = (await row.locator('.sky-item-grip').boundingBox())!
  const to = (await target.boundingBox())!
  const width = (await row.boundingBox())!.width
  const x = from.x + from.width / 2,
    start = from.y + from.height / 2,
    end = to.y + to.height / 2 + 4
  const bounds = await row.evaluate((node) => {
    const bounds = node.closest('.sky-scroll')!.getBoundingClientRect()
    return { top: bounds.top, bottom: Math.min(bounds.bottom, innerHeight) }
  })
  assert({
    given: `${touch ? 'touch' : 'mouse'} reordering without edge scrolling`,
    should: 'keep the drop point outside the scroll edges',
    actual: end > bounds.top + 48 && end < bounds.bottom - 48,
    expected: true,
  })
  const drop = async (release: () => Promise<unknown>) => {
    const [response] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/item/organize/reorder')),
      release(),
    ])
    return response
  }
  // The row in hand: a copy of the whole row rides under the pointer while its slot waits in the list.
  const inHand = async () => {
    await page
      .waitForFunction(
        (expected) => {
          const rows = [...document.querySelectorAll<HTMLElement>('.sky-prow[data-organize-key]')]
            .filter((row) => expected.includes(row.dataset.organizeKey!))
            .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
          return rows.length === expected.length && rows.every((row, i) => row.dataset.organizeKey === expected[i])
        },
        expectedOrder,
        { timeout: 5000 },
      )
      .catch(async (cause) => {
        const actual = await page
          .locator('.sky-prow[data-sort]')
          .evaluateAll((rows) =>
            rows
              .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
              .map((row) => (row as HTMLElement).dataset.organizeKey),
          )
        throw new Error(
          `Could not drag "${text}" after "${targetText}": ${JSON.stringify({ expected: expectedOrder, actual })}`,
          { cause },
        )
      })
    const actual = await page.evaluate(
      ({ text, end, width }) => {
        const lift = document.querySelector<HTMLElement>('.sky-sort-lift')!
        const box = lift.getBoundingClientRect()
        return {
          text: lift.innerText.includes(text),
          underPointer: box.top <= end && end <= box.bottom,
          wholeRow: box.width >= width,
          slots: document.querySelectorAll('.sky-prow[data-sort="slot"]').length,
        }
      },
      { text, end, width },
    )
    assert({
      given: `${touch ? 'touch' : 'mouse'} dragging a row`,
      should: 'carry the whole row, text and all, under the pointer',
      actual,
      expected: { text: true, underPointer: true, wholeRow: true, slots: 1 },
    })
  }
  let response: Response
  if (touch) {
    const cdp = await page.context().newCDPSession(page)
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: start }] })
      for (let step = 1; step <= 10; step++)
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x, y: start + ((end - start) * step) / 10 }],
        })
      await inHand()
      response = await drop(() => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }))
    } finally {
      await cdp.detach()
    }
  } else {
    await page.mouse.move(x, start)
    await page.mouse.down()
    await page.mouse.move(x, end, { steps: 10 })
    await inHand()
    response = await drop(() => page.mouse.up())
  }
  await response.finished()
  assert({
    given: `${touch ? 'touch' : 'mouse'} dragging`,
    should: 'save the reordered list',
    actual: response.status(),
    expected: 200,
  })
  assert({
    given: `${touch ? 'touch' : 'mouse'} dropping after the intended row`,
    should: 'send exactly the previewed order',
    actual: (response.request().postDataJSON() as { items: DayItemAddress[] }).items.map(dayItemKey),
    expected: expectedOrder,
  })
  await page.waitForFunction(
    () =>
      !document.querySelector('.sky-sort-lift, .sky-prow[data-sort]') &&
      !document.activeElement?.hasAttribute('data-sort-grip'),
  )
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

for (const { mobile, cpuRate } of [
  { mobile: false, cpuRate: 1 },
  { mobile: true, cpuRate: 1 },
  { mobile: true, cpuRate: 6 },
]) {
  test(
    {
      name: `Organize supports ${mobile ? 'touch' : 'mouse'} reordering at ${cpuRate}x CPU throttling, mixed selections, date moves, Undo and single-item rescheduling`,
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
            await page.goto(`${origin}/${DAY.ymd}`)
            await page.getByRole('button', { name: 'Organize', exact: true }).click()
            if (!mobile) await escapeDrag(page, 'Review the Atlas proposal', 'Outline the next release', file)
            const pointer = await context.newCDPSession(page)
            try {
              await pointer.send('Emulation.setCPUThrottlingRate', { rate: cpuRate })
              await dragRow(page, 'Review the Atlas proposal', 'Outline the next release', mobile)
            } finally {
              await pointer.send('Emulation.setCPUThrottlingRate', { rate: 1 })
              await pointer.detach()
            }
            const savedRows = planSection(await readFile(file, 'utf8'), 'Professional Todos')!.rows
            assert({
              given: `${mobile ? 'touch' : 'mouse'} reordering a task with notes`,
              should: 'save the requested task order',
              actual: savedRows.map((row) => row.raw),
              expected: [
                'Outline the next release',
                'Review the Atlas proposal',
                'Share the launch checklist with the team',
              ],
            })
            assert({
              given: `${mobile ? 'touch' : 'mouse'} reordering a task with notes`,
              should: 'preserve its complete Markdown block',
              actual: savedRows.find((row) => row.raw === 'Review the Atlas proposal')?.block,
              expected: '- Review the Atlas proposal\n  Keep the attached notes.',
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
            const keyboard = await context.newCDPSession(page)
            await keyboard.send('Emulation.setCPUThrottlingRate', { rate: 6 })
            try {
              for (const [key, first] of [
                ['ArrowUp', 'Review the Atlas proposal'],
                ['ArrowDown', 'Outline the next release'],
                ['ArrowUp', 'Review the Atlas proposal'],
              ] as const) {
                const keyboardSave = page.waitForResponse((response) =>
                  response.url().endsWith('/item/organize/reorder'),
                )
                // Use the retained focus: locator.press would refocus the grip and hide a broken keyboard sequence.
                await page.keyboard.press(key)
                assert({
                  given: 'successive arrow keys on a slower device',
                  should: 'save each move successfully',
                  actual: (await keyboardSave).status(),
                  expected: 200,
                })
                await page.waitForFunction(
                  () => document.activeElement?.getAttribute('aria-label') === 'Reorder Review the Atlas proposal',
                )
                assert({
                  given: 'a saved keyboard move',
                  should: 'move the same task and keep the day title',
                  actual: {
                    first: await page
                      .locator('[data-organize-list="Professional Todos"] .sky-ptext')
                      .first()
                      .innerText(),
                    title: await page.title(),
                  },
                  expected: { first, title: 'sky · Tuesday, January 27, 2026 · Day record' },
                })
              }
            } finally {
              await keyboard.send('Emulation.setCPUThrottlingRate', { rate: 1 })
              await keyboard.detach()
            }
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
            // Undo the custom-date move after the later single-item edit and Undo.
            const restored = await page.request.post(`${origin}/day/${DAY.ymd}/item/organize/undo`, {
              data: { id: customUndo.undo },
            })
            if (!restored.ok()) throw new Error(`Fixture cleanup failed: ${await restored.text()}`)
          } finally {
            await context.close()
          }
          assert({ given: 'the browser runs', should: 'finish without app errors', actual: errors, expected: [] })
        },
      )
    },
  )
}

test(
  { name: 'touch dragging at a scroll edge scrolls only until cancelled and saves nothing', timeout: 60000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: CONTENT,
        file: `time/${dayFile(DAY)}`,
        tempPrefix: 'day-organizing-scroll-',
        day: true,
        now: new ZonedDateTime('2026-01-27T08:00:00', 'UTC'),
      },
      async ({ page: desktop, origin, file, errors }) => {
        const context = await desktop
          .context()
          .browser()!
          .newContext({
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
          })
        const page = await context.newPage()
        const touch = await context.newCDPSession(page)
        const requests: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        page.on('request', (request) => {
          if (request.url().includes('/item/organize/')) requests.push(request.url())
        })
        try {
          await page.clock.install({ time: '2026-01-27T08:00:00Z' })
          await page.route('**/schedule', (route) => route.fulfill({ json: { read: true, errors: [], meetings: [] } }))
          await page.goto(`${origin}/${DAY.ymd}`)
          await page.getByRole('button', { name: 'Organize', exact: true }).click()
          await page.clock.pauseAt('2026-01-27T08:05:00Z')
          const row = page.locator('.sky-prow').filter({ hasText: 'Review the Atlas proposal' })
          const from = (await row.locator('.sky-item-grip').boundingBox())!
          const scroll = page.locator('.sky-scroll').filter({ has: row })
          const bounds = (await scroll.boundingBox())!
          const before = await readFile(file, 'utf8')
          const initialScroll = await scroll.evaluate((node) => node.scrollTop)
          const x = from.x + from.width / 2
          await touch.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x, y: from.y + from.height / 2 }],
          })
          await touch.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x, y: bounds.y + bounds.height - 4 }],
          })
          await page.clock.runFor(160)
          assert({
            given: 'a held touch at the bottom scroll edge',
            should: 'scroll the column while the pointer stays still',
            actual: (await scroll.evaluate((node) => node.scrollTop)) > initialScroll,
            expected: true,
          })
          await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
          await page.clock.runFor(300)
          await page.locator('.sky-sort-lift').waitFor({ state: 'detached' })
          const stopped = await scroll.evaluate((node) => node.scrollTop)
          await page.clock.runFor(160)
          assert({
            given: 'a cancelled touch after edge scrolling',
            should: 'stop scrolling, put the row back, and leave the file unchanged',
            actual: {
              scrollTop: await scroll.evaluate((node) => node.scrollTop),
              rowsAside: await page.locator('.sky-prow[data-sort]').count(),
              requests,
              markdown: await readFile(file, 'utf8'),
              errors,
            },
            expected: { scrollTop: stopped, rowsAside: 0, requests: [], markdown: before, errors: [] },
          })
        } finally {
          await touch.detach()
          await context.close()
        }
      },
    )
  },
)

test(
  {
    name: 'Sunday moves to tomorrow land on Monday and Open date shows that day on desktop and mobile',
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
        await page.route('**/schedule', (route) => route.fulfill({ json: { read: true, errors: [], meetings: [] } }))
        const timeDir = path.join(path.dirname(userDataDir), 'time')
        const mondayFile = path.join(timeDir, dayFile(monday))
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
          await page.locator('.sky-organize-toast').getByText('2 items moved to tomorrow', { exact: true }).waitFor()
          await page.locator('.sky-organize-toast').getByRole('button', { name: 'Undo', exact: true }).click()
          await page.locator('.sky-prow').filter({ hasText: 'Review the Atlas proposal' }).waitFor()
          assert({
            given: 'Undo of a Sunday-to-Monday move',
            should: 'restore the source exactly and remove the day the move created',
            actual: { source: await readFile(file, 'utf8'), dayCreated: await exists(mondayFile) },
            expected: { source: CONTENT, dayCreated: false },
          })
          const result = await move()
          await page.locator('.sky-organize-toast').getByRole('button', { name: 'Open date', exact: true }).click()
          await page.waitForURL(`${origin}/${monday.ymd}`)
          await page.locator('.sky-prow').filter({ hasText: 'Review the Atlas proposal' }).waitFor()
          await page.locator('.sky-prow').filter({ hasText: 'Send the venue options' }).waitFor()
          assert({
            given: `${mobile ? 'mobile' : 'desktop'} Open date after a move to tomorrow`,
            should: "show the tasks on Monday's page, keep attached notes, and leave the schedule alone",
            actual: {
              notes: (await readFile(mondayFile, 'utf8')).includes('  Keep the attached notes.'),
              scheduled: await exists(path.join(timeDir, 'schedule-professional.md')),
              overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            },
            expected: { notes: true, scheduled: false, overflow: false },
          })
          const undo = await page.request.post(`${origin}/day/${sunday.ymd}/item/organize/undo`, {
            data: { id: result.undo },
          })
          if (!undo.ok()) throw new Error(await undo.text())
        }
        assert({
          given: 'Sunday browser moves',
          should: 'finish without browser errors',
          actual: errors,
          expected: [],
        })
      },
    )
  },
)
