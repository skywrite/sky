// Run with SKY_BROWSER_TESTS=1 bun test service/handler/http-streaks-e2e_test.ts.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium, type Page } from 'playwright'
import StreakDocument from '#shared/models/Streak/document/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createDayRoutes } from './day/mod.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'
import { StreaksStore } from './streaks/store.ts'

const TODAY = new PlainDate('2026-05-20')

function dayMarkdown(date: string, items: string[], ended = false): string {
  return `---\ndate: ${date}\nstarted: 08:00\n${ended ? 'ended: 21:00\n' : ''}---\n\n# ${date}\n\n## Streaks\n\n${items.map((item) => `- ${item}`).join('\n')}\n\n## Notes\n\nKeep the original day narrative.\n`
}

async function streaksFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sky-streaks-browser-'))
  const dirs = {
    root,
    timeDir: path.join(root, 'time'),
    streaksDir: path.join(root, 'streaks'),
    stateDir: path.join(root, '.state', 'streaks'),
    dayStateDir: path.join(root, '.state', 'day'),
  }
  const put = async (relative: string, markdown: string) => {
    const file = path.join(root, relative)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, markdown)
    return file
  }
  const original = dayMarkdown(TODAY.ymd, ['Read a chapter — 2d', '~~Read a chapter slowly~~', 'Walk outside'])
  const todayFile = await put(path.join('time', dayFile(TODAY)), original)
  const endedFile = await put(
    path.join('time', dayFile(new PlainDate('2026-05-19'))),
    dayMarkdown('2026-05-19', ['~~Read a chapter~~', 'Walk outside'], true),
  )
  await put(
    path.join('time', dayFile(new PlainDate('2026-05-18'))),
    dayMarkdown('2026-05-18', ['~~Read a chapter~~', '~~Walk outside~~']),
  )
  for (const habit of [
    { name: 'read-a-chapter', title: 'Read a chapter', schedule: 'daily' as const },
    { name: 'read-a-chapter-slowly', title: 'Read a chapter slowly', schedule: 'daily' as const },
    { name: 'walk-outside', title: 'Walk outside', schedule: 'weekdays' as const },
  ]) {
    await put(
      `streaks/active/${habit.name}.md`,
      StreakDocument.create({
        ...habit,
        start: new PlainDate('2026-05-01'),
        why: 'Make a little room for **attention** every day.\n\nKeep the second paragraph in view.',
        details: '## What counts\n\nSpend ten focused minutes on the habit.\n',
        createdOn: '2026-05-01',
      }).toMarkdown(),
    )
  }
  return {
    dirs,
    store: new StreaksStore(dirs, async () => TODAY),
    todayFile,
    endedFile,
    original,
    dispose: () => rm(root, { recursive: true, force: true }),
  }
}

test(
  {
    name: 'streaks check-ins, period history, creation and archive use the notebook from the real UI',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 150000,
  },
  async () => {
    const f = await streaksFixture()
    const shots = env.get('SKY_STREAKS_SCREENSHOTS')
    let browser, currentPage: Page | undefined
    const notebookApp = createTestHttpApp([f.dirs.timeDir, f.dirs.streaksDir], {
      streaks: { store: f.store },
      chat: {
        timeDir: f.dirs.timeDir,
        createSession: async () => {
          throw new Error('A streaks browser fixture never starts a chat.')
        },
      },
    })
    const app = new Hono()
      .route(
        '/day',
        createDayRoutes({
          markdownBaseDir: f.dirs.root,
          timeDir: f.dirs.timeDir,
          today: () => TODAY,
          ownerNames: [],
          files: {
            userDataDir: path.join(f.dirs.root, '.user-data'),
            timeDir: f.dirs.timeDir,
            markdownBaseDir: f.dirs.root,
            spotlight: false,
          },
        }),
      )
      .route('/', notebookApp)
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    try {
      if (shots) await mkdir(shots, { recursive: true })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing streaks test server address.')
      const origin = `http://127.0.0.1:${address.port}`
      browser = await chromium.launch({
        headless: true,
        executablePath:
          env.get('SKY_BROWSER_EXECUTABLE') ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } })
      currentPage = page
      page.setDefaultTimeout(10000)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const shot = async (name: string) => {
        if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true })
      }

      await page.goto(`${origin}/${TODAY.ymd}`)
      await page.getByRole('link', { name: 'View all streaks' }).waitFor()
      const complete = page.getByRole('button', { name: 'Complete Read a chapter today', exact: true })
      assert({
        given: 'a completed habit whose title contains another habit’s full title',
        should: 'keep the shorter habit incomplete',
        actual: await complete.getAttribute('aria-pressed'),
        expected: 'false',
      })
      await complete.click()
      await page.getByRole('button', { name: 'Undo Read a chapter today', exact: true }).waitFor()
      assert({
        given: 'a completion from the dated day page',
        should: 'strike exactly its own decorated list item and preserve the rest of the day',
        actual: await readFile(f.todayFile, 'utf8'),
        expected: f.original.replace('- Read a chapter — 2d', '- ~~Read a chapter — 2d~~'),
      })
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await complete.waitFor()
      assert({
        given: 'Undo after completing a streak',
        should: 'restore the exact original day file',
        actual: await readFile(f.todayFile, 'utf8'),
        expected: f.original,
      })
      await shot('today-desktop')

      await page.getByRole('link', { name: 'View all streaks' }).click()
      await page.waitForURL('**/streaks')
      await page.locator('a.sky-streaks-habit-title[href*="/read-a-chapter?"]').click()
      await page.waitForURL('**/streaks/read-a-chapter*')
      await page.getByRole('heading', { name: 'Read a chapter', exact: true }).waitFor()
      assert({
        given: 'the detailed month calendar',
        should: 'show check marks for recorded completions',
        actual: await page.locator('.sky-streaks-calendar-day[data-state="done"] svg').count(),
        expected: 2,
      })
      await shot('detail-month-desktop')
      const why = page.locator('.sky-streaks-habit-context section').first()
      await why.locator('strong').filter({ hasText: 'attention' }).waitFor()
      await why.evaluate((section) => {
        const paragraphs = section.querySelectorAll('p')
        const first = paragraphs[0].firstChild!
        const last = paragraphs[1].firstChild!
        const range = document.createRange()
        range.setStart(first, 5)
        range.setEnd(last, 18)
        const selection = window.getSelection()!
        selection.removeAllRanges()
        selection.addRange(range)
      })
      const selectedText = await page.evaluate(() => window.getSelection()!.toString())
      const selectedParagraph = await why.locator('p').first().elementHandle()
      const refresh = async () => {
        const response = page.waitForResponse((result) => result.url().endsWith('/streaks/_api/report'))
        await page.evaluate(() => window.dispatchEvent(new Event('focus')))
        await response
        await page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
        )
      }
      await refresh()
      assert({
        given: 'a selection spanning two formatted paragraphs during a report refresh',
        should: 'preserve the selection and its original text nodes',
        actual: [
          await page.evaluate(() => window.getSelection()!.toString()),
          await selectedParagraph!.evaluate((paragraph) => paragraph.isConnected),
        ],
        expected: [selectedText, true],
      })
      const definitionFile = path.join(f.dirs.streaksDir, 'active', 'read-a-chapter.md')
      await writeFile(
        definitionFile,
        (await readFile(definitionFile, 'utf8')).replace('**attention**', '**updated attention**'),
      )
      await refresh()
      await why.locator('strong').filter({ hasText: 'updated attention' }).waitFor()
      await page.evaluate(() => window.getSelection()!.removeAllRanges())
      const endedBefore = await readFile(f.endedFile, 'utf8')
      await page.getByRole('button', { name: '2026-05-19, Completed', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      assert({
        given: 'a completion recorded in an ended day',
        should: 'offer the day record without an enabled correction action',
        actual: [
          await dialog
            .getByRole('button', { name: /^(Mark complete|Remove completion)$/ })
            .filter({ visible: true })
            .evaluateAll((buttons) => buttons.some((button) => !(button as HTMLButtonElement).disabled)),
          await dialog.getByRole('button', { name: 'Open day record', exact: true }).count(),
          await readFile(f.endedFile, 'utf8'),
        ],
        expected: [false, 1, endedBefore],
      })
      await dialog.getByRole('button', { name: 'Open day record', exact: true }).click()
      await page.waitForURL('**/explorer/time/**')
      await page.getByText('Keep the original day narrative.', { exact: true }).waitFor()
      await page.goBack()
      await page.getByRole('heading', { name: 'Read a chapter', exact: true }).waitFor()
      await page.getByRole('button', { name: '2026-05-21, Upcoming', exact: true }).click()
      await dialog.waitFor()
      assert({
        given: 'a future scheduled day',
        should: 'show its status without a completion action',
        actual: await dialog.getByRole('button', { name: /^(Mark complete|Remove completion)$/ }).count(),
        expected: 0,
      })
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })

      const history = '/streaks?tab=history&scope=quarter&month=2026-04&habit=read-a-chapter'
      await page.goto(`${origin}${history}`)
      await page.locator('.sky-streaks-mini-month').first().waitFor()
      assert({
        given: 'Quarter history narrowed to one streak',
        should: 'show all three months in that quarter',
        actual: await page.locator('.sky-streaks-mini-month').count(),
        expected: 3,
      })
      await shot('history-quarter-desktop')
      await page.getByRole('button', { name: 'Year', exact: true }).click()
      await page.waitForFunction(() => document.querySelectorAll('.sky-streaks-mini-month').length === 12)
      assert({
        given: 'Year history',
        should: 'show all twelve months while keeping the selected period control focused',
        actual: await page
          .getByRole('button', { name: 'Year', exact: true })
          .evaluate((el) => el === document.activeElement),
        expected: true,
      })
      assert({
        given: 'compact yearly day cells',
        should: 'use filled cells without a check mark or X glyph',
        actual: await page
          .locator('.sky-streaks-mini-day')
          .evaluateAll((cells) => cells.every((cell) => cell.textContent === '' && cell.childElementCount === 0)),
        expected: true,
      })
      await shot('history-year-desktop')
      await page.goto(`${origin}${history}`)
      await page.locator('.sky-streaks-mini-month[data-month="2026-05"]').waitFor()
      const originHistory = new URL(page.url()).search
      await page.locator('.sky-streaks-mini-month[data-month="2026-05"]').click()
      await page.waitForURL('**/streaks/read-a-chapter?*')
      await page.getByRole('link', { name: 'Streaks', exact: true }).click()
      await page.waitForURL((url) => url.pathname === '/streaks')
      assert({
        given: 'returning from a month drill-down through the Streaks breadcrumb',
        should: 'restore the original comparison period and habit filter',
        actual: new URL(page.url()).search,
        expected: originHistory,
      })
      await page.locator('.sky-streaks-mini-month[data-month="2026-05"]').click()
      await page.waitForURL('**/streaks/read-a-chapter?*')
      await page.goBack()
      assert({
        given: 'browser Back after a month drill-down',
        should: 'restore the same history view',
        actual: new URL(page.url()).search,
        expected: originHistory,
      })

      await page.goto(`${origin}/streaks`)
      await page.getByRole('button', { name: 'New streak', exact: true }).click()
      await dialog.getByRole('textbox', { name: 'What’s the habit?', exact: true }).fill('Read a chapter')
      await dialog
        .getByRole('textbox', { name: 'What counts as done?', exact: true })
        .fill('Play one short piece with focused attention.')
      await dialog.getByText('A streak already uses this name. Choose a different name.', { exact: true }).waitFor()
      assert({
        given: 'a new streak with an existing title',
        should: 'keep its history identity unique',
        actual: [
          (await f.store.report()).streaks.length,
          await dialog.getByRole('button', { name: 'Create streak', exact: true }).isDisabled(),
        ],
        expected: [3, true],
      })
      await dialog.getByRole('textbox', { name: 'What’s the habit?', exact: true }).fill('Practice piano')
      await dialog
        .getByRole('textbox', { name: 'Why does it matter to you?', exact: true })
        .fill('Make space for a creative practice.')
      await dialog.getByRole('textbox', { name: 'Start', exact: true }).fill(TODAY.ymd)
      await dialog.getByRole('textbox', { name: 'End (optional)', exact: true }).fill('2026-06-30')
      await shot('new-streak-desktop')
      await dialog.getByRole('button', { name: 'Create streak', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      await page.getByRole('heading', { name: 'Practice piano', exact: true }).waitFor()
      const createdPath = path.join(f.dirs.streaksDir, 'active', 'practice-piano.md')
      const created = await readFile(createdPath, 'utf8')
      assert({
        given: 'a streak created in the browser',
        should: 'save the definition, rule, purpose, and planned end as a streak document',
        actual: [
          created.includes('title: Practice piano'),
          created.includes('Play one short piece with focused attention.'),
          created.includes('Make space for a creative practice.'),
          created.includes('end: 2026-06-30'),
        ],
        expected: [true, true, true, true],
      })
      await page.getByRole('button', { name: 'Streak options', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Archive streak', exact: true }).click()
      await page.getByRole('button', { name: 'Undo', exact: true }).waitFor()
      assert({
        given: 'archiving before a planned end',
        should: 'move the file into the archive and stop tracking today',
        actual: (await readFile(path.join(f.dirs.streaksDir, 'archived', 'practice-piano.md'), 'utf8')).includes(
          `end: ${TODAY.ymd}`,
        ),
        expected: true,
      })
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await page.locator('a.sky-streaks-habit-title[href*="/practice-piano?"]').waitFor()
      assert({
        given: 'Undo immediately after archiving',
        should: 'restore the active document and its original planned end exactly',
        actual: await readFile(createdPath, 'utf8'),
        expected: created,
      })

      for (const width of [390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 })
        for (const route of [
          '/streaks',
          '/streaks/read-a-chapter?scope=month&month=2026-05',
          '/streaks/read-a-chapter?scope=quarter&month=2026-05',
          '/streaks/read-a-chapter?scope=year&month=2026-05',
          history,
        ]) {
          await page.goto(`${origin}${route}`)
          await page
            .getByRole('heading', {
              name: route.startsWith('/streaks/read-') ? 'Read a chapter' : 'Streaks',
              exact: true,
            })
            .waitFor()
          assert({
            given: `${route} at ${width}px`,
            should: 'keep the page within the viewport',
            actual: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            expected: false,
          })
          if (width === 390) {
            const view = new URL(page.url()).searchParams.get('scope') ?? 'overview'
            await shot(`${route.startsWith('/streaks/read-') ? 'detail' : 'history'}-${view}-mobile`)
          }
          if (width === 1440 && route === '/streaks') await shot('overview-desktop')
          if (width === 1440 && route === '/streaks/read-a-chapter?scope=year&month=2026-05') {
            await shot('detail-year-desktop')
            await page.evaluate(() => document.documentElement.setAttribute('data-mantine-color-scheme', 'dark'))
            await shot('detail-year-dark')
          }
        }
      }
      // Reset only this temporary notebook to exercise the first-use path.
      await rm(f.dirs.streaksDir, { recursive: true })
      await rm(f.dirs.timeDir, { recursive: true })
      await page.goto(`${origin}/streaks`)
      await page.getByRole('heading', { name: 'Start with one small habit', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Create your first streak', exact: true }).click()
      await dialog.getByRole('textbox', { name: 'What’s the habit?', exact: true }).fill('Read a chapter')
      await dialog
        .getByRole('textbox', { name: 'What counts as done?', exact: true })
        .fill('Read one chapter with attention.')
      await dialog.getByRole('button', { name: 'Create streak', exact: true }).click()
      await page.getByRole('heading', { name: 'Read a chapter', exact: true }).waitFor()
      assert({
        given: 'a first streak created before a day has been started',
        should: 'explain how to begin and prevent writing to a nonexistent day',
        actual: [
          await page.getByRole('button', { name: 'Mark done today', exact: true }).isDisabled(),
          await page.getByText('Start your day in Today to check in.', { exact: true }).count(),
          (await f.store.report()).days.length,
        ],
        expected: [true, 1, 0],
      })
      await shot('first-streak-no-day')
      assert({ given: 'the streaks workflows', should: 'raise no browser errors', actual: errors, expected: [] })
    } catch (error) {
      if (shots && currentPage)
        await currentPage.screenshot({ path: path.join(shots, 'failure.png'), fullPage: true }).catch(() => {})
      throw error
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await f.dispose()
    }
  },
)
