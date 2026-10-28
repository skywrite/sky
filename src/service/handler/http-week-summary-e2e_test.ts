import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { dayDir, weekDir } from '#shared/nbfs/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime, Week, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const WEEK = Week.parse('2031-W11')
const SUMMARY =
  '---\ntitle: Weekly Summary\n---\n\n# Weekly Summary\n\nAtlas moved forward with a reviewed checklist.\n'
const DAILY = '# Daily summary\n\nThe Atlas checklist was reviewed and the next steps were written down.\n'
const NOW = new ZonedDateTime(new PlainDateTime('08:00', '2031-03-17'), 'America/Chicago')
const summaryPath = path.join('time', weekDir(WEEK.startInYear), 'summary.md')

test(
  {
    name: 'weekly summary starts from the page, survives navigation and reload, and opens the saved file',
    timeout: 60000,
  },
  async (t) => {
    let finish!: () => void
    const wait = new Promise<void>((resolve) => {
      finish = resolve
    })
    const calls: unknown[] = []
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Example\n',
        tempPrefix: 'week-summary-browser-',
        day: true,
        now: NOW,
        files: { [path.join('time', dayDir(WEEK.days[0]), 'summary.md')]: DAILY },
        week: (base) => ({
          startDay: async () => {},
          summarizeWeek: async (week, input) => {
            calls.push([week.toString(), input])
            await wait
            await writeFile(path.join(base, summaryPath), SUMMARY)
          },
        }),
      },
      async ({ page, origin, file, errors }) => {
        const block = page.getByRole('region', { name: 'Weekly summary', exact: true })
        const generate = block.getByRole('button', { name: 'Generate weekly summary', exact: true })
        try {
          await page.goto(`${origin}/week/${WEEK}`)
          await generate.waitFor()
          await page.waitForFunction(() => document.title === 'sky · Week 2031-W11')
          const needsChoice = await generate.isDisabled()
          await block.locator('summary').click()
          await block.getByRole('button', { name: 'Review Tuesday', exact: true }).waitFor()
          await block.getByRole('checkbox', { name: 'Generate with the available daily summaries' }).check()
          await generate.click()
          await block.getByRole('status').filter({ hasText: 'Generating the weekly summary' }).waitFor()
          await page.reload()
          await block.getByRole('status').filter({ hasText: 'Generating the weekly summary' }).waitFor()

          await page.getByRole('button', { name: '‹ This week', exact: true }).click()
          await page.waitForFunction(() => document.title === 'sky · Week 2031-W12')
          await block.getByText('Generate this summary after the week ends.', { exact: false }).waitFor()
          const currentHasNoTrigger = (await generate.count()) === 0
          await page.goBack()
          await page.waitForFunction(() => document.title === 'sky · Week 2031-W11')
          await block.getByRole('status').filter({ hasText: 'Generating the weekly summary' }).waitFor()
          await page.goForward()
          await page.waitForFunction(() => document.title === 'sky · Week 2031-W12')
          await page.goBack()
          await page.waitForFunction(() => document.title === 'sky · Week 2031-W11')
          finish()

          const saved = block.getByRole('link', { name: 'Read weekly summary', exact: true })
          await saved.waitFor()
          const savedHref = await saved.getAttribute('href')
          await page.setViewportSize({ width: 390, height: 844 })
          await page.reload()
          await saved.waitFor()
          const fits = await block.evaluate((element) => {
            const bounds = element.getBoundingClientRect()
            return (
              bounds.left >= 0 &&
              bounds.right <= window.innerWidth &&
              [...element.querySelectorAll('p, a, button')].every((child) => {
                const box = child.getBoundingClientRect()
                return box.left >= bounds.left && box.right <= bounds.right && child.scrollWidth <= child.clientWidth
              })
            )
          })
          const shots = env.get('SKY_E2E_SCREENSHOTS')
          if (shots) {
            await mkdir(shots, { recursive: true })
            await page.screenshot({ path: path.join(shots, 'weekly-summary-mobile.png'), fullPage: true })
          }
          await saved.click()
          await page.waitForURL(`**/explorer/${summaryPath}`)
          await page.waitForFunction(() => document.title === 'sky · Weekly Summary')
          if (shots) {
            await page.setViewportSize({ width: 1440, height: 1000 })
            await page.goto(`${origin}/week/${WEEK}`)
            await saved.waitFor()
            await page.screenshot({ path: path.join(shots, 'weekly-summary-desktop.png'), fullPage: true })
          }
          const root = path.dirname(path.dirname(file))
          assert({
            given: 'partial daily coverage and a summary running through reload and browser history',
            should:
              'require the explicit choice, generate the selected week once, fit on mobile, and link the saved summary',
            actual: {
              needsChoice,
              currentHasNoTrigger,
              fits,
              savedHref,
              calls,
              saved: await readFile(path.join(root, summaryPath), 'utf8'),
              errors,
            },
            expected: {
              needsChoice: true,
              currentHasNoTrigger: true,
              fits: true,
              savedHref: `/explorer/${summaryPath}`,
              calls: [['2031-W11', { allowMissing: true }]],
              saved: SUMMARY,
              errors: [],
            },
          })
        } finally {
          finish()
        }
      },
    )
  },
)

test({ name: 'weekly summary failure stays visible and retries from the page', timeout: 45000 }, async (t) => {
  let calls = 0
  await runWysiwygE2e(
    t,
    {
      initialMarkdown: '# Example\n',
      tempPrefix: 'week-summary-retry-',
      day: true,
      now: NOW,
      files: Object.fromEntries(WEEK.days.map((day) => [path.join('time', dayDir(day), 'summary.md'), DAILY])),
      week: (base) => ({
        startDay: async () => {},
        summarizeWeek: async () => {
          if (++calls === 1) throw new Error('The summary provider is unavailable. Try again.')
          await writeFile(path.join(base, summaryPath), SUMMARY)
        },
      }),
    },
    async ({ page, origin, errors }) => {
      await page.goto(`${origin}/week/${WEEK}`)
      const block = page.getByRole('region', { name: 'Weekly summary', exact: true })
      await block.getByRole('button', { name: 'Generate weekly summary', exact: true }).click()
      await block.getByRole('alert').waitFor()
      const message = await block.getByRole('alert').textContent()
      await page.reload()
      await block.getByRole('button', { name: 'Retry weekly summary', exact: true }).click()
      await block.getByRole('link', { name: 'Read weekly summary', exact: true }).waitFor()
      assert({
        given: 'a transient model failure and a reload before retrying',
        should: 'identify the affected week and keep a working retry action',
        actual: [message, calls, errors],
        expected: ['Could not summarize week 2031-W11: The summary provider is unavailable. Try again.', 2, []],
      })
    },
  )
})
