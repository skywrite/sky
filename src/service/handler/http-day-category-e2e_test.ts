import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { ItemCategory } from './day/category.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-01-27')
const EMPTY = '---\nstarted: 08:00\ntz: America/Chicago\n---\n\n# 2026-01-27\n'

for (const width of [1500, 390])
  test(
    { name: `day categories debounce, preserve manual choices and ignore stale replies at ${width}px`, timeout: 60000 },
    async (t) => {
      await runWysiwygE2e(
        t,
        { initialMarkdown: EMPTY, tempPrefix: 'day-category-', file: path.posix.join('time', dayFile(DAY)), day: true },
        async ({ page, origin, file, errors }) => {
          const calls: string[] = []
          const held = new Map<
            string,
            {
              started: ReturnType<typeof Promise.withResolvers<void>>
              release: ReturnType<typeof Promise.withResolvers<void>>
              finished: ReturnType<typeof Promise.withResolvers<void>>
            }
          >()
          const hold = (text: string) => {
            const gate = {
              started: Promise.withResolvers<void>(),
              release: Promise.withResolvers<void>(),
              finished: Promise.withResolvers<void>(),
            }
            held.set(text, gate)
            return gate
          }
          const categories: Record<string, ItemCategory | null> = {
            'Water the plants': 'Personal',
            'Plan the family picnic': 'Personal',
            'Sort the storage closet': null,
          }
          await page.route('**/day/*/item/category', async (route) => {
            const { text } = route.request().postDataJSON() as { text: string }
            calls.push(text)
            const gate = held.get(text)
            gate?.started.resolve()
            if (gate) await gate.release.promise
            await route.fulfill({ json: { category: text in categories ? categories[text] : 'Professional' } })
            gate?.finished.resolve()
          })
          await page.route('**/day/*/schedule', (route) =>
            route.fulfill({ json: { read: true, errors: [], meetings: [] } }),
          )
          await page.setViewportSize({ width, height: 1000 })
          await page.goto(`${origin}/${DAY.ymd}?view=record`)
          const block = page
            .locator('.sky-block')
            .filter({ has: page.locator('.sky-bhead', { hasText: 'Done today' }) })
          const add = block.getByRole('button', { name: 'Add entry', exact: true })
          const form = block.getByRole('form', { name: 'Add entry', exact: true })
          const text = form.getByRole('textbox', { name: 'Item text', exact: true })
          const category = form.getByRole('combobox', { name: 'Category', exact: true })
          const selected = (value: string) =>
            page.waitForFunction(
              (value) => document.querySelector<HTMLInputElement>('.sky-plan-category input')?.value === value,
              value,
            )
          const choose = async (value: string) => {
            await category.click()
            await page.getByRole('option', { name: value, exact: true }).click()
          }
          const save = async (words: string) => {
            await form.getByRole('textbox', { name: 'Entry time' }).fill('09:30')
            await add.click()
            await block.locator('.sky-prow').filter({ hasText: words }).waitFor()
          }
          try {
            await add.click()
            await page.waitForTimeout(650)
            await text.fill('Water')
            await page.waitForTimeout(300)
            await text.fill('Water the plants')
            await page.waitForTimeout(300)
            assert({
              given: 'an empty draft followed by continuous typing',
              should: 'make no requests until the typing pause',
              actual: calls,
              expected: [],
            })
            await selected('Personal')
            assert({
              given: 'the completed typing pause',
              should: 'classify just the latest text without moving focus',
              actual: [calls, await text.evaluate((node) => document.activeElement === node)],
              expected: [['Water the plants'], true],
            })
            const screenshot = env.get('SKY_BROWSER_SCREENSHOT')
            if (screenshot) await form.screenshot({ path: `${screenshot}-category-${width}.png` })
            await save('Water the plants')
            assert({
              given: 'an automatically selected Personal entry',
              should: 'save it under Personal Complete',
              actual: DayDocument.fromMarkdown(await readFile(file, 'utf8')).lists.find(
                (list) => list.title === 'Personal Complete',
              )?.items,
              expected: ['09:30 > Water the plants'],
            })

            await add.click()
            const old = hold('Plan the family picnic')
            await text.fill('Plan the family picnic')
            await old.started.promise
            const latest = page.waitForResponse(
              (response) =>
                response.url().endsWith('/item/category') &&
                response.request().postDataJSON().text === 'Prepare the Atlas proposal',
            )
            await text.fill('Prepare the Atlas proposal')
            await (await latest).finished()
            old.release.resolve()
            await old.finished.promise
            await page.waitForTimeout(100)
            assert({
              given: 'an old Personal answer arrives after the new Professional answer',
              should: 'retain the category for the latest words',
              actual: await category.inputValue(),
              expected: 'Professional',
            })

            const manual = hold('Review the Atlas budget')
            await text.fill('Review the Atlas budget')
            await manual.started.promise
            await choose('Personal')
            manual.release.resolve()
            await manual.finished.promise
            const beforeManualEdit = calls.length
            await text.fill('Review the Atlas budget notes')
            await page.waitForTimeout(700)
            assert({
              given: 'a manual category chosen during a pending request, followed by more typing',
              should: 'preserve the manual choice and stop requesting suggestions for this item',
              actual: [await category.inputValue(), calls.length],
              expected: ['Personal', beforeManualEdit],
            })
            await save('Review the Atlas budget notes')

            await add.click()
            await text.fill('Sort the storage closet')
            await form.getByRole('status').filter({ hasText: 'Automatic category selection is unavailable' }).waitFor()
            assert({
              given: 'a fresh item whose category service is unavailable',
              should: 'reset the previous manual choice and keep saving available',
              actual: [await category.inputValue(), await add.isEnabled(), await text.inputValue()],
              expected: ['Professional', true, 'Sort the storage closet'],
            })
            await choose('Personal')
            await save('Sort the storage closet')

            await add.click()
            const cleared = hold('Plan the family picnic')
            await text.fill('Plan the family picnic')
            await cleared.started.promise
            await text.fill('')
            cleared.release.resolve()
            await cleared.finished.promise
            await page.waitForTimeout(100)
            assert({
              given: 'the text is cleared while its category is being chosen',
              should: 'discard the old answer and keep the empty draft unchanged',
              actual: [await text.inputValue(), await category.inputValue()],
              expected: ['', 'Professional'],
            })
            const beforeCancel = calls.length
            await text.fill('Water the plants')
            await form.getByRole('button', { name: 'Cancel', exact: true }).click()
            await page.waitForTimeout(700)
            assert({
              given: 'a draft closed before the typing debounce finishes',
              should: 'cancel the pending suggestion without a request',
              actual: calls.length,
              expected: beforeCancel,
            })

            for (const [openLabel, formLabel] of [
              ['Add a to-do', 'Add a to-do'],
              ['Add a commitment', 'Add a commitment'],
            ]) {
              await page.getByRole('button', { name: openLabel, exact: true }).click()
              const draft = page.getByRole('form', { name: formLabel, exact: true })
              await draft.getByRole('textbox', { name: 'Item text', exact: true }).fill('Water the plants')
              await selected('Personal')
              await draft.getByRole('button', { name: 'Cancel', exact: true }).click()
            }
            await page.getByRole('button', { name: 'Add a reminder', exact: true }).click()
            const reminder = page.getByRole('form', { name: 'Add a reminder', exact: true })
            const beforeReminder = calls.length
            await reminder.getByRole('textbox', { name: 'Item text', exact: true }).fill('Water the plants')
            await page.waitForTimeout(700)
            assert({
              given: 'a reminder without a category field',
              should: 'make no category request',
              actual: calls.length,
              expected: beforeReminder,
            })
            await reminder.getByRole('button', { name: 'Cancel', exact: true }).click()

            const title = await page.title()
            await page.reload()
            await page.waitForFunction(() => document.title.includes('January 27, 2026'))
            await page.goto(`${origin}/${DAY.addDays(1).ymd}?view=record`)
            await page.waitForFunction(() => document.title.includes('January 28, 2026'))
            await page.goBack()
            await page.waitForFunction(() => document.title.includes('January 27, 2026'))
            await page.goForward()
            await page.waitForFunction(() => document.title.includes('January 28, 2026'))
            assert({
              given: 'saved entries, reload and browser history navigation',
              should: 'retain their categories, day titles and responsive layout without browser errors',
              actual: [
                DayDocument.fromMarkdown(await readFile(file, 'utf8')).lists.find(
                  (list) => list.title === 'Personal Complete',
                )?.items,
                title,
                await page.title(),
                await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
                errors,
              ],
              expected: [
                [
                  '09:30 > Review the Atlas budget notes',
                  '09:30 > Sort the storage closet',
                  '09:30 > Water the plants',
                ],
                'sky · Tuesday, January 27, 2026 · Day record',
                'sky · Wednesday, January 28, 2026 · Day record',
                false,
                [],
              ],
            })
          } finally {
            for (const gate of held.values()) gate.release.resolve()
          }
        },
      )
    },
  )
