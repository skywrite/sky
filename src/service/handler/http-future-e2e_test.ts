// Run with SKY_BROWSER_TESTS=1 bun test service/handler/http-future-e2e_test.ts.
import { mkdir, readdir, readFile } from 'node:fs/promises'
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
      future: { store: f.store, wizard: f.wizard },
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

/** The wizard's controls, as a person finds them: a choice by its title, a chip by its words, a step by its question. */
function wizardControls(page: Page) {
  const step = (name: string) => page.getByRole('heading', { level: 2, name, exact: true })
  return {
    step,
    choice: (title: string) => page.locator('.sky-wizard-opt').filter({ hasText: title }).first(),
    chip: (name: string) => page.getByRole('radio', { name, exact: true }),
    ticked: () => page.locator('.sky-wizard-opt[aria-checked="true"] .sky-wizard-opt-title').allInnerTexts(),
    typed: () => page.locator('.sky-wizard-own textarea'),
    use: () => page.getByRole('button', { name: 'Use this', exact: true }).click(),
    go: () => page.getByRole('button', { name: 'Continue', exact: true }).click(),
    /** Continue, and wait for the next step's question. */
    on: async (name: string) => {
      await page.getByRole('button', { name: 'Continue', exact: true }).click()
      await step(name).waitFor()
    },
  }
}
const flat = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The decision file whose text holds `words`, as its path under decisions/ and its text. */
async function decisionFile(root: string, words: string): Promise<{ file: string; text: string } | undefined> {
  const dir = path.join(root, 'decisions')
  for (const file of (await readdir(dir, { recursive: true })).filter((name) => name.endsWith('.md')).sort()) {
    const text = await readFile(path.join(dir, file), 'utf8')
    if (text.includes(words)) return { file, text }
  }
  return undefined
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
    name: 'Future lists decisions and works one through the wizard: checks first, picks it up later, and saves the call',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 180000,
  },
  async () => {
    const f = await futureFixture()
    const { page, origin, errors, shot, waitForTitle, close } = await open(f)
    const { step, choice, chip, ticked, typed, use, go, on } = wizardControls(page)
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
          (await rows('To decide').allInnerTexts()).map(flat),
          (await rows('In force').allInnerTexts()).map(flat),
          tab,
          hidden,
          (await rows('Decided').allInnerTexts()).map(flat),
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
      await choice('No senior hires before the Series B closes').waitFor()
      await shot('12-wizard-start')
      const found = (await page.locator('.sky-wizard-opt').allInnerTexts()).map(flat)
      const blocked = await page.getByRole('button', { name: 'Continue', exact: true }).isDisabled()
      await choice('Hire a VP of Sales now, or after the October launch').click()
      const stands = await chip('I’m still deciding').getAttribute('aria-checked')
      await on('Which of these are you deciding?')
      // The decision keeps the person's words until they choose a wording.
      await waitForTitle('sky · Hire a VP of Sales now, or after the October launch')
      assert({
        given: 'Add a decision',
        should:
          'offer the decisions Sky found that are not written down yet, each marked open or made, wait for a pick, and open the wizard on what Sky thought through',
        actual: [
          found,
          blocked,
          stands,
          /^\/future\/decisions\/new\/[0-9a-f-]{36}$/.test(new URL(page.url()).pathname),
          f.thought,
        ],
        expected: [
          [
            'Hire a VP of Sales now, or after the October launch You went back and forth on this in your journal on Jun 12. Still deciding',
            'No senior hires before the Series B closes You told the leadership meeting on Mar 12. Looks decided',
            'Something else… Say it the way you would out loud.',
          ],
          true,
          'true',
          true,
          [{ statement: 'Hire a VP of Sales now, or after the October launch', decided: false }],
        ],
      })

      // Talking it through opens a Sky chat named for this run, beside the wizard.
      const [chat] = await Promise.all([
        page.context().waitForEvent('page'),
        page.getByRole('button', { name: 'Talk it through' }).click(),
      ])
      const run = new URL(page.url()).pathname.split('/').at(-1)
      const talk = new URL(chat.url())
      const lead = chat.getByText('About the decision “Hire a VP of Sales now, or after the October launch”:')
      await lead.waitFor()
      await chat.close()
      await page.bringToFront()
      assert({
        given: 'Talk it through, pressed on a step of the wizard',
        should:
          'open the chat about this decision in a new tab with the decision named in the composer, and leave the wizard where it was',
        actual: [
          talk.pathname,
          talk.searchParams.get('returnTo'),
          await step('Which of these are you deciding?').isVisible(),
        ],
        expected: [`/thread/decision-${run}`, `/future/decisions/new/${run}`, true],
      })

      // The keyboard alone: 2 picks the second wording, Enter continues.
      await page.keyboard.press('2')
      const framed = await ticked()
      await page.keyboard.press('Enter')
      await step('How much care does it deserve?').waitFor()
      await waitForTitle('sky · Who leads sales through the October launch')
      const suggestedCare = await ticked()
      const read = flat(await page.locator('.sky-wizard-read').innerText())
      await choice('Take the full path').click()
      await on('What do you want from it?')
      const suggested = await ticked()
      await choice('Keep Jane Doe, your top account executive').click()
      await on('When these pull apart, which one comes first?')
      await choice('Keep Jane Doe, your top account executive').click()
      const flagged = await page.locator('.sky-wizard-flag').innerText()
      await shot('13-wizard-comes-first')
      await on('Which options are worth weighing?')
      const offered = flat(await page.locator('.sky-wizard-lede').innerText())
      await choice('Add an option…').click()
      await typed().fill('Split the role with Jane')
      await use()
      const working = await page.getByRole('status').filter({ hasText: 'Sky is working out' }).innerText()
      await choice('Split the role with Jane').waitFor()
      await choice('Hire a VP of Sales now').click()
      await choice('Wait until after the launch').click()
      const weighing = await ticked()
      const mine = flat(await choice('Split the role with Jane').innerText())
      await shot('14-wizard-options')
      assert({
        given: 'the first steps of the full path',
        should:
          'take the keyboard, come with Sky’s suggested path picked and its answers said first, tick what Sky suggests, flag a want that is a decision in force, and work out an option that was typed in',
        actual: [
          framed,
          suggestedCare,
          read,
          suggested,
          flagged,
          offered,
          flat(working).startsWith('Sky is working out “Split the role with Jane”'),
          weighing,
          mine,
        ],
        expected: [
          ['Who leads sales through the October launch'],
          ['Take the full path'],
          'Why: Sky’s read Will it still matter in a year? Yes Whoever leads sales shapes the year’s bookings. How hard is it to undo? It depends on the option A senior hire takes months to reverse. A contract does not. To undo, option by option Hire a VP now Very hard Wait until November Easy Part-time lead Easy Promote Jane Costly',
          [
            'Keep your own time free for the October launch',
            'Reach $4M in new bookings this year',
            'Stay inside the hiring plan',
          ],
          'One of these is a decision in force. An option that breaks it means reopening that decision first.',
          'You named two. Sky added two. Keep at least two.',
          true,
          [
            'Bring in a part-time sales lead for six months',
            'Promote Jane Doe to lead sales',
            'Split the role with Jane',
          ],
          'Split the role with Jane A contractor runs the pipeline. You decide on a VP after the launch. You named this',
        ],
      })

      await on('What could happen if you choose “Bring in a part-time sales lead for six months”?')
      const heldBack = await page.getByRole('heading', { name: /^Sky’s read/ }).count()
      await chip('40–60%').click()
      const agree = await page.locator('.sky-wizard-gap').innerText()
      await on('What could happen if you choose “Promote Jane Doe to lead sales”?')
      await chip('Over 80%').click()
      const apart = await page.locator('.sky-wizard-gap').innerText()
      const waits = await page.getByRole('button', { name: 'Continue', exact: true }).isDisabled()
      await page.getByRole('button', { name: /^Tell Sky what it is missing/ }).click()
      await typed().fill('She asked me about the role in May.')
      await use()
      await page.getByText('You told Sky: “She asked me about the role in May.”').waitFor()
      const kept = await chip('Keep mine').getAttribute('aria-checked')
      await shot('15-wizard-odds')
      await on('What could happen if you choose “Split the role with Jane”?')
      await chip('20–40%').click()
      await on('What would change your mind?')
      const beliefs = (await page.locator('.sky-wizard-out').allInnerTexts()).map(flat)
      await choice('Check first, then decide').click()
      await on('When will you decide?')
      const todos = await ticked()
      await choice('Another day…').click()
      await page.locator('.sky-wizard-own input[type="date"]').fill('2030-07-01')
      await use()
      await choice('Email Sam Rivera and Priya Shah about July').click()
      await shot('16-wizard-check-first')
      await page.getByRole('button', { name: 'Save as open' }).click()
      await step('Saved as open').waitFor()
      await waitForTitle('sky · Saved: Who leads sales through the October launch')
      const parkedFile = await decisionFile(f.root, 'Who leads sales through the October launch')
      assert({
        given: 'odds given for each option, then the choice to check first',
        should:
          'hold Sky’s odds back until the person answers, ask what Sky is missing when they are far apart, and leave the decision in the notebook as open with a day to decide by, what was worked out so far, and the one check kept as a to-do',
        actual: [
          [heldBack, agree, apart, waits, kept],
          beliefs,
          todos,
          flat(await page.locator('.sky-wizard-read').innerText()),
          f.items,
          f.created.map((made) => [made.title, made.noEditor, made.decision, made.inForce]),
          [
            parkedFile?.file.includes('/pending/'),
            /\ntarget: 2030-07-01\n/.test(parkedFile?.text ?? ''),
            parkedFile?.text.includes(
              '  - goals/Run-a-Marathon\n  - goals/Learn-Spanish\n  - decisions/No-Late-Nights\n',
            ),
            parkedFile?.text.includes('- Promote Jane Doe to lead sales. My odds for the outcome I want: Over 80%.'),
          ],
        ],
        expected: [
          [
            0,
            'You and Sky land in the same place.',
            'You are well above Sky. What do you know that Sky doesn’t?',
            true,
            'true',
          ],
          [
            '1 Someone you trust can start as a part-time lead in July. Neither of the two people has been asked. To check: Two emails. Bears on: Part-time lead',
            '2 Jane wants to lead the team. You think so. You have not asked her. To check: One conversation. Bears on: Promote Jane',
          ],
          ['Email Sam Rivera and Priya Shah about July', 'Ask Jane whether she wants to lead the team'],
          'What happens next Added to today’s to-dos: Ask Jane whether she wants to lead the team. Sky keeps the decision in view in every chat until you make it.',
          [
            {
              task: 'Ask Jane whether she wants to lead the team',
              list: 'todos',
              when: '2030-06-18',
              category: 'Professional',
            },
          ],
          // Written once, as open, when the first step was left; the rest went into that file step by step.
          [['Who leads sales through the October launch', true, undefined, false]],
          [true, true, true, true],
        ],
      })

      await page.getByRole('button', { name: 'See your decisions' }).click()
      await waitForTitle('sky · Decisions')
      const parked = rows('To decide').filter({ hasText: 'Who leads sales through the October launch' })
      await parked.waitFor()
      await shot('17-decisions-open')
      const parkedRow = flat(await parked.innerText())
      const stillWorking = await page.getByRole('region', { name: 'Being worked through' }).count()
      await parked.getByRole('link', { name: 'Pick up where you stopped' }).click()
      await step('Your call').waitFor()
      const back = await page.locator('.sky-wizard-read h3').first().innerText()
      const columns = await page.locator('.sky-wizard-grid thead th').allInnerTexts()
      const odds = (await page.locator('.sky-wizard-odds').allInnerTexts()).map(flat)
      const first = flat(await page.locator('.sky-wizard-grid tbody tr').first().locator('th').innerText())
      await page.getByRole('button', { name: 'Promote Jane, Stay inside the hiring plan: No effect. Change' }).click()
      await page.getByRole('button', { name: 'Promote Jane, Stay inside the hiring plan: Helps. Change' }).waitFor()
      await shot('18-wizard-call')
      await choice('Promote Jane Doe to lead sales').click()
      await on('Sky would choose “Bring in a part-time sales lead for six months”')
      const panels = await page.locator('.sky-wizard-read h3').allInnerTexts()
      await choice('Keep my call').click()
      await on('It is a year from now and this went badly. Why?')
      await choice('You kept the big deals yourself.').click()
      await choice('Add a reason…').click()
      await typed().fill('Jane leaves anyway')
      await use()
      await choice('Jane leaves anyway').waitFor()
      await on('What will you do if it starts going wrong?')
      const rules = await ticked()
      await choice('If the scope is not written by Jul 15, pause.').click()
      await choice('If the pipeline is under $1.2M on Sep 1, reopen this decision.').click()
      await on('What do you expect to happen?')
      await choice('By Dec 31, $1.8M in new bookings.').click()
      await on('How sure are you that it turns out that way?')
      const startsFrom = await page.locator('.sky-wizard-chip[aria-checked="true"]').allInnerTexts()
      await chip('60–80%').click()
      await chip('Both').click()
      await on('The record')
      await chip('Yes. It stays in force').click()
      await shot('19-wizard-record')
      const preview = flat(await page.locator('.sky-wizard-doc').innerText())
      await page.getByRole('button', { name: 'Save decision' }).click()
      await step('Saved').waitFor()
      assert({
        given: 'the open decision picked up from the list',
        should:
          'start at the call with the options against what is wanted, hold Sky’s pick until the person chooses, and start how sure they are from the odds they gave',
        actual: [parkedRow, stillWorking, back, columns, odds, first, panels, rules, startsFrom],
        expected: [
          'Who leads sales through the October launch Pick up where you stopped Weighs on Learn Spanish and Run a marathon Decide by Jul 1',
          0,
          'You saved this as open to check a few things first',
          ['Part-time lead', 'Promote Jane', 'Split the role with Jane'],
          ['You: 40–60% Sky: 40–60%', 'You: Over 80% Sky: 40–60%', 'You: 20–40% Sky: 40–60%'],
          'Keep Jane Doe, your top account executive Comes first',
          ['Why', 'What your call has going for it', 'The strongest case against your call'],
          [
            'If the scope is not written by Jul 15, pause.',
            'If the pipeline is under $1.2M on Sep 1, reopen this decision.',
            'Review it on Dec 31.',
          ],
          ['Over 80%'],
        ],
      })

      const made = await decisionFile(f.root, 'Who leads sales through the October launch')
      const report = await f.store.report()
      assert({
        given: 'the call saved',
        should:
          'show the record as it is saved, put the made decision in force in place of the open one, set a reminder for each day to look back, and end the run',
        actual: [
          preview.includes(
            'The call Promote Jane Doe to lead sales. Sky would have chosen “Bring in a part-time sales lead for six months”.',
          ),
          flat(await page.locator('.sky-wizard-lede').innerText()),
          flat(await page.locator('.sky-wizard-read').innerText()),
          made?.file.includes('/in-force/'),
          [
            '## Desired Outcomes\n\n1. Keep Jane Doe, your top account executive (comes first)\n2. Keep your own time free for the October launch',
            '- Promote Jane Doe to lead sales. My odds for the outcome I want: Over 80%. Sky’s: 40–60%. What I know that Sky did not: She asked me about the role in May.',
            '## What I expect\n\nBy Dec 31, $1.8M in new bookings.\n\nHow sure: 60–80%. Look back: 2030-09-01 and 2030-12-31.',
            '## What it rests on\n\n- Jane wants to lead the team. Set aside to check before deciding.',
            '## What could sink it\n\n- You kept the big deals yourself.\n- Jane leaves anyway.',
            '## Rules set ahead of time\n\n- Review it on Dec 31.',
            '## Decision\n\nPromote Jane Doe to lead sales. Sky would have chosen “Bring in a part-time sales lead for six months”.',
          ].map((part) => made?.text.includes(part)),
          f.items.slice(1).map((item) => [item.list, item.when, item.task]),
          report.decisions
            .filter((decision) => decision.title === 'Who leads sales through the October launch')
            .map((decision) => decision.state),
          report.wizards,
          errors,
        ],
        expected: [
          true,
          'It is on your Decisions list under In force, dated today.',
          'What happens next A reminder to look back appears on your day page on Sep 1 and Dec 31. It asks whether it went the way you expected.',
          true,
          [true, true, true, true, true, true, true],
          [
            [
              'reminders',
              '2030-09-01',
              'Look back on “Who leads sales through the October launch”: did it go the way you expected?',
            ],
            [
              'reminders',
              '2030-12-31',
              'Look back on “Who leads sales through the October launch”: did it go the way you expected?',
            ],
          ],
          ['inForce'],
          [],
          [],
        ],
      })
    } finally {
      await close()
    }
  },
)

test(
  {
    name: 'The decision wizard follows Sky’s thinking, decides a small one fast, records one already made on a phone, and discards one that failed',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 180000,
  },
  async () => {
    const f = await futureFixture()
    const { page, origin, errors, shot, waitForTitle, close } = await open(f)
    const { step, choice, chip, ticked, typed, use, go, on } = wizardControls(page)
    try {
      await page.goto(`${origin}/future/decisions/new`)
      await choice('Something else…').click()
      await typed().fill('Whether to slow down hiring')
      await use()
      const unsaid = await page.getByRole('button', { name: 'Continue', exact: true }).isDisabled()
      await chip('I’m still deciding').click()
      await go()
      await step('Sky is thinking this through').waitFor()
      await waitForTitle('sky · Thinking… Whether to slow down hiring')
      await page
        .locator('.sky-wizard-think li[data-state="now"]', { hasText: 'Thinking it through at full effort' })
        .waitFor()
      await shot('20-wizard-thinking')
      const reading = flat(await page.locator('.sky-wizard-think li').first().innerText())
      await step('Which of these are you deciding?').waitFor()
      await waitForTitle('sky · Whether to slow down hiring')

      // Their own wording changes what is being decided, so Sky thinks again and the steps start over.
      await choice('Put it another way…').click()
      await typed().fill('Which laptop to buy')
      await use()
      await step('Sky is thinking this through').waitFor()
      await step('Which of these are you deciding?').waitFor()
      assert({
        given: 'a decision said in the person’s own words, then put another way',
        should:
          'wait to hear whether it is made, follow Sky’s thinking in the page and the tab, and think again from the new wording',
        actual: [unsaid, reading, f.thought],
        expected: [
          true,
          'Read what bears on this: 2 goals, 1 decision in force, 9 notes',
          [
            { statement: 'Whether to slow down hiring', decided: false },
            { statement: 'Which laptop to buy', decided: false },
          ],
        ],
      })

      await choice('Who leads sales through the October launch').click()
      await on('How much care does it deserve?')
      await choice('Decide fast').click()
      await on('Your call')
      const grid = await page.locator('.sky-wizard-grid').count()
      const where = [
        await page.locator('.sky-wizard-path [aria-current="step"]').innerText(),
        await page.locator('.sky-wizard-path li').count(),
      ]
      await choice('Bring in a part-time sales lead for six months').click()
      await on('Sky would make the same call')
      const against = flat(await page.locator('.sky-wizard-read').innerText())
      await choice('Look at the options again').click()
      await on('Your call')
      await on('Sky would make the same call')
      await choice('Keep my call').click()
      await on('What do you expect to happen?')
      await choice('Say it another way…').click()
      await typed().fill('The pipeline holds at $1.5M through October')
      await use()
      await on('How sure are you that it turns out that way?')
      const unset = await page.locator('.sky-wizard-chip[aria-checked="true"]').count()
      await chip('40–60%').click()
      await chip('Sep 1').click()
      await on('The record')
      await chip('Personal').click()
      await shot('21-wizard-fast-record')
      await page.getByRole('button', { name: 'Save decision' }).click()
      await step('Saved').waitFor()
      assert({
        given: 'a small decision taken down the fast path',
        should:
          'skip the comparison, say when Sky agrees and still give the case against, go back to the options when asked, and settle the open decision with the call and what is expected',
        actual: [grid, where, against, unset, f.made.at(-1), f.items],
        expected: [
          0,
          ['Your call', 3],
          'The strongest case against it Part-time lead leaves the hard part for later.',
          0,
          {
            title: 'Who leads sales through the October launch',
            context: 'You lead sales yourself, and the October launch needs most of your time from July.',
            desiredOutcomes: '',
            record: [
              '## What I expect\n\nThe pipeline holds at $1.5M through October.\n\nHow sure: 40–60%. Look back: 2030-09-01.',
              '## What it rests on\n\n- Someone you trust can start as a part-time lead in July. Not checked.',
            ].join('\n\n'),
            decision: 'Bring in a part-time sales lead for six months.',
            inForce: false,
            rel: [],
            category: 'Personal',
          },
          [
            {
              task: 'Look back on “Who leads sales through the October launch”: did it go the way you expected?',
              list: 'reminders',
              when: '2030-09-01',
              category: 'Personal',
            },
          ],
        ],
      })

      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`${origin}/future/decisions/new`)
      await choice('No senior hires before the Series B closes').click()
      const looksMade = await chip('I’ve already decided').getAttribute('aria-checked')
      await on('What did you decide?')
      await choice('No senior hires before the Series B closes').click()
      await on('When did you decide it?')
      await choice('Mar 12').click()
      await on('What did you know that day?')
      const knew = await ticked()
      await on('What did you want from it?')
      await on('What else was on the table?')
      await choice('Freeze all hiring, not only senior roles').click()
      await on('Does it still bind what you do?')
      await choice('Yes, until the Series B closes').click()
      await on('What did you expect to happen?')
      await choice('By Sep 30 the Series B has closed').click()
      await on('How sure were you?')
      await chip('60–80%').click()
      await chip('Sep 30').click()
      await on('The record')
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      await shot('22-wizard-made-phone')
      await page.getByRole('button', { name: 'Save decision' }).click()
      await step('Saved').waitFor()
      assert({
        given: 'a decision already made, written down on a phone',
        should:
          'start from Sky’s read that it is made, rest only on what was known that day, fit the screen, and save it dated the day it was made and still in force',
        actual: [
          looksMade,
          knew,
          fits,
          flat(await page.locator('.sky-wizard-lede').innerText()),
          f.created.at(-1),
          f.items.at(-1),
        ],
        expected: [
          'true',
          [
            'Burn was $520k a month against a plan of $450k.',
            'The lead investor wanted the round closed before any new senior salaries.',
          ],
          true,
          'It is on your Decisions list under In force, dated Mar 12.',
          {
            title: 'No senior hires before the Series B closes',
            context: 'Burn was over plan in March and the lead investor wanted the round closed first.',
            desiredOutcomes:
              '- Get burn back under $450k a month\n- Close the Series B without new senior salaries on the books',
            record: [
              '## Options not taken\n\n- Freeze all hiring, not only senior roles.',
              '## What I knew that day\n\n- Burn was $520k a month against a plan of $450k. (Finance review, Mar 8)\n- The lead investor wanted the round closed before any new senior salaries. (Call notes, Mar 5)',
              '## What I expected\n\nBy Sep 30 the Series B has closed, with no new senior salaries added.\n\nHow sure I was: 60–80%. Look back: 2030-09-30.',
              '## Learned since\n\n- The round slipped from July to the third quarter. (Investor update, Jun 6)',
            ].join('\n\n'),
            decision: 'No senior hires before the Series B closes. It holds until the Series B closes.',
            inForce: true,
            rel: ['goals/Learn-Spanish'],
            category: 'Professional',
            when: '2030-03-12',
          },
          {
            task: 'Look back on “No senior hires before the Series B closes”: did it go the way you expected?',
            list: 'reminders',
            when: '2030-09-30',
            category: 'Professional',
          },
        ],
      })

      await page.setViewportSize({ width: 1440, height: 1100 })
      await page.goto(`${origin}/future/decisions/new`)
      await choice('Something else…').click()
      await typed().fill('Whether to fail fast on the new pricing')
      await use()
      await chip('I’m still deciding').click()
      await go()
      await step('Sky could not finish thinking').waitFor()
      const why = flat(await page.locator('.sky-wizard-lede').innerText())
      await page.getByRole('link', { name: 'Decisions', exact: true }).click()
      await waitForTitle('sky · Decisions')
      const working = page.getByRole('region', { name: 'Being worked through' }).locator('.sky-future-row')
      await working.waitFor()
      await shot('23-decisions-being-worked-through')
      const row = flat(await working.innerText())
      const tab = flat(
        await page
          .getByRole('link', { name: /^Decisions/ })
          .last()
          .innerText(),
      )
      await working.getByRole('button', { name: 'Discard' }).click()
      const asks = flat(await working.locator('.sky-future-row-confirm > span').first().innerText())
      await working.getByRole('button', { name: 'Keep it' }).click()
      const keptRun = (await f.store.report()).wizards.length
      await working.getByRole('button', { name: 'Discard' }).click()
      await working.getByRole('group').getByRole('button', { name: 'Discard' }).click()
      await working.waitFor({ state: 'detached' })
      assert({
        given: 'a decision Sky could not think through',
        should:
          'say what went wrong, keep it on the Decisions list as being worked through, and discard it only after asking',
        actual: [why, row, tab, asks, keptRun, (await f.store.report()).wizards, errors],
        expected: [
          'Sky could not think this through: The model did not answer.',
          'Whether to fail fast on the new pricing Discard Not in your notebook yet. It is saved when you finish. Sky could not finish thinking',
          'Decisions4',
          'Discard this? Sky’s thinking and your answers so far are deleted.',
          1,
          [],
          [],
        ],
      })
    } finally {
      await close()
    }
  },
)
