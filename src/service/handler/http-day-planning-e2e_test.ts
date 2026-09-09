import { readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-01-27')
const FILE = path.posix.join('time', dayFile(DAY))
const EMPTY = '---\nstarted: 08:00\nended:\ntz: America/Chicago\n---\n\n# 2026-01-27\n\n## Notes\n\nA sample day.\n'
const NEXT =
  '# Professional\n\n## Next\n\n- Read [Atlas brief][brief]\n- Review the outline\n\n[brief]: ../projects/Atlas/launch%20brief.md#summary "Launch details"\n'
const PERSONAL = '# Personal\n\n## Next\n\n- Water the plants\n'

test(
  { name: 'day composers add todos, reminders and timed commitments on desktop and mobile', timeout: 45000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: EMPTY, tempPrefix: 'day-planning-', file: FILE, day: true },
      async ({ page, origin, file, errors }) => {
        await page.setViewportSize({ width: 1500, height: 1000 })
        await page.goto(`${origin}/${DAY.ymd}`)
        const text = page.getByRole('textbox', { name: 'Item text', exact: true })
        await page.getByRole('button', { name: 'Add a to-do', exact: true }).click()
        await text.fill('Review the launch outline')
        await text.press('Enter')
        await page.locator('.sky-ptext').filter({ hasText: 'Review the launch outline' }).waitFor()
        await page.getByRole('button', { name: 'Add a commitment', exact: true }).click()
        await text.fill('Call Jane Doe')
        await page.getByRole('button', { name: 'Add commitment', exact: true }).click()
        await page.getByRole('alert').filter({ hasText: 'Enter a time' }).waitFor()
        await page.getByRole('textbox', { name: 'Commitment time' }).fill('9:30')
        await text.press('Enter')
        await page.locator('.sky-prow').filter({ hasText: 'Call Jane Doe' }).waitFor()
        assert({
          given: 'an empty day on desktop',
          should: 'add a to-do and require a commitment time',
          actual: [
            (await readFile(file, 'utf8')).includes('- Review the launch outline'),
            (await readFile(file, 'utf8')).includes('- 09:30 > Call Jane Doe'),
            await page.getByRole('button', { name: 'Add a file' }).innerText(),
          ],
          expected: [true, true, 'Add file'],
        })

        await page.setViewportSize({ width: 390, height: 844 })
        await page.getByRole('button', { name: 'Add a reminder', exact: true }).click()
        await text.fill('Leave space for a walk')
        await page.getByRole('button', { name: 'Add reminder', exact: true }).click()
        await page.locator('.sky-ptext').filter({ hasText: 'Leave space for a walk' }).waitFor()
        await page.getByRole('button', { name: 'Add a to-do', exact: true }).click()
        await text.fill('Send the handoff')
        await page.getByRole('button', { name: 'Add a time', exact: true }).click()
        await page.getByRole('textbox', { name: 'Commitment time' }).fill('25:30')
        await page.getByRole('button', { name: 'Add commitment', exact: true }).click()
        await page.locator('.sky-prow').filter({ hasText: 'Send the handoff' }).waitFor()
        const toast = page.locator('.sky-plan-undo')
        await toast.getByRole('button', { name: 'Undo', exact: true }).click()
        await page.locator('.sky-prow').filter({ hasText: 'Send the handoff' }).waitFor({ state: 'detached' })
        await page.getByRole('button', { name: 'Add a commitment', exact: true }).click()
        await text.fill('Book a desk')
        await page.getByRole('button', { name: 'Remove time' }).click()
        await page.getByRole('button', { name: 'Add to-do', exact: true }).click()
        await page.locator('.sky-prow').filter({ hasText: 'Book a desk' }).waitFor()
        const content = await readFile(file, 'utf8')
        assert({
          given: 'mobile additions, adding and removing times, and Undo',
          should: 'save the correct lists with no overflow or browser errors',
          actual: {
            reminder: content.includes('- Leave space for a walk'),
            undone: !content.includes('Send the handoff'),
            converted: content.includes('- Book a desk'),
            overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            errors,
          },
          expected: { reminder: true, undone: true, converted: true, overflow: false, errors: [] },
        })
        await page.reload()
        await page.locator('.sky-ptext').filter({ hasText: 'Book a desk' }).waitFor()
      },
    )
  },
)

test(
  { name: 'Next picker moves untimed items, keeps source links, and undoes from mobile', timeout: 45000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: EMPTY,
        tempPrefix: 'day-next-',
        file: FILE,
        day: true,
        files: {
          'time/next-professional.md': NEXT,
          'time/next-personal.md': PERSONAL,
          'time/schedule-professional.md': '# Schedule\n\n## 2026-01-27\n\n- 09:30 > A scheduled meeting\n',
          'projects/Atlas/launch brief.md': '# Atlas\n\nA sample brief.\n',
        },
      },
      async ({ page, origin, file, errors }) => {
        await page.setViewportSize({ width: 1500, height: 1000 })
        await page.goto(`${origin}/${DAY.ymd}`)
        await page.getByRole('button', { name: 'From next lists', exact: true }).click()
        let dialog = page.getByRole('dialog')
        await dialog.getByRole('checkbox', { name: 'Read Atlas brief', exact: true }).check()
        await dialog.getByRole('textbox', { name: 'Search next lists' }).fill('Water')
        await dialog.getByRole('checkbox', { name: 'Water the plants', exact: true }).check()
        await dialog.getByRole('button', { name: 'Move 2 to this day', exact: true }).click()
        await dialog.waitFor({ state: 'detached' })
        const link = page.locator('.sky-ptext').getByRole('link', { name: 'Read Atlas brief', exact: true })
        await link.waitFor()
        const linkedDocument = await page.request.get(`${origin}${await link.getAttribute('href')}`)
        assert({
          given: 'a moved reference link with a title, encoded space and fragment',
          should: 'open its original document',
          actual: linkedDocument.status(),
          expected: 200,
        })
        assert({
          given: 'a selection across both sources and a search change',
          should: 'move both items and preserve the notebook link',
          actual: [
            await link.getAttribute('href'),
            await page.locator('.sky-ptext').filter({ hasText: 'Water the plants' }).count(),
          ],
          expected: ['/explorer/projects/Atlas/launch%20brief.md#summary', 1],
        })
        await page.locator('.sky-plan-undo').getByRole('button', { name: 'Undo', exact: true }).click()
        await link.waitFor({ state: 'detached' })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.getByRole('button', { name: 'From next lists', exact: true }).click()
        dialog = page.getByRole('dialog')
        await dialog.getByRole('textbox', { name: 'Search next lists' }).fill('')
        await dialog.getByRole('checkbox', { name: 'Water the plants', exact: true }).check()
        await dialog.getByRole('combobox', { name: 'Move to', exact: true }).click()
        await page.getByRole('option', { name: 'Reminders', exact: true }).click()
        const move = dialog.getByRole('button', { name: 'Move 1 to this day', exact: true })
        const box = await move.boundingBox()
        assert({
          given: 'the mobile Next sheet',
          should: 'offer untimed destinations and keep the action in the viewport',
          actual: [
            await dialog.getByRole('textbox', { name: 'Commitment time' }).count(),
            Boolean(box && box.y >= 0 && box.y + box.height <= 844),
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          ],
          expected: [0, true, false],
        })
        await move.click()
        await dialog.waitFor({ state: 'detached' })
        await page.locator('.sky-ptext').filter({ hasText: 'Water the plants' }).waitFor()
        await page.locator('.sky-plan-undo').getByRole('button', { name: 'Undo', exact: true }).click()
        await page.locator('.sky-ptext').filter({ hasText: 'Water the plants' }).waitFor({ state: 'detached' })
        const root = path.resolve(file, ...FILE.split('/').map(() => '..'))
        assert({
          given: 'both moves undone',
          should: 'restore the day and Next files without touching the schedule',
          actual: [
            await readFile(file, 'utf8'),
            await readFile(path.join(root, 'time/next-professional.md'), 'utf8'),
            await readFile(path.join(root, 'time/next-personal.md'), 'utf8'),
            errors,
          ],
          expected: [EMPTY, NEXT, PERSONAL, []],
        })
        await writeFile(file, EMPTY.replace('ended:', 'ended: 17:00'))
        await page.reload()
        await page.locator('.sky-day-ended').waitFor()
        assert({
          given: 'the ended day',
          should: 'hide all planning controls',
          actual: [
            await page.getByRole('button', { name: /^Add a (to-do|commitment|reminder)$/ }).count(),
            await page.getByRole('button', { name: 'From next lists' }).count(),
          ],
          expected: [0, 0],
        })
      },
    )
  },
)
