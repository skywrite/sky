import { readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, Week, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-01-27')
const TARGET = DAY.addDays(1)
const LATER = new PlainDate('2026-02-02')
const SCHEDULE = `## ${LATER.ymd}\n\n- Review the budget\n  Keep the scheduled notes.\n`
const SOURCE = `---
started: 08:00
ended:
---

## Professional Todos

- Review the budget
  Keep the source notes.
- Review the budget
  Keep the source notes.
- Share the outline
`
const DESTINATION = `---
started: 08:00
ended:
---

## Professional Todos

- Review the budget
  Keep the existing notes.
`

test({ name: 'duplicate moves and individual row actions work on desktop and mobile', timeout: 90000 }, async (t) => {
  await runWysiwygE2e(
    t,
    {
      initialMarkdown: SOURCE,
      file: `time/${dayFile(DAY)}`,
      files: { [`time/${dayFile(TARGET)}`]: DESTINATION, 'time/schedule-professional.md': SCHEDULE },
      tempPrefix: 'day-duplicates-',
      day: true,
      now: new ZonedDateTime('2026-01-28T14:00:00', 'UTC'),
    },
    async ({ page: desktop, origin, file }) => {
      const targetFile = path.join(file.slice(0, -dayFile(DAY).length), dayFile(TARGET))
      const scheduleFile = path.join(file.slice(0, -dayFile(DAY).length), 'schedule-professional.md')
      for (const mobile of [false, true]) {
        const context = await desktop
          .context()
          .browser()!
          .newContext({
            viewport: mobile ? { width: 390, height: 844 } : { width: 1500, height: 1000 },
            isMobile: mobile,
            hasTouch: mobile,
          })
        const page = await context.newPage()
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        page.on('console', (message) => {
          if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text())
        })
        await page.route('**/schedule', (route) => route.fulfill({ json: { read: true, errors: [], meetings: [] } }))
        try {
          await writeFile(file, SOURCE)
          await writeFile(targetFile, DESTINATION)
          await writeFile(scheduleFile, SCHEDULE)
          await page.goto(`${origin}/${DAY.ymd}`)
          await page.locator('.sky-prow').first().waitFor()
          const sourceTitle = await page.title()

          await page.getByRole('button', { name: 'End Tuesday', exact: true }).click()
          const ending = page.locator('.sky-end')
          const endCheck = page.waitForResponse((response) => response.url().endsWith('/item'))
          await ending.getByRole('button', { name: 'Mark done: Review the budget', exact: true }).nth(1).click()
          assert({
            given: 'two identical tasks in the End dialog',
            should: 'complete only the selected copy',
            actual: (await endCheck).status(),
            expected: 200,
          })
          await ending.locator('.sky-end-row[data-done="true"]').waitFor()
          assert({
            given: 'one completed copy',
            should: 'leave the other task open in the dialog',
            actual: await ending.locator('.sky-end-row[data-done="true"]').count(),
            expected: 1,
          })
          const endUncheck = page.waitForResponse((response) => response.url().endsWith('/item'))
          await ending.getByRole('button', { name: 'Mark not done: Review the budget', exact: true }).click()
          await endUncheck
          await ending.locator('.sky-end-row[data-done="true"]').waitFor({ state: 'detached' })
          await ending.getByRole('button', { name: 'Not yet', exact: true }).click()

          await page.getByRole('button', { name: 'Organize', exact: true }).click()
          await page.getByRole('checkbox', { name: 'Select Review the budget', exact: true }).nth(1).click()
          assert({
            given: 'one of two identical rows selected',
            should: 'select that row independently',
            actual: await page.locator('.sky-organize-count').innerText(),
            expected: '1 selected',
          })
          await page.getByRole('button', { name: 'Select all', exact: true }).click()
          await page.getByRole('button', { name: 'Choose date…', exact: true }).click()
          const calendar = page.getByRole('dialog')
          await calendar.locator(`[data-date="${TARGET.ymd}"]`).click()
          const move = page.waitForResponse((response) => response.url().endsWith('/item/organize/move'))
          await calendar.getByRole('button', { name: 'Move 3 items', exact: true }).click()
          assert({
            given: 'a bulk move to a day containing a matching task',
            should: 'move every selected row',
            actual: (await move).status(),
            expected: 200,
          })
          await calendar.waitFor({ state: 'detached' })
          const moved = await readFile(targetFile, 'utf8')
          assert({
            given: 'the saved destination',
            should: 'keep all copies and their notes',
            actual: {
              copies: moved.match(/- Review the budget/g)?.length,
              sourceNotes: moved.match(/Keep the source notes/g)?.length,
              existing: moved.includes('Keep the existing notes.'),
            },
            expected: { copies: 3, sourceNotes: 2, existing: true },
          })
          await page.locator('.sky-organize-toast').getByRole('button', { name: 'Open date', exact: true }).click()
          await page.waitForURL(`${origin}/${TARGET.ymd}`)
          const copies = page.locator('.sky-prow').filter({ hasText: 'Review the budget' })
          await copies.nth(2).waitFor()
          const targetTitle = await page.title()
          await page.goBack()
          await page.locator('.sky-organize-toast').waitFor({ state: 'detached' })
          await page.waitForFunction((title) => document.title === title, sourceTitle)
          const backTitle = await page.title()
          await page.goForward()
          await copies.nth(2).waitFor()
          await page.waitForFunction((title) => document.title === title, targetTitle)
          assert({
            given: 'navigation and browser history between days',
            should: 'keep meaningful day titles in sync',
            actual: { distinct: targetTitle !== sourceTitle, source: backTitle, forward: await page.title() },
            expected: { distinct: true, source: sourceTitle, forward: targetTitle },
          })

          const check = page.waitForResponse((response) => response.url().endsWith('/item'))
          await copies.nth(2).getByRole('button', { name: 'Mark done', exact: true }).click()
          assert({
            given: 'checking a moved duplicate',
            should: 'save successfully',
            actual: (await check).status(),
            expected: 200,
          })
          await page.getByRole('button', { name: 'Mark not done', exact: true }).waitFor()
          assert({
            given: 'one checked duplicate',
            should: 'keep both other copies open',
            actual: await page.getByRole('button', { name: 'Mark not done', exact: true }).count(),
            expected: 1,
          })
          await page.getByRole('button', { name: 'Undo', exact: true }).click()
          await page.getByRole('button', { name: 'Mark not done', exact: true }).waitFor({ state: 'detached' })

          await copies.nth(2).getByRole('button', { name: 'Item details', exact: true }).click()
          const details = page.getByRole('dialog')
          await details.getByRole('textbox', { name: 'Item text', exact: true }).fill('Review the revised budget')
          const edit = page.waitForResponse((response) => response.url().endsWith('/item/edit'))
          await details.getByRole('button', { name: 'Save changes', exact: true }).click()
          assert({
            given: 'editing a moved duplicate',
            should: 'save that row independently',
            actual: (await edit).status(),
            expected: 200,
          })
          await details.waitFor({ state: 'detached' })
          await page.locator('.sky-item-edit-undo').getByRole('button', { name: 'Undo', exact: true }).click()
          await copies.nth(2).waitFor()

          await copies.nth(2).getByRole('button', { name: 'Item details', exact: true }).click()
          const deletion = page.waitForResponse((response) => response.url().endsWith('/item/delete'))
          await details.getByRole('button', { name: 'Delete', exact: true }).click()
          assert({
            given: 'deleting one duplicate',
            should: 'remove that row independently',
            actual: (await deletion).status(),
            expected: 200,
          })
          await page.waitForFunction(() => document.querySelectorAll('.sky-prow').length === 3)
          await page.getByRole('button', { name: 'Undo', exact: true }).click()
          await copies.nth(2).waitFor()
          assert({
            given: 'Undo after editing, checking and deleting individual duplicates',
            should: 'restore all destination bytes with no browser errors',
            actual: { destination: await readFile(targetFile, 'utf8'), errors },
            expected: { destination: moved, errors: [] },
          })

          await page.getByRole('button', { name: 'Organize', exact: true }).click()
          await page.getByRole('button', { name: 'Select all', exact: true }).click()
          await page.getByRole('button', { name: 'Choose date…', exact: true }).click()
          await calendar.getByRole('button', { name: 'Next month', exact: true }).click()
          await calendar.locator(`[data-date="${LATER.ymd}"]`).click()
          const schedule = page.waitForResponse((response) => response.url().endsWith('/item/organize/move'))
          await calendar.getByRole('button', { name: 'Move 4 items', exact: true }).click()
          assert({
            given: 'a move beyond this week with matching scheduled rows',
            should: 'keep every selected copy',
            actual: (await schedule).status(),
            expected: 200,
          })
          await page.locator('.sky-organize-toast').getByRole('button', { name: 'Open date', exact: true }).click()
          await page.waitForURL(`${origin}/week/${Week.of(LATER)}`)
          const scheduledCopies = page.locator('.sky-qrow').filter({ hasText: 'Review the budget' })
          await scheduledCopies.nth(3).waitFor()
          await page.waitForFunction(() => document.title.includes('Week 2026-W06'))
          const remove = page.waitForResponse((response) => response.url().endsWith('/queue/remove'))
          await scheduledCopies.nth(3).getByRole('button', { name: 'Remove', exact: true }).click()
          assert({
            given: 'removing one scheduled duplicate',
            should: 'remove that copy independently',
            actual: (await remove).status(),
            expected: 200,
          })
          await page.waitForFunction(
            () =>
              [...document.querySelectorAll('.sky-qrow')].filter((row) =>
                row.textContent?.includes('Review the budget'),
              ).length === 3,
          )
          assert({
            given: 'duplicate rows displayed and changed on a future week',
            should: 'preserve the existing scheduled copy and raise no browser errors',
            actual: { existing: (await readFile(scheduleFile, 'utf8')).includes('Keep the scheduled notes.'), errors },
            expected: { existing: true, errors: [] },
          })
        } finally {
          await context.close()
        }
      }
    },
  )
})
