import { readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-01-27')
const FILE = path.posix.join('time', dayFile(DAY))
const EMPTY = '---\nstarted: 08:00\nended:\ntz: America/Chicago\n---\n\n# 2026-01-27\n'

for (const width of [1500, 390])
  test({ name: `Done today adds timed entries and supports Undo at ${width}px`, timeout: 45000 }, async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: EMPTY, tempPrefix: 'day-complete-', file: FILE, day: true },
      async ({ page, origin, file, errors }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(`${origin}/${DAY.ymd}`)
        const block = page.locator('.sky-block').filter({ has: page.locator('.sky-bhead', { hasText: 'Done today' }) })
        const add = block.getByRole('button', { name: 'Add entry', exact: true })
        await add.click()
        const form = block.getByRole('form', { name: 'Add entry', exact: true })
        const text = form.getByRole('textbox', { name: 'Item text', exact: true })
        await text.fill('Activity/Walk: Park loop')
        await add.click()
        await form.getByRole('alert').filter({ hasText: 'Enter a time' }).waitFor()
        await form.getByRole('textbox', { name: 'Entry time' }).fill('9:30')
        await form.getByRole('combobox', { name: 'Category', exact: true }).click()
        await page.getByRole('option', { name: 'Personal', exact: true }).click()
        const screenshot = env.get('SKY_BROWSER_SCREENSHOT')
        if (screenshot) await page.screenshot({ path: `${screenshot}-entry-form-${width}.png`, fullPage: true })
        await add.click()
        const row = block.locator('.sky-prow').filter({ hasText: 'Activity/Walk: Park loop' })
        await row.waitFor()
        const content = DayDocument.fromMarkdown(await readFile(file, 'utf8'))
        assert({
          given: 'Done today has no entries and the first entry is added through its form',
          should: 'save the time and text directly to Personal Complete, without a task checkbox or overflow',
          actual: {
            entries: content.lists.find((list) => list.title === 'Personal Complete')?.items,
            commitments: content.lists.some((list) => list.title.endsWith('Commitments')),
            checkbox: await row.getByRole('checkbox').count(),
            category: await row.locator('.sky-pchip').innerText(),
            overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          },
          expected: {
            entries: ['09:30 > Activity/Walk: Park loop'],
            commitments: false,
            checkbox: 0,
            category: 'Personal',
            overflow: false,
          },
        })
        await page.locator('.sky-plan-undo').getByRole('button', { name: 'Undo', exact: true }).click()
        await row.waitFor({ state: 'detached' })
        await add.waitFor()
        assert({
          given: 'Undo of the first entry',
          should: 'restore the original day and keep the add action available',
          actual: await readFile(file, 'utf8'),
          expected: EMPTY,
        })

        await add.click()
        await text.fill('Research: Read the brief')
        await form.getByRole('textbox', { name: 'Entry time' }).fill('25:30')
        await form.getByRole('combobox', { name: 'Category', exact: true }).click()
        await page.getByRole('option', { name: 'Professional', exact: true }).click()
        await text.press('Enter')
        const saved = block.locator('.sky-prow').filter({ hasText: 'Research: Read the brief' })
        await saved.waitFor()
        await page.reload()
        await saved.waitFor()
        if (screenshot) await page.screenshot({ path: `${screenshot}-entry-saved-${width}.png`, fullPage: true })
        const ended = (await readFile(file, 'utf8')).replace('ended:', 'ended: 26:00')
        await writeFile(file, ended)
        await page.reload()
        await page.locator('.sky-day-ended').waitFor()
        assert({
          given: 'an extended-hours entry after reloading and ending the day',
          should: 'retain the record and respect the ended day',
          actual: {
            entries: DayDocument.fromMarkdown(ended).lists.find((list) => list.title === 'Professional Complete')
              ?.items,
            visible: await saved.count(),
            add: await add.count(),
            errors,
          },
          expected: {
            entries: ['25:30 > Research: Read the brief'],
            visible: 1,
            add: 0,
            errors: [],
          },
        })
      },
    )
  })

for (const width of [1500, 390])
  test(
    { name: `Done today starts an entry at now and records how long it took at ${width}px`, timeout: 45000 },
    async (t) => {
      await runWysiwygE2e(
        t,
        { initialMarkdown: EMPTY, tempPrefix: 'day-complete-length-', file: FILE, day: true },
        async ({ page, origin, file, errors }) => {
          await page.setViewportSize({ width, height: 900 })
          // The notebook clock, scripted: past midnight on the day under way, then on another day.
          let clockDay = DAY.ymd
          await page.route('**/clock/_api/now', (route) =>
            route.fulfill({
              json: {
                notebook: { date: clockDay, time: '25:10', timezone: 'America/Chicago' },
                system: { date: DAY.addDays(1).ymd, time: '01:10', timezone: 'America/Chicago' },
              },
            }),
          )
          await page.goto(`${origin}/${DAY.ymd}`)
          const block = page
            .locator('.sky-block')
            .filter({ has: page.locator('.sky-bhead', { hasText: 'Done today' }) })
          const add = block.getByRole('button', { name: 'Add entry', exact: true })
          await add.click()
          const form = block.getByRole('form', { name: 'Add entry', exact: true })
          const time = form.getByRole('textbox', { name: 'Entry time' })
          await page.waitForFunction(() => document.querySelector<HTMLInputElement>('[aria-label="Entry time"]')?.value)
          const started = await time.inputValue()
          await form.getByRole('textbox', { name: 'Item text', exact: true }).fill('Garden: Planted the beds')
          await time.fill('9:30')
          const length = form.getByRole('textbox', { name: 'Duration' })
          await length.fill('90')
          await add.click()
          await form.getByRole('alert').filter({ hasText: 'how long it took' }).waitFor()
          await length.fill('1h 30m')
          const screenshot = env.get('SKY_BROWSER_SCREENSHOT')
          if (screenshot)
            await page.screenshot({ path: `${screenshot}-entry-length-form-${width}.png`, fullPage: true })
          await add.click()
          const row = block.locator('.sky-prow').filter({ hasText: 'Garden: Planted the beds' })
          await row.waitFor()
          await page.locator('.sky-plan-undo').getByRole('button', { name: 'Dismiss notification' }).click()
          if (screenshot) await page.screenshot({ path: `${screenshot}-entry-length-row-${width}.png`, fullPage: true })
          assert({
            given: 'the form opened at 25:10 on the day under way, then a changed time and a length typed two ways',
            should: 'start at the notebook clock, refuse the bare number, then save and show the length',
            actual: {
              started,
              entries: DayDocument.fromMarkdown(await readFile(file, 'utf8')).lists.find(
                (list) => list.title === 'Professional Complete',
              )?.items,
              time: await row.locator('.sky-when').innerText(),
              words: await row.locator('.sky-done-text').evaluate((element) => element.firstChild?.textContent),
              length: await row.locator('.sky-entry-length').innerText(),
              overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            },
            expected: {
              started: '25:10',
              entries: ['09:30 90m > Garden: Planted the beds'],
              time: '9:30',
              words: 'Garden: Planted the beds',
              length: '1 hour 30 min',
              overflow: false,
            },
          })

          clockDay = DAY.addDays(1).ymd
          const asked = page.waitForResponse('**/clock/_api/now')
          await block.getByRole('button', { name: 'Add entry', exact: true }).click()
          await (await asked).finished()
          assert({
            given: 'the notebook clock already on the next day',
            should: 'leave this day’s entry time for the person to fill',
            actual: { started: await time.inputValue(), errors },
            expected: { started: '', errors: [] },
          })
        },
      )
    },
  )
