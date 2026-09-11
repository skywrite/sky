import { readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-01-27')
const FILE = path.posix.join('time', dayFile(DAY))
const BRIEF = path.posix.join('time', dayDir(DAY), 'brief.md')
const CONTENT = `---
started: 08:00
ended:
tz: America/Chicago
---

# A sample day

## Professional Todos

- Review the outline
  Keep this note with the task.
- Read [Atlas brief](brief.md)
- ~~Send the checklist~~

## Personal Commitments

- 09:30 > Call Jane Doe

## Reminders

- Water the plants
`

test(
  { name: 'day quick edits carry drafts into Details, preserve links and completion, and offer Undo', timeout: 45000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: CONTENT,
        file: FILE,
        tempPrefix: 'day-edit-browser-',
        files: { [BRIEF]: '# Atlas brief\n' },
        day: true,
      },
      async ({ page, origin, file, errors }) => {
        await page.setViewportSize({ width: 1500, height: 1000 })
        await page.goto(`${origin}/${DAY.ymd}`)
        const row = (text: string) => page.locator('.sky-prow').filter({ hasText: text })
        const input = page.getByRole('textbox', { name: 'Item text', exact: true })
        await row('Review the outline').locator('.sky-ptext').dblclick()
        await input.fill('Review the revised outline')
        assert({
          given: 'an unsaved inline edit',
          should: 'keep the file unchanged',
          actual: await readFile(file, 'utf8'),
          expected: CONTENT,
        })
        await page.locator('.sky-item-inline-actions').getByRole('button', { name: 'Details', exact: true }).click()
        await page.getByRole('dialog', { name: 'Item details' }).waitFor()
        assert({
          given: 'an inline draft opened in Details',
          should: 'carry the text into the full editor',
          actual: await input.inputValue(),
          expected: 'Review the revised outline',
        })
        await page.getByRole('button', { name: 'Add a time', exact: true }).click()
        await page.getByRole('button', { name: 'Save changes', exact: true }).click()
        await page.getByRole('alert').filter({ hasText: 'Enter a time' }).waitFor()
        await page.getByRole('textbox', { name: 'Time', exact: true }).fill('25:30')
        await page.getByRole('combobox', { name: 'Category', exact: true }).click()
        await page.getByRole('option', { name: 'Personal', exact: true }).click()
        await page.getByRole('button', { name: 'Save changes', exact: true }).click()
        await page.getByRole('dialog').waitFor({ state: 'detached' })
        await row('Review the revised outline').waitFor()
        assert({
          given: 'a quick text edit expanded into rescheduling',
          should: 'save the entire task in its new section with notes intact',
          actual: (await readFile(file, 'utf8')).includes(
            '- 25:30 > Review the revised outline\n  Keep this note with the task.',
          ),
          expected: true,
        })
        await page.locator('.sky-item-edit-undo').getByRole('button', { name: 'Undo', exact: true }).click()
        await row('Review the outline').waitFor()
        assert({
          given: 'Undo immediately after editing',
          should: 'restore the original file',
          actual: await readFile(file, 'utf8'),
          expected: CONTENT,
        })

        await row('Send the checklist').locator('.sky-ptext').dblclick()
        await input.fill('Send the final checklist')
        await input.press('Enter')
        await row('Send the final checklist').waitFor()
        assert({
          given: 'renaming a completed task',
          should: 'keep completion',
          actual: (await readFile(file, 'utf8')).includes('- ~~Send the final checklist~~'),
          expected: true,
        })
        await row('Read Atlas brief').getByRole('button', { name: 'Item details', exact: true }).click()
        assert({
          given: 'a linked item opened through Details',
          should: 'retain the editable Markdown link',
          actual: await input.inputValue(),
          expected: 'Read [Atlas brief](brief.md)',
        })
        await input.fill('Read [Atlas launch brief](brief.md)')
        await page.getByRole('button', { name: 'Save changes', exact: true }).click()
        await page.getByRole('dialog').waitFor({ state: 'detached' })
        await page.getByRole('link', { name: 'Read Atlas launch brief', exact: true }).click()
        await page.waitForURL(`**/explorer/${BRIEF}`)
        assert({
          given: 'the edited link opened',
          should: 'navigate normally without browser errors',
          actual: errors,
          expected: [],
        })
      },
    )
  },
)

test(
  { name: 'mobile tap edits inline, Details is reachable, and the sheet fits above the keyboard', timeout: 45000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: CONTENT, file: FILE, tempPrefix: 'day-edit-touch-', day: true },
      async ({ page: desktop, origin, file, errors }) => {
        const context = await desktop
          .context()
          .browser()!
          .newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
        try {
          const page = await context.newPage()
          page.on('pageerror', (error) => errors.push(error.message))
          await page.goto(`${origin}/${DAY.ymd}`)
          const row = page.locator('.sky-prow').filter({ hasText: 'Water the plants' })
          const details = row.getByRole('button', { name: 'Item details', exact: true })
          assert({
            given: 'a touch device with no hover',
            should: 'show a finger-sized Details control',
            actual: await details.evaluate((button) => ({
              opacity: getComputedStyle(button).opacity,
              width: button.getBoundingClientRect().width,
              height: button.getBoundingClientRect().height,
            })),
            expected: { opacity: '1', width: 44, height: 44 },
          })
          await row.locator('.sky-ptext').tap()
          const input = page.getByRole('textbox', { name: 'Item text', exact: true })
          await input.fill('Water the garden before breakfast')
          await page.evaluate(() => {
            Object.defineProperties(window.visualViewport!, {
              height: { configurable: true, value: 420 },
              offsetTop: { configurable: true, value: 60 },
            })
            window.visualViewport!.dispatchEvent(new Event('resize'))
          })
          await page.waitForFunction(() => {
            const input = document.querySelector('.sky-item-inline textarea')?.getBoundingClientRect()
            const toolbar = document.querySelector('.sky-item-mobile-actions')?.getBoundingClientRect()
            return input && toolbar && input.top >= 60 && input.bottom <= toolbar.top && toolbar.bottom <= 480
          })
          await page.locator('.sky-item-mobile-actions').getByRole('button', { name: 'Details', exact: true }).tap()
          await page.getByRole('dialog', { name: 'Item details' }).waitFor()
          assert({
            given: 'a mobile inline draft expanded into the sheet',
            should: 'retain the text',
            actual: await input.inputValue(),
            expected: 'Water the garden before breakfast',
          })
          // Headless browsers do not display an OS keyboard. Model its reduced visual viewport.
          await page.evaluate(() => {
            Object.defineProperties(window.visualViewport!, {
              height: { configurable: true, value: 420 },
              offsetTop: { configurable: true, value: 60 },
            })
            window.visualViewport!.dispatchEvent(new Event('resize'))
          })
          await page.waitForFunction(() => {
            const save = [...document.querySelectorAll('button')].find(
              (button) => button.textContent === 'Save changes',
            )
            const bounds = save?.getBoundingClientRect()
            return bounds && bounds.top >= 60 && bounds.bottom <= 480
          })
          assert({
            given: 'the keyboard reducing and panning the visible viewport',
            should: 'keep the save action visible without horizontal overflow',
            actual: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            expected: false,
          })
          await page.getByRole('button', { name: 'Save changes', exact: true }).tap()
          await page.getByRole('dialog').waitFor({ state: 'detached' })
          await page.locator('.sky-prow').filter({ hasText: 'Water the garden before breakfast' }).waitFor()
          assert({
            given: 'a mobile edit saved from the sheet',
            should: 'write the new reminder',
            actual: (await readFile(file, 'utf8')).includes('- Water the garden before breakfast'),
            expected: true,
          })
          assert({ given: 'both mobile edit paths', should: 'produce no browser errors', actual: errors, expected: [] })
        } finally {
          await context.close()
        }
      },
    )
  },
)

test(
  { name: 'day editing retains drafts on write failure and when the day ends, and Escape cancels', timeout: 45000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: CONTENT, file: FILE, tempPrefix: 'day-edit-failures-', day: true },
      async ({ page, origin, file, errors }) => {
        await page.goto(`${origin}/${DAY.ymd}`)
        const row = page.locator('.sky-prow').filter({ hasText: 'Review the outline' })
        const input = page.getByRole('textbox', { name: 'Item text', exact: true })
        await row.locator('.sky-ptext').dblclick()
        await input.fill('An unsaved draft')
        await input.press('Escape')
        await input.waitFor({ state: 'detached' })
        assert({
          given: 'Escape from an inline edit',
          should: 'leave the original file intact',
          actual: await readFile(file, 'utf8'),
          expected: CONTENT,
        })
        await row.locator('.sky-ptext').dblclick()
        await input.fill('Keep this draft')
        await page.route('**/item/edit', (route) => route.abort(), { times: 1 })
        await input.press('Enter')
        await page.locator('.sky-item-inline .sky-plan-error').waitFor()
        assert({
          given: 'a network failure while saving',
          should: 'retain the draft for retry',
          actual: await input.inputValue(),
          expected: 'Keep this draft',
        })
        await writeFile(file, CONTENT.replace('ended:\n', 'ended: 13.5h\n'))
        await input.press('Enter')
        await page.getByRole('dialog', { name: 'Item details' }).waitFor()
        assert({
          given: 'the day ending while an edit is open',
          should: 'preserve a copyable draft and disable saving',
          actual: {
            text: await input.inputValue(),
            disabled: await page.getByRole('button', { name: 'Save changes', exact: true }).isDisabled(),
          },
          expected: { text: 'Keep this draft', disabled: true },
        })
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
        await page.getByRole('dialog').waitFor({ state: 'detached' })
        assert({
          given: 'returning to an ended day',
          should: 'show no editing actions',
          actual: await page.locator('.sky-prow button').count(),
          expected: 0,
        })
        const unexpected = errors.filter(
          (error) => !error.includes('net::ERR_FAILED') && !error.includes('409 (Conflict)'),
        )
        assert({
          given: 'expected failed requests',
          should: 'have no other browser errors',
          actual: unexpected,
          expected: [],
        })
        errors.splice(0, errors.length, ...unexpected)
      },
    )
  },
)
