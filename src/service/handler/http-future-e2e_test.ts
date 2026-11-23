// Run with SKY_BROWSER_TESTS=1 bun test service/handler/http-future-e2e_test.ts.
import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { type Browser, chromium, type Page } from 'playwright'
import { TRACKING_TODAY } from '#lib/tracking/testHelpers.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { futureFixture } from './future/testHelpers.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'

type Fixture = Awaited<ReturnType<typeof futureFixture>>

/** Serve a test notebook's app and open a browser on it. */
async function open(f: Fixture) {
  const unavailable = async () => {
    throw new Error('This fixture never starts a chat.')
  }
  const app = createTestHttpApp(
    [path.join(f.root, 'time'), path.join(f.root, 'goals'), path.join(f.root, 'decisions')],
    {
      now: () => new ZonedDateTime(new PlainDateTime('08:15', TRACKING_TODAY), 'America/Chicago'),
      future: { store: f.store },
      tracking: { store: f.tracking.store },
      chat: { timeDir: path.join(f.root, 'time'), createSession: unavailable },
    },
  )
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing browser test server address.')
  let browser: Browser | undefined
  const close = async () => {
    await browser?.close()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    await f.dispose()
  }
  try {
    browser = await chromium.launch({ headless: true, executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined })
    const page: Page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    page.setDefaultTimeout(10000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const shots = env.get('SKY_FUTURE_SCREENSHOTS')
    if (shots) await mkdir(shots, { recursive: true })
    const shot = async (name: string) => {
      if (shots)
        await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true, animations: 'disabled' })
    }
    const waitForTitle = (title: string) => page.waitForFunction((expected) => document.title === expected, title)
    return { page, origin: `http://127.0.0.1:${address.port}`, errors, shot, waitForTitle, close }
  } catch (error) {
    await close()
    throw error
  }
}

test(
  {
    name: 'Future shows each goal, opens a goal, and edits its number, checkpoints and a new goal from the real UI',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 150000,
  },
  async () => {
    const f = await futureFixture()
    const { page, origin, errors, shot, waitForTitle, close } = await open(f)
    try {
      await page.goto(`${origin}/future`)
      const marathon = page.getByRole('region', { name: 'Run a marathon' })
      await marathon.waitFor()
      await shot('01-goals')
      assert({
        given: 'the Future area opened from its address',
        should: 'name the area in the tab, and sit second in the sidebar, right under Today',
        actual: [
          await page.title(),
          (await page.locator('.sky-side-primary').allInnerTexts()).slice(0, 3),
          await page.locator('.sky-side-primary[aria-current="page"]').innerText(),
        ],
        expected: ['sky · Future', ['Today', 'Future', 'Chat'], 'Future'],
      })
      assert({
        given: 'a goal with a number, a decision in force across two goals, and a goal whose tracker is gone',
        should: 'say where the first stands, list the decision once, and offer the other a way to fix its number',
        actual: [
          (await marathon.locator('.sky-future-stand').first().innerText()).replace(/\s+/g, ' '),
          await marathon.locator('.sky-future-track-cap').innerText(),
          (await marathon.locator('.sky-future-ties dt').allInnerTexts()).join(', '),
          (await page.locator('.sky-future-panel li').innerText()).replace(/\s+/g, ' '),
          (
            await page.getByRole('region', { name: 'Learn Spanish' }).locator('.sky-future-stand').first().innerText()
          ).replace(/\s+/g, ' '),
        ],
        expected: [
          '14 mi on Jun 17 12.2 mi to go 108 days left',
          '40% of the way there. 31% of the time is gone (the dark mark).',
          'Smaller goals, To decide, Habits, Ideas, Decided',
          'No late nights before a long run In force since Mar 2. Serves Learn Spanish and Run a marathon.',
          'This goal follows "vocabulary", which is not in Tracking any more. Choose another number',
        ],
      })

      await marathon.getByRole('link', { name: 'Run a marathon' }).click()
      await waitForTitle('sky · Run a marathon')
      await page.locator('.sky-future-chart svg').waitFor()
      await shot('02-goal')
      assert({
        given: 'the goal opened from the Goals view',
        should: 'show its number, its chart, its checkpoints and everything tied to it',
        actual: [
          new URL(page.url()).pathname,
          (await page.locator('.sky-future-stats strong').allInnerTexts()).join(' | '),
          await page.locator('.sky-future-chart svg').getAttribute('aria-label'),
          (await page.locator('.sky-future-section h2').allInnerTexts()).map((text) => text.replace(/\s*\d+$/, '')),
          (await page.locator('.sky-future-state').allInnerTexts()).join(', '),
        ],
        expected: [
          '/future/goals/Run-a-Marathon',
          '14 mi | +8 mi | 12.2 mi',
          'Long run since May 1, 14 mi on Jun 17, toward 26.2 mi',
          [
            'Checkpoints',
            'Smaller goals',
            'In force',
            'To decide',
            'Habits that move it',
            'Ideas',
            'Decided',
            'In your words',
          ],
          'Reached, Missed, Still ahead',
        ],
      })

      await page.getByLabel('Number', { exact: true }).fill('18')
      await page.getByLabel('By', { exact: true }).fill('2030-07-15')
      await page.getByRole('button', { name: 'Add checkpoint' }).click()
      await page.locator('.sky-future-row', { hasText: '18 mi by Jul 15' }).waitFor()
      await page.getByRole('button', { name: 'Remove the checkpoint on Jun 10' }).click()
      await page.locator('.sky-future-row', { hasText: '20 mi by Jun 10' }).waitFor({ state: 'detached' })
      assert({
        given: 'a checkpoint added and another removed on the goal page',
        should: 'change those lines of the goal file and nothing else in the list',
        actual: (await f.goalFile('Run-a-Marathon')).match(/checkpoints:\n(?: {2}- .*\n)+/)?.[0],
        expected: 'checkpoints:\n  - 10 by 2030-06-01\n  - 18 by 2030-07-15\n  - 22 by 2030-09-01\n',
      })

      await page.getByRole('button', { name: 'Change the number' }).click()
      const dialog = page.getByRole('dialog', { name: 'Change the number' })
      await dialog.getByLabel('What should it reach?').fill('30')
      await dialog.getByRole('button', { name: 'Save' }).click()
      await dialog.waitFor({ state: 'detached' })
      await page.locator('.sky-future-stats em', { hasText: '30 mi by Oct 4' }).waitFor()
      assert({
        given: 'a new target saved from the dialog',
        should: 'write it to the goal file and show the new distance to go',
        actual: [
          /\ntarget: 30\n/.test(await f.goalFile('Run-a-Marathon')),
          (await page.locator('.sky-future-stats strong').allInnerTexts()).at(-1),
        ],
        expected: [true, '16 mi'],
      })

      await page.getByRole('link', { name: 'Future', exact: true }).click()
      await waitForTitle('sky · Future')
      await page.goBack()
      await waitForTitle('sky · Run a marathon')
      await page.goForward()
      await waitForTitle('sky · Future')

      await page.getByRole('button', { name: 'Add a goal' }).click()
      const add = page.getByRole('dialog', { name: 'Add a goal' })
      await add.getByLabel('What do you want?').fill('Read 20 books')
      await add.getByLabel('By when?').fill('2030-12-31')
      await add.getByText('Professional', { exact: true }).click()
      await add.getByLabel('Why does it matter?').fill('Read more than I scroll.')
      await shot('03-add-goal')
      await add.getByRole('button', { name: 'Add goal' }).click()
      await waitForTitle('sky · Read 20 books')
      await page.getByRole('heading', { name: 'No number connected' }).waitFor()
      await shot('04-new-goal')
      assert({
        given: 'a goal added from the dialog',
        should: 'open its page, with its date and no number yet, and write its file',
        actual: [
          new URL(page.url()).pathname,
          (await page.locator('.sky-future-sub').innerText()).replace(/\s+/g, ' '),
          await f.goalFile('Read-20-books'),
        ],
        expected: [
          '/future/goals/Read-20-books',
          'Professional By Dec 31 196 days left',
          '---\ntitle: Read 20 books\ncategory: Professional\ndue: 2030-12-31\ncreated: 2030-06-18\nupdated: 2030-06-18\n---\n\n# Read 20 books\n\nRead more than I scroll.\n',
        ],
      })

      await page.getByRole('button', { name: 'Connect a number' }).click()
      const connect = page.getByRole('dialog', { name: 'Connect a number' })
      await connect.getByLabel('Which number?').selectOption({ label: 'Long run' })
      await connect.getByLabel('What should it reach?').fill('20')
      await connect.getByRole('button', { name: 'Connect' }).click()
      await connect.waitFor({ state: 'detached' })
      // The goal was written today and nothing is recorded today yet: the number is connected, with nothing to draw.
      await page.getByText('Nothing recorded since Jun 18').waitFor()

      await page.goto(`${origin}/future/goals/No-Such-Goal`)
      await page.getByRole('heading', { name: 'This goal isn’t here' }).waitFor()
      assert({
        given: 'the address of a goal that does not exist',
        should: 'say so, keep the area in the tab, and offer the way back',
        actual: [await page.title(), await page.getByRole('button', { name: 'See your goals' }).isVisible()],
        expected: ['sky · Future', true],
      })

      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`${origin}/future/goals/Run-a-Marathon`)
      await page.locator('.sky-future-chart svg').waitFor()
      await shot('05-goal-phone')
      await page.goto(`${origin}/future`)
      await marathon.waitFor()
      await shot('06-goals-phone')
      assert({
        given: 'the goal page and the Goals view at phone width',
        should: 'fit the screen without scrolling sideways, and report no page errors',
        actual: [await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), errors],
        expected: [true, []],
      })
    } finally {
      await close()
    }
  },
)

test(
  {
    name: 'Future on a notebook with no goals offers the first one',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const f = await futureFixture({ goals: false })
    const { page, origin, errors, shot, close } = await open(f)
    try {
      await page.goto(`${origin}/future`)
      await page.getByRole('heading', { name: 'Start with one goal' }).waitFor()
      await shot('07-no-goals')
      await page.getByRole('button', { name: 'Add a goal' }).click()
      const add = page.getByRole('dialog', { name: 'Add a goal' })
      await add.getByLabel('What do you want?').fill('Learn to sail')
      await add.getByRole('button', { name: 'Add goal' }).click()
      await page.getByRole('heading', { name: 'Learn to sail', level: 1 }).waitFor()
      assert({
        given: 'a notebook with no goals, and a first goal added from the empty page',
        should: 'open the new goal, named in the tab, with no page errors',
        actual: [await page.title(), new URL(page.url()).pathname, errors],
        expected: ['sky · Learn to sail', '/future/goals/Learn-to-sail', []],
      })
    } finally {
      await close()
    }
  },
)

test(
  {
    name: 'Future asks when a goal is reached or its date has passed, closes it, lists it among past goals, and reopens it',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 120000,
  },
  async () => {
    const f = await futureFixture()
    // One goal already past its target, and one whose date has gone by.
    await f.post('/goals/Run-a-Marathon/number', {
      track: 'long-run',
      target: 12,
      due: '2030-10-04',
      start: '2030-05-01',
    })
    await f.post('/goals/Weekly-Long-Runs/date', { due: '2030-06-01' })
    const { page, origin, errors, shot, waitForTitle, close } = await open(f)
    try {
      await page.goto(`${origin}/future`)
      const marathon = page.getByRole('region', { name: 'Run a marathon' })
      const weekly = page.getByRole('region', { name: 'A long run every week' })
      const past = page.getByRole('region', { name: 'Past goals' })
      await past.waitFor()
      assert({
        given: 'a goal past its target, a goal past its date, and a goal reached last year',
        should: 'ask about the first two where they are listed, and show the third among past goals',
        actual: [
          await marathon.getByRole('link', { name: 'You’re there. Close this goal' }).isVisible(),
          await weekly.getByRole('link', { name: 'Its date has passed. Close it or move the date' }).isVisible(),
          (await past.locator('.sky-future-row').allInnerTexts()).map((text) => text.replace(/\s+/g, ' ')),
        ],
        expected: [true, true, ['Run a 5k Ended at 3.1 mi Reached Sep 1, 2029']],
      })

      await weekly.getByRole('link', { name: 'Its date has passed. Close it or move the date' }).click()
      await waitForTitle('sky · A long run every week')
      await page.getByRole('heading', { name: 'The date has passed' }).waitFor()
      await page.getByRole('button', { name: 'Move the date' }).click()
      const move = page.getByRole('dialog', { name: 'Move the date' })
      await move.getByLabel('By when?').fill('2030-12-01')
      await move.getByRole('button', { name: 'Save' }).click()
      await move.waitFor({ state: 'detached' })
      await page.getByRole('heading', { name: 'The date has passed' }).waitFor({ state: 'detached' })
      assert({
        given: 'the date moved from the question on the goal page',
        should: 'write the new date and stop asking',
        actual: [
          /\ndue: 2030-12-01\n/.test(await f.goalFile('Weekly-Long-Runs')),
          (await page.locator('.sky-future-sub').innerText()).replace(/\s+/g, ' '),
        ],
        expected: [true, 'Personal By Dec 1 166 days left Serves Run a marathon'],
      })

      await page.goto(`${origin}/future/goals/Run-a-Marathon`)
      await page.getByRole('heading', { name: 'You’re there' }).waitFor()
      await page.getByRole('button', { name: 'Close as reached' }).click()
      const dialog = page.getByRole('dialog', { name: 'Close this goal' })
      await dialog.getByLabel('Anything to remember?').fill('Long runs every week did it.')
      await shot('08-close-goal')
      assert({
        given: 'the close dialog opened from "You’re there"',
        should: 'already say the goal was reached, today',
        actual: [
          await dialog.getByRole('radio', { name: /Reached/ }).isChecked(),
          await dialog.getByLabel('When did it end?').inputValue(),
        ],
        expected: [true, '2030-06-18'],
      })
      await dialog.getByRole('button', { name: 'Close goal' }).click()
      await dialog.waitFor({ state: 'detached' })
      await page.getByRole('button', { name: 'Reopen' }).waitFor()
      await shot('09-closed-goal')
      const filed = await f.goalFile('Run-a-Marathon', 'reached/2030')
      assert({
        given: 'the goal closed as reached',
        should: 'keep its page open as a past goal, and file it with the day, the last reading and the line',
        actual: [
          await page.title(),
          (await page.locator('.sky-future-sub').innerText()).replace(/\s+/g, ' '),
          await page.getByRole('button', { name: 'Close this goal' }).count(),
          await page.getByRole('button', { name: 'Add checkpoint' }).count(),
          filed.match(/\nended: .*\nfinal: .*\n/)?.[0],
          filed.endsWith('\n\n## How it ended\n\nLong runs every week did it.\n'),
        ],
        expected: [
          'sky · Run a marathon',
          'Personal Reached on Jun 18 By Oct 4',
          0,
          0,
          '\nended: 2030-06-18\nfinal: 14 mi\n',
          true,
        ],
      })

      await page.getByRole('link', { name: 'Future', exact: true }).click()
      await waitForTitle('sky · Future')
      await past.locator('.sky-future-row').nth(1).waitFor()
      await shot('10-past-goals')
      assert({
        given: 'the Goals view after closing',
        should: 'take the goal off the active ones and list it first among past goals',
        actual: [
          await marathon.count(),
          (await past.locator('.sky-future-row').allInnerTexts()).map((text) => text.replace(/\s+/g, ' ')),
        ],
        expected: [0, ['Run a marathon Ended at 14 mi Reached Jun 18', 'Run a 5k Ended at 3.1 mi Reached Sep 1, 2029']],
      })

      await past.getByRole('link', { name: 'Run a marathon' }).click()
      await waitForTitle('sky · Run a marathon')
      await page.getByRole('button', { name: 'Reopen' }).click()
      await page.getByRole('button', { name: 'Close this goal' }).waitFor()
      const reopened = await f.goalFile('Run-a-Marathon')
      assert({
        given: 'the past goal reopened from its page',
        should: 'bring it back among the active goals without its ending, with no page errors',
        actual: [/\n(ended|final): /.test(reopened), reopened.includes('Long runs every week did it.'), errors],
        expected: [false, true, []],
      })
    } finally {
      await close()
    }
  },
)

test(
  {
    name: 'Future lists decisions, drafts one with Sky from plain words, and saves it',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 120000,
  },
  async () => {
    const f = await futureFixture()
    const { page, origin, errors, shot, waitForTitle, close } = await open(f)
    try {
      await page.goto(`${origin}/future`)
      await page.getByRole('link', { name: /^Decisions/ }).click()
      await waitForTitle('sky · Decisions')
      const rows = (name: string) => page.getByRole('region', { name }).locator('.sky-future-row')
      await rows('To decide').first().waitFor()
      await shot('11-decisions')
      const tab = (await page.getByRole('link', { name: /^Decisions/ }).innerText()).replace(/\s+/g, ' ')
      const hidden = await page.getByRole('region', { name: 'Decided' }).count()
      await page.getByRole('button', { name: 'Show 1 decided' }).click()
      await rows('Decided').first().waitFor()
      assert({
        given: 'the Decisions tab with an open decision, one in force and one made',
        should:
          'list the open one and the one in force with their goals and dates, count only those on the tab, and keep the made one out of the way until asked for',
        actual: [
          new URL(page.url()).pathname,
          (await rows('To decide').allInnerTexts()).map((text) => text.replace(/\s+/g, ' ')),
          (await rows('In force').allInnerTexts()).map((text) => text.replace(/\s+/g, ' ')),
          tab,
          hidden,
          (await rows('Decided').allInnerTexts()).map((text) => text.replace(/\s+/g, ' ')),
          await page.getByRole('button', { name: 'Hide decided' }).isVisible(),
        ],
        expected: [
          '/future/decisions',
          ['Which race to enter Weighs on Run a marathon Open since Mar 2'],
          ['No late nights before a long run Weighs on Learn Spanish and Run a marathon Since Mar 2'],
          'Decisions2',
          0,
          ['Hire a coach Weighs on Run a marathon Decided Apr 1'],
          true,
        ],
      })

      await page.getByRole('button', { name: 'Add a decision' }).click()
      await waitForTitle('sky · New decision')
      await page.getByLabel('What’s the decision?').fill('which fall race should I run')
      await page.getByRole('button', { name: 'Draft it with Sky' }).click()
      await page.getByLabel('The decision', { exact: true }).waitFor()
      await shot('12-decision-draft')
      assert({
        given: 'a decision said in plain words and drafted',
        should: 'fill the form from the draft, tick the goal it found, and show what Sky was unsure of with its answer',
        actual: [
          await page.getByLabel('The decision', { exact: true }).inputValue(),
          await page.getByLabel('What’s going on?').inputValue(),
          await page.getByLabel('Decide by').inputValue(),
          await page.getByLabel('Run a marathon').isChecked(),
          await page.getByLabel('Learn Spanish').isChecked(),
          await page.getByLabel('Is a half marathon an option?').inputValue(),
          await page.locator('.sky-future-linked').allInnerTexts(),
        ],
        expected: [
          'Which race to enter in the fall',
          'Drafted from: which fall race should I run',
          '2030-07-01',
          true,
          false,
          'No, the full distance only.',
          ['streaks/run-before-work\n×'],
        ],
      })

      await page.getByLabel('Is a half marathon an option?').fill('No. The full distance.')
      await page.getByRole('button', { name: 'Redraft with these answers' }).click()
      await page.getByRole('heading', { name: /Sky wasn’t sure/ }).waitFor({ state: 'detached' })
      await page.getByRole('button', { name: 'Remove streaks/run-before-work' }).click()
      await page.getByText('Already decided', { exact: true }).click()
      await page.getByLabel('What did you decide?').fill('The city marathon in October.')
      await page.getByLabel('It’s still in force').check()
      await page.getByLabel('When did you decide?').fill('2030-06-10')
      await page.getByText('Personal', { exact: true }).click()
      await page.getByRole('button', { name: 'Add decision' }).click()
      await waitForTitle('sky · Decisions')
      await rows('In force').nth(1).waitFor()
      assert({
        given: 'the redrafted decision marked as made on an earlier day and still in force, then saved',
        should: 'run the command with what the form held, and list the decision as in force since that day',
        actual: [
          f.drafted.at(-1)?.conversation,
          f.created,
          (await rows('In force').allInnerTexts()).map((text) => text.replace(/\s+/g, ' ')),
        ],
        expected: [
          'Q: Is a half marathon an option?\nA: No. The full distance.',
          [
            {
              title: 'Which race to enter in the fall',
              context: 'Drafted from: which fall race should I run',
              desiredOutcomes: 'A full marathon that fits the plan.',
              decision: 'The city marathon in October.',
              inForce: true,
              when: '2030-06-10',
              target: undefined,
              rel: ['goals/Run-a-Marathon'],
              category: 'Personal',
            },
          ],
          [
            'Which race to enter in the fall Weighs on Run a marathon Since Jun 10',
            'No late nights before a long run Weighs on Learn Spanish and Run a marathon Since Mar 2',
          ],
        ],
      })

      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`${origin}/future/decisions/new`)
      await page.getByLabel('What’s the decision?').fill('Whether to hire a coach again')
      await page.getByRole('button', { name: 'Write it myself' }).click()
      const add = page.getByRole('button', { name: 'Add decision' })
      await add.waitFor()
      const blocked = await add.isDisabled()
      await page.getByLabel('What’s going on?').fill('The plan ends in July.')
      await page.getByLabel('What do you want out of it?').fill('Stay injury free.')
      await shot('13-decision-phone')
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      await add.click()
      await waitForTitle('sky · Decisions')
      await rows('To decide').nth(1).waitFor()
      assert({
        given: 'a decision written by hand on a phone, with no draft',
        should:
          'start from the words as the title, wait for the two required fields, fit the screen, and save it as open',
        actual: [
          blocked,
          fits,
          f.created.at(-1)?.title,
          f.created.at(-1)?.decision,
          (await rows('To decide').allInnerTexts()).some((text) => text.includes('Whether to hire a coach again')),
          errors,
        ],
        expected: [true, true, 'Whether to hire a coach again', undefined, true, []],
      })
    } finally {
      await close()
    }
  },
)
