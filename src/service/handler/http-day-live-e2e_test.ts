import { readFile, rm, writeFile } from 'node:fs/promises'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2030-04-08')
const NEXT = DAY.addDays(1)
const FILE = `time/${dayFile(DAY)}`
const CONTENT = `---
started: 08:00
tz: UTC
---

## Professional Todos

- Review the Atlas outline
- Draft the release note
- Send the checklist
`
const fixture = {
  initialMarkdown: CONTENT,
  tempPrefix: 'sky-day-live-',
  file: FILE,
  day: true,
  now: new ZonedDateTime(`${DAY.ymd}T10:00:00`, 'UTC'),
  files: { [`time/${dayFile(NEXT)}`]: '## Professional Todos\n\n- Plan the next workshop\n' },
}

test(
  { name: 'two day tabs follow saves and coalesced file changes while preserving drafts', timeout: 60000 },
  async (t) => {
    await runWysiwygE2e(t, fixture, async ({ page, origin, file, errors }) => {
      const second = await page.context().newPage()
      const other = await page.context().newPage()
      const requests: string[] = []
      second.on('request', (request) => {
        if (request.method() === 'GET' && request.url() === `${origin}/day/${DAY.ymd}`) requests.push(request.url())
      })
      let otherReads = 0
      other.on('request', (request) => {
        if (request.method() === 'GET' && request.url() === `${origin}/day/${NEXT.ymd}`) otherReads++
      })
      for (const tab of [page, second, other]) tab.on('pageerror', (error) => errors.push(error.message))
      await Promise.all([
        page.goto(`${origin}/${DAY.ymd}?view=record`),
        second.goto(`${origin}/${DAY.ymd}?view=record`),
        other.goto(`${origin}/${NEXT.ymd}?view=record`),
      ])
      const row = (text: string) => second.locator('.sky-prow').filter({ hasText: text })
      await other.getByText('Plan the next workshop', { exact: true }).waitFor()
      await row('Draft the release note').locator('.sky-ptext').dblclick()
      const input = second.getByRole('textbox', { name: 'Item text', exact: true })
      await input.fill('My unsaved release draft')
      await page
        .locator('.sky-prow')
        .filter({ hasText: 'Review the Atlas outline' })
        .getByRole('button', { name: 'Mark done', exact: true })
        .click()
      await row('Review the Atlas outline').getByRole('button', { name: 'Mark not done', exact: true }).waitFor()
      assert({
        given: 'one tab saves a checkbox while the other is editing a different item',
        should: 'propagate completion and retain the unsaved draft',
        actual: [await input.inputValue(), second.url()],
        expected: ['My unsaved release draft', `${origin}/${DAY.ymd}?view=record`],
      })

      await second.waitForTimeout(500)
      const otherSettled = other.waitForResponse((response) => response.url() === `${origin}/day/${NEXT.ymd}`)
      await other.evaluate(() => window.dispatchEvent(new Event('focus')))
      await otherSettled
      await other.waitForTimeout(250)
      const before = requests.length
      const otherBefore = otherReads
      const saved = await readFile(file, 'utf8')
      for (let i = 0; i < 8; i++) await writeFile(file, `${saved}\n- Capture idea ${i}\n`)
      await second.getByText('Capture idea 7', { exact: true }).waitFor()
      await second.waitForTimeout(500)
      assert({
        given: 'eight rapid disk saves, with a different date open in another tab',
        should: 'read the affected day once and leave the unrelated date and draft alone',
        actual: [requests.length - before, otherReads - otherBefore, await input.inputValue()],
        expected: [1, 0, 'My unsaved release draft'],
      })

      await writeFile(file, (await readFile(file, 'utf8')).replace('Draft the release note', 'Draft changed elsewhere'))
      const dialog = second.getByRole('dialog', { name: 'Item details' })
      await dialog.waitFor()
      await dialog
        .getByText('This item changed elsewhere. Your draft is kept here; reload the day before trying again.', {
          exact: true,
        })
        .waitFor()
      assert({
        given: 'the edited item changes on disk',
        should: 'keep the draft available beside the conflict explanation',
        actual: await input.inputValue(),
        expected: 'My unsaved release draft',
      })
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await row('Send the checklist').locator('.sky-ptext').dblclick()
      await input.fill('A draft kept through deletion')
      await rm(file)
      await dialog
        .getByText('This day file was removed. Your draft is kept here; restore the day file before saving.', {
          exact: true,
        })
        .waitFor()
      assert({
        given: 'the day file disappears during an edit',
        should: 'explain the missing file and preserve the draft',
        actual: await input.inputValue(),
        expected: 'A draft kept through deletion',
      })
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await row('Review the Atlas outline').waitFor({ state: 'detached' })
      await writeFile(file, CONTENT)
      await row('Review the Atlas outline').getByRole('button', { name: 'Mark done', exact: true }).waitFor()
      assert({
        given: 'deletion and recreation of the day file',
        should: 'refresh without reloading or browser errors',
        actual: errors,
        expected: [],
      })
    })
  },
)

test({ name: 'a delayed day refresh cannot undo a newer save in the browser', timeout: 45000 }, async (t) => {
  await runWysiwygE2e(t, { ...fixture, watch: 'poll' }, async ({ page, origin, file, errors }) => {
    await page.goto(`${origin}/${DAY.ymd}?view=record`)
    const row = page.locator('.sky-prow').filter({ hasText: 'Send the checklist' })
    await row.getByRole('button', { name: 'Mark done', exact: true }).waitFor()
    await page.waitForTimeout(500)
    const captured = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let hold = true
    await page.route(`${origin}/day/${DAY.ymd}`, async (route) => {
      if (!hold) return route.continue()
      hold = false
      const response = await route.fetch()
      captured.resolve()
      await release.promise
      await route.fulfill({ response })
    })
    try {
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await captured.promise
      const saved = page.waitForResponse(
        (response) => response.request().method() === 'POST' && response.url() === `${origin}/day/${DAY.ymd}/item`,
      )
      await row.getByRole('button', { name: 'Mark done', exact: true }).click()
      await saved
      await row.getByRole('button', { name: 'Mark not done', exact: true }).waitFor()
      await writeFile(file, `${await readFile(file, 'utf8')}\n- Added while the old read waited\n`)
      release.resolve()
      await page.getByText('Added while the old read waited', { exact: true }).waitFor()
      assert({
        given: 'a pre-save response arrives after the checkbox save',
        should: 'keep the saved completion and the current title',
        actual: [
          await row.getByRole('button', { name: 'Mark not done', exact: true }).count(),
          await page.title(),
          errors,
        ],
        expected: [1, 'sky · Monday, April 8, 2030 · Day record', []],
      })
    } finally {
      release.resolve()
    }
  })
})

test(
  { name: 'reconnection and tab activation recover missed changes and navigation retains one socket', timeout: 60000 },
  async (t) => {
    await runWysiwygE2e(t, { ...fixture, watch: false }, async ({ page, origin, file, reconnectNotebook, errors }) => {
      let connections = 0
      page.on('websocket', (socket) => {
        if (socket.url().endsWith('/notebook/changes')) connections++
      })
      await page.goto(`${origin}/${DAY.ymd}?view=record`)
      await page.getByText('Review the Atlas outline', { exact: true }).waitFor()
      await page.waitForTimeout(500)
      reconnectNotebook()
      await writeFile(file, CONTENT.replace('Send the checklist', 'Recovered after reconnection'))
      await page.getByText('Recovered after reconnection', { exact: true }).waitFor()
      await writeFile(file, CONTENT.replace('Send the checklist', 'Recovered on activation'))
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await page.getByText('Recovered on activation', { exact: true }).waitFor()
      const before = connections
      // Follow the ordinary date navigation, then browser history, without a full-page reload.
      await page.getByRole('button', { name: /^Tomorrow/ }).click()
      await page.getByText('Plan the next workshop', { exact: true }).waitFor()
      const nextTitle = await page.title()
      await page.goBack()
      await page.getByText('Recovered on activation', { exact: true }).waitFor()
      const previousTitle = await page.title()
      await page.goForward()
      await page.getByText('Plan the next workshop', { exact: true }).waitFor()
      assert({
        given: 'missed events, then forward and back date navigation',
        should: 'recover data, keep one connection and follow the selected day in the title',
        actual: [before, connections, nextTitle, previousTitle, await page.title(), errors],
        expected: [
          2,
          2,
          'sky · Tuesday, April 9, 2030 · Day record',
          'sky · Monday, April 8, 2030 · Day record',
          'sky · Tuesday, April 9, 2030 · Day record',
          [],
        ],
      })
    })
  },
)
