// Run with SKY_BROWSER_TESTS=1 bun test service/handler/http-recurring-e2e_test.ts.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import DayDocument from '#shared/models/Day/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { createDayRoutes } from './day/mod.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'

test(
  {
    name: 'recurring management uses its settings sidebar, edits real sources, and works on a phone',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 120000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-recurring-browser-'))
    const timeDir = path.join(root, 'time')
    await mkdir(timeDir)
    const today = new PlainDate('2031-03-17')
    const now = () => new ZonedDateTime(new PlainDateTime('2031-03-17T08:00:00'), 'UTC')
    const dayPath = path.join(timeDir, dayFile(today))
    const dailyCopy = DayDocument.createFutureDay(today)
      .addTodoItem('Existing daily plan')
      .addReminderItem('Existing daily reminder')
      .toMarkdown()
    await mkdir(path.dirname(dayPath), { recursive: true })
    await writeFile(dayPath, dailyCopy)
    const notebook = createTestHttpApp([timeDir], {
      now,
      chat: {
        timeDir,
        aboutMePath: path.join(root, 'about.md'),
        createSession: async () => {
          throw new Error('A recurring fixture never creates a chat.')
        },
      },
    })
    const app = new Hono()
      .route(
        '/day',
        createDayRoutes({
          markdownBaseDir: root,
          timeDir,
          today: () => today,
          planningToday: () => today,
          now,
          ownerNames: [],
        }),
      )
      .route('/', notebook)
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    let browser
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing recurring test server address.')
      const origin = 'http://127.0.0.1:' + address.port
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } })
      page.setDefaultTimeout(10000)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const screenshotDir = env.get('SKY_RECURRING_SCREENSHOTS')
      const shot = async (name: string) => {
        if (!screenshotDir) return
        await mkdir(screenshotDir, { recursive: true })
        await page.screenshot({ path: path.join(screenshotDir, name + '.png'), fullPage: true })
      }
      await page.goto(origin + '/recurring')
      await page.getByRole('heading', { name: 'A little less to remember', exact: true }).waitFor()
      const side = page.locator('.sky-side')
      assert({
        given: 'an empty notebook opened directly in Recurring',
        should: 'use the management navigation and a specific title',
        actual: [
          await page.title(),
          await side.getByRole('link', { name: 'People & Orgs', exact: true }).count(),
          await side.getByRole('link', { name: 'Places', exact: true }).count(),
          await side.getByRole('link', { name: 'Recurring', exact: true }).getAttribute('aria-current'),
          await side.locator('.sky-side-dates').count(),
        ],
        expected: ['sky · Recurring', 1, 1, 'page', 0],
      })
      await page.getByRole('button', { name: 'Add your first recurring item', exact: true }).click()
      await page.getByRole('textbox', { name: /^What\?/ }).fill('Review Atlas priorities')
      await page.getByRole('button', { name: 'Add notes', exact: true }).click()
      await page
        .getByLabel('Notes', { exact: true })
        .fill('Keep [the plan](../projects/Atlas/plan.md).\n- A nested step')
      await page.getByLabel('Next matching dates').getByText('2031-03-17', { exact: true }).waitFor()
      await shot('desktop-editor')
      await page.getByRole('button', { name: 'Add recurring item', exact: true }).click()
      await page.getByRole('button', { name: 'Edit recurrence: Review Atlas priorities', exact: true }).waitFor()
      const professional = await readFile(path.join(timeDir, 'recurring-professional.md'), 'utf8')
      assert({
        given: 'a recurring to-do created through the dialog',
        should: 'write the existing weekday pattern and preserve nested Markdown notes',
        actual: [professional.includes('## EVERY-WEEKDAY'), professional.includes('  - A nested step')],
        expected: [true, true],
      })
      await page.getByRole('button', { name: 'Edit recurrence: Review Atlas priorities', exact: true }).click()
      await page.getByRole('button', { name: 'Add a time', exact: true }).click()
      await page.getByRole('textbox', { name: /^Time/ }).fill('25:30')
      await page.getByRole('combobox', { name: 'Category', exact: true }).click()
      await page.getByRole('option', { name: 'Personal', exact: true }).click()
      await page.getByRole('combobox', { name: 'Repeat', exact: true }).click()
      await page.getByRole('option', { name: 'Weekly', exact: true }).click()
      await page.getByRole('combobox', { name: 'On', exact: true }).click()
      await page.getByRole('option', { name: 'Wednesday', exact: true }).click()
      await page.getByLabel('Next matching dates').getByText('2031-03-19', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Save changes', exact: true }).click()
      await page.getByText('Every Wednesday · 25:30 · To-do', { exact: true }).waitFor()
      await shot('desktop-list')
      assert({
        given: 'a recurrence changed to a personal commitment',
        should: 'move its full definition and leave the prepared day byte-for-byte unchanged',
        actual: [
          (await readFile(path.join(timeDir, 'recurring-professional.md'), 'utf8')).includes('Review Atlas priorities'),
          (await readFile(path.join(timeDir, 'recurring-personal.md'), 'utf8')).includes(
            '- 25:30 > Review Atlas priorities',
          ),
          await readFile(dayPath, 'utf8'),
        ],
        expected: [false, true, dailyCopy],
      })
      await page.goto(origin + '/' + today.ymd)
      await page.getByRole('link', { name: 'Manage recurring', exact: true }).last().waitFor()
      assert({
        given: 'the day page',
        should: 'offer contextual links and no Recurring peer in the Today navigation',
        actual: [
          await page.getByRole('link', { name: 'Manage recurring', exact: true }).count(),
          await side.getByRole('link', { name: 'Recurring', exact: true }).count(),
          await page.getByText('Existing daily plan', { exact: true }).count(),
        ],
        expected: [2, 0, 1],
      })
      await page.getByRole('link', { name: 'Manage recurring', exact: true }).last().click()
      await page.getByRole('button', { name: 'Add your first reminder', exact: true }).waitFor()
      assert({
        given: 'the Reminders contextual link',
        should: 'open the filtered manager with a useful browser title',
        actual: [new URL(page.url()).search, await page.title()],
        expected: ['?category=reminders', 'sky · Recurring · Reminders'],
      })
      await page.goBack()
      await page.getByRole('link', { name: 'Manage recurring', exact: true }).last().waitFor()
      await page.goForward()
      await page.getByRole('button', { name: 'Add your first reminder', exact: true }).waitFor()
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('button', { name: 'Add your first reminder', exact: true }).click()
      await page.getByRole('textbox', { name: /^What\?/ }).fill('Water the plants')
      await page.getByLabel('Next matching dates').getByText('2031-03-17', { exact: true }).waitFor()
      await shot('phone-editor')
      await page.getByRole('button', { name: 'Add recurring item', exact: true }).click()
      await page.getByRole('button', { name: 'Edit recurrence: Water the plants', exact: true }).waitFor()
      await shot('phone-list')
      await page.reload()
      await page.getByRole('button', { name: 'Options for Water the plants', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Stop repeating', exact: true }).click()
      const confirm = page.getByRole('dialog')
      await confirm.getByRole('heading', { name: 'Stop repeating?', exact: true }).waitFor()
      await confirm.getByRole('button', { name: 'Stop repeating', exact: true }).click()
      await page.getByRole('button', { name: 'Add your first reminder', exact: true }).waitFor()
      assert({
        given: 'a reminder stopped after a reload on a phone',
        should: 'persist its removal without changing the day, overflowing the viewport, or causing browser errors',
        actual: [
          (await readFile(path.join(timeDir, 'reminders.md'), 'utf8')).includes('Water the plants'),
          await readFile(dayPath, 'utf8'),
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          errors,
        ],
        expected: [false, dailyCopy, true, []],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
