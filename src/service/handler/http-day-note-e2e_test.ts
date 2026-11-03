// A note written on the day's page: New note opens a blank page under the day, the first save files
// it the way notes:new does, the "/" menu inserts blocks, and the Markdown view edits the same file.
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-10-28')
const DAY_MD = `---
date: ${DAY.ymd}
---

# **${DAY.ymd}**

## Professional Complete

- 11:00 > Called Jamal about the pilot

## Personal Complete

-
`
const OPTIONS = {
  initialMarkdown: DAY_MD,
  file: path.posix.join('time', dayFile(DAY)),
  day: true,
  now: new ZonedDateTime('2026-10-28T10:30:00', 'UTC'),
}

/** The file's text once it says what is asked of it; a note saves a moment after the last key. */
async function settled(file: string, wanted: (text: string) => boolean): Promise<string> {
  let text = ''
  for (let tries = 0; tries < 50; tries++) {
    text = await readFile(file, 'utf8').catch(() => '')
    if (wanted(text)) return text
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return text
}

test(
  { name: 'day note — New note on the day files a note under it, lists it, and opens it again', timeout: 60000 },
  async (t) => {
    await runWysiwygE2e(t, { ...OPTIONS, tempPrefix: 'day-note-new-' }, async ({ page, origin, file, errors }) => {
      // The calendar stays out of the test: the rail's schedule reads no account.
      await page.route('**/day/*/schedule', (route) =>
        route.fulfill({ json: { read: true, errors: [], meetings: [] } }),
      )
      await page.route('**/chat', (route) => route.fulfill({ json: { threads: [] } }))
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto(`${origin}/${DAY.ymd}`)
      await page.locator('.sky-day-note-entry').getByRole('link', { name: 'New note', exact: true }).click()
      await page.waitForSelector('.sky-note-editor')
      const blankTitle = await page.title()
      await page.keyboard.type('Atlas launch plan')
      await page.keyboard.press('Enter')
      await page.keyboard.type('Launch moves to November 12.')
      const note = path.join(path.dirname(file), 'actions', 'notes', 'Atlas-launch-plan.md')
      const written = await settled(note, (text) => text.includes('Launch moves to November 12.'))
      await page.waitForFunction(() => location.pathname.endsWith('/notes/Atlas-launch-plan'))
      const savedTitle = await page.title()
      const day = await readFile(file, 'utf8')

      await page.locator('.sky-crumb').first().click()
      const listed = page.locator('.sky-rec-line a', { hasText: 'Atlas launch plan' })
      const href = await listed.getAttribute('href')
      await listed.click()
      await page.waitForSelector('.sky-note-editor')
      const reopened = await page.locator('.sky-note-editor').innerText()

      assert({
        given: 'New note on the day, a title, Enter, and a line',
        should:
          'save the note with its summary, time and type, list it under Professional Complete and in Notes, and open it from there',
        actual: [
          blankTitle,
          written,
          savedTitle,
          day.includes('- 10:30 > Notes -> [Atlas launch plan](actions/notes/Atlas-launch-plan.md)'),
          href,
          reopened.includes('Launch moves to November 12.'),
          errors,
        ],
        expected: [
          'sky · New note',
          '---\nsummary: Atlas launch plan\nwhen: 10:30\ntype: Notes\n---\n\n# Atlas launch plan\n\nLaunch moves to November 12.\n',
          'sky · Atlas launch plan',
          true,
          '/2026-10-28/notes/Atlas-launch-plan',
          true,
          [],
        ],
      })
    })
  },
)

test(
  { name: 'day note — the / menu inserts a table, and the Markdown view edits the same file', timeout: 60000 },
  async (t) => {
    await runWysiwygE2e(t, { ...OPTIONS, tempPrefix: 'day-note-blocks-' }, async ({ page, origin, file, errors }) => {
      await page.route('**/day/*/schedule', (route) =>
        route.fulfill({ json: { read: true, errors: [], meetings: [] } }),
      )
      await page.route('**/chat', (route) => route.fulfill({ json: { threads: [] } }))
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto(`${origin}/${DAY.ymd}/notes/new`)
      await page.waitForSelector('.sky-note-editor')
      await page.keyboard.type('Owners')
      await page.keyboard.press('Enter')
      await page.keyboard.type('/ta')
      const offered = await page.locator('.sky-insert-option').allInnerTexts()
      await page.keyboard.press('Enter')
      await page.keyboard.type('Area')
      await page.keyboard.press('Tab')
      await page.keyboard.type('Owner')
      const note = path.join(path.dirname(file), 'actions', 'notes', 'Owners.md')
      const withTable = await settled(note, (text) => text.includes('| Area | Owner |'))

      await page.getByText('Markdown', { exact: true }).click()
      const source = page.getByRole('textbox', { name: 'Markdown', exact: true })
      const shownAsMarkdown = (await source.inputValue()).startsWith('---\nsummary: Owners\n')
      await source.fill(`${await source.inputValue()}\nWritten as markdown.`)
      const fromMarkdown = await settled(note, (text) => text.includes('Written as markdown.'))
      await page.getByText('Rich text', { exact: true }).click()
      await page.waitForSelector('.sky-note-editor')

      assert({
        given: 'a title, "/ta" and Enter, two header cells, then a line added in the Markdown view',
        should:
          'offer Table first, write a table, show the whole file as markdown, and keep the Markdown edit in both views',
        actual: [
          offered.map((text) => text.split('\n')[0]),
          withTable.includes('| Area | Owner |\n| ---- | ----- |\n|      |       |'),
          shownAsMarkdown,
          fromMarkdown.trimEnd().endsWith('Written as markdown.'),
          (await page.locator('.sky-note-editor').innerText()).includes('Written as markdown.'),
          errors,
        ],
        expected: [['Table', 'Checklist'], true, true, true, true, []],
      })
    })
  },
)
