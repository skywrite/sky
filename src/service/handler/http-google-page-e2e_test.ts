import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import { initialSetupState, saveAccountTokens, saveProjectClient } from '#lib/google/mod.ts'
import type { CloudSetupState } from '#lib/google/mod.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'
import { type ConnectionsHost, createConnectionsRoutes } from './settings/connections.ts'
import type { SettingsData } from './settings/mod.ts'

/**
 * Google's page under Connections, in a browser over a scripted host: the
 * row leads there, Connect shows what the person agrees to, Start runs the
 * setup and the checklist follows it — the sign-in wait, a step Sky could
 * not do with its Continue, the boxes to tick — and a connected account
 * shows what it covers, names a box left unticked, and says who set it up.
 * SKY_GOOGLE_SCREENSHOTS names a folder for captures.
 */

/** The run, as a scripted host tells it: one state per poll, advanced by the page's own asks. */
function scriptedRun(): { states: CloudSetupState[]; continued: number; cancelled: number } {
  const mark = (state: CloudSetupState, key: string, to: 'doing' | 'done'): CloudSetupState => ({
    ...state,
    steps: state.steps.map((step) => (step.key === key ? { ...step, state: to } : step)),
  })
  const s0 = initialSetupState()
  const s1 = {
    ...mark(s0, 'signin', 'doing'),
    needsYou: { step: 'signin' as const, message: 'Sign in to Google — in the window that opened' },
  }
  const s2 = mark(mark(s1, 'signin', 'done'), 'project', 'doing')
  const { needsYou: _none, ...s2clear } = s2
  const s3 = { ...mark(mark(s2clear, 'project', 'done'), 'apis', 'doing'), projectId: 'sky-471915' }
  const s4 = mark(mark(s3, 'apis', 'done'), 'branding', 'doing')
  const s5 = { ...mark(mark(s4, 'branding', 'done'), 'publish', 'doing'), account: 'jane@example.com' }
  const s6 = {
    ...s5,
    needsYou: {
      step: 'publish' as const,
      message: 'Could not find the Publish app button. Do this step in the window, then press Continue.',
      instruction: 'Google Auth Platform > Audience — Publish app (in Testing, every grant expires after 7 days).',
    },
  }
  return { states: [s0, s1, s2clear, s3, s4, s5, s6], continued: 0, cancelled: 0 }
}

test(
  {
    name: 'The Google page: the row, the start screen, the checklist as it runs, and a connected account',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 90000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-google-page-'))
    await mkdir(path.join(root, 'journal'))
    const secrets = new TestSecretsProvider({})
    const run = scriptedRun()
    let tick = 0
    let phase: 'before' | 'running' | 'after' = 'before'
    let typesafeConnected = false
    const host: ConnectionsHost = {
      secrets,
      providers: () => [],
      google: {
        connect: () => Promise.resolve(null),
        connection: () => null,
        setup: {
          start: () => {
            phase = 'running'
            tick = 0
            return { id: 'run-1' }
          },
          state: (id) => {
            if (id !== 'run-1' || phase === 'before') return null
            if (phase === 'after') {
              const last = run.states.at(-1)!
              return {
                ...last,
                status: 'done',
                email: 'jane@example.com',
                steps: last.steps.map((step) => ({ ...step, state: 'done' })),
              }
            }
            // The run advances one state per look, and holds on the step that needs the person.
            const state = run.states[Math.min(tick, run.states.length - 1)]!
            tick += 1
            return state
          },
          continue: (id) => {
            if (id !== 'run-1') return false
            run.continued += 1
            phase = 'after'
            return true
          },
          cancel: (id) => {
            if (id !== 'run-1') return false
            run.cancelled += 1
            return true
          },
        },
      },
      slack: {
        status: () => Promise.resolve({ installed: false }),
        reconnect: () => Promise.resolve({ installed: false }),
      },
      beeper: {
        status: () => Promise.resolve({ running: false, connected: false, accounts: [] }),
        connect: () => Promise.resolve(null),
        connection: () => null,
        token: () => Promise.resolve({ ok: false, message: 'no Beeper here' }),
        disconnect: () => Promise.resolve(),
      },
      typesafe: {
        status: () => Promise.resolve({ connected: typesafeConnected, models: typesafeConnected ? ['jev-test'] : [] }),
        key: () => Promise.resolve({ ok: false, message: 'no TypeSafe here' }),
        disconnect: () => Promise.resolve(),
      },
    }
    const accountCategories: Record<string, 'Professional' | 'Personal'> = {}
    const settings: SettingsData = {
      calendar: { classifyEvents: false },
      google: { accountCategories },
      theme: 'light',
      experimental: { contextPreflight: false, workstreams: false },
      textSize: 'default',
      voice: { current: 'marin', researcherCurrent: 'ash', groups: { male: ['ash'], female: ['marin'] } },
      models: [],
      profiles: [],
      writingVoice: { profile: 'sample', choices: [] },
      providers: [],
      memoryNotes: 0,
      notebook: {
        dir: '/Notebook',
        userDataDir: '/Notebook-Data',
        inputDir: '/Input',
        outputDir: '/Output',
        editor: 'code',
        editors: ['code'],
      },
      about: { version: 'sample', date: '2026-01-15' },
      advanced: { path: '/Config/config.jsonc', exists: true, version: 1, sections: [] },
    }
    const app = new Hono()
    let refuseCalendarSave = false
    app.get('/settings/_api/settings', (c) => c.json(settings))
    app.post('/settings/_api/set', async (c) => {
      const input = await c.req.json()
      if (input.key !== 'calendar.classifyEvents') return c.json({ message: 'Unexpected setting' }, 400)
      if (refuseCalendarSave) return c.json({ message: 'Could not save the calendar setting.' }, 500)
      settings.calendar.classifyEvents = input.value === 'true'
      return c.json({ ok: true })
    })
    const categoryPosts: unknown[] = []
    app.post('/settings/_api/google/category', async (c) => {
      const input = (await c.req.json()) as { email: string; category: 'Professional' | 'Personal' }
      categoryPosts.push(input)
      accountCategories[input.email.toLowerCase()] = input.category
      return c.json({ ok: true })
    })
    app.route('/settings/_api/connections', createConnectionsRoutes(host))
    app.route('/', createTestHttpApp([path.join(root, 'journal')]))
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test address')
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const base = `http://127.0.0.1:${address.port}`
      const screenshots = env.get('SKY_GOOGLE_SCREENSHOTS')
      const capture = async (name: string) => {
        if (!screenshots) return
        const height = await page.evaluate(
          () => (document.querySelector('.sky-scroll') as HTMLElement).scrollHeight + 40,
        )
        await page.setViewportSize({ width: page.viewportSize()!.width, height: Math.min(height, 4000) })
        await page.screenshot({ path: path.join(screenshots, `${name}.png`) })
      }

      // The row, not connected, leads to the page.
      await page.goto(`${base}/settings/connections`)
      const googleRow = page.locator('.sky-set-row', { hasText: 'Google' }).first()
      await googleRow.getByRole('button', { name: 'Connect' }).waitFor()
      const rowBefore = await googleRow.locator('.sky-set-sub').innerText()
      await capture('1-connections-list')
      await googleRow.getByRole('button', { name: 'Connect' }).click()
      await page.getByRole('heading', { name: 'Google', exact: true }).waitFor()
      const url = new URL(page.url()).pathname
      const classify = page.getByRole('switch', { name: 'Hide family notifications and reminders' })
      await page.getByRole('link', { name: 'Set up TypeSafe' }).waitFor()
      const missingKeyDisabled = await classify.isDisabled()
      typesafeConnected = true
      await page.reload()
      await classify.waitFor()
      await page.waitForFunction(
        () =>
          !document.querySelector<HTMLInputElement>('input[aria-label="Hide family notifications and reminders"]')
            ?.disabled,
      )
      refuseCalendarSave = true
      await classify.focus()
      await classify.press('Space')
      await page.getByRole('alert').filter({ hasText: 'Could not save the calendar setting.' }).waitFor()
      const failedSaveOff = !(await classify.isChecked())
      refuseCalendarSave = false
      await classify.locator('..').click()
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLInputElement>('input[aria-label="Hide family notifications and reminders"]')
            ?.checked,
      )
      await page.reload()
      await classify.waitFor()
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLInputElement>('input[aria-label="Hide family notifications and reminders"]')
            ?.checked,
      )
      const classificationSaved = await classify.isChecked()
      assert({
        given: 'a missing key, a working key, a rejected save and a successful save followed by reload',
        should: 'guide setup, keep the previous value on failure and persist the enabled calendar switch',
        actual: [missingKeyDisabled, failedSaveOff, classificationSaved],
        expected: [true, true, true],
      })
      await capture('2-google-not-connected')

      // Connect: what the person agrees to, then Start.
      await page.getByRole('button', { name: 'Connect Google' }).click()
      await page.getByRole('button', { name: 'Start', exact: true }).waitFor()
      const agreeLine = await page
        .locator('.sky-set-row', { hasText: 'New account' })
        .locator('.sky-set-sub')
        .first()
        .innerText()
      await capture('3-google-start')
      await page.getByRole('button', { name: 'Start', exact: true }).click()

      // The checklist: the sign-in wait first, then the step Sky could not do.
      await page.getByRole('status').filter({ hasText: 'Sign in to Google' }).waitFor()
      await capture('4-google-signing-in')
      await page.getByRole('button', { name: 'Done — continue' }).waitFor()
      const stuck = await page.getByRole('status').innerText()
      const runRow = await page
        .locator('.sky-set-row', { hasText: 'Signing you in' })
        .locator('.sky-set-txt > div')
        .first()
        .innerText()
      const marks = await page
        .locator('.sky-set-checklist li')
        .evaluateAll((nodes) => nodes.map((node) => `${node.getAttribute('data-state')}`))
      await capture('5-google-needs-you')
      await page.getByRole('button', { name: 'Done — continue' }).click()

      // Done: the account lands in the keychain (scripted here) and the page reads it back.
      await saveProjectClient(secrets, 'sky-471915', { clientId: 'id', clientSecret: 'sec' })
      await saveAccountTokens(secrets, 'jane@example.com', {
        refreshToken: 'rt',
        scopes: [
          'https://www.googleapis.com/auth/calendar.readonly',
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/documents',
        ],
        client: 'client:sky-471915',
        setup: { projectId: 'sky-471915', at: '2026-09-22T09:03:00.000Z' },
      })
      await page.getByRole('status').filter({ hasText: 'Connected jane@example.com' }).waitFor()
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      const accountRow = page.locator('.sky-set-row', { hasText: 'jane@example.com' }).first()
      await accountRow.getByRole('button', { name: 'Connect again' }).waitFor()
      const accountSub = await accountRow.locator('.sky-set-sub').first().innerText()
      await capture('6-google-connected')

      // The account's side of the day: Professional until chosen, then Personal — saved, and read back after a reload.
      const sideLabel = 'Side of the day for jane@example.com'
      const side = page.locator(`[aria-label="${sideLabel}"]`)
      const chosenSide = () =>
        page.evaluate(
          (label) => document.querySelector<HTMLInputElement>(`[aria-label="${label}"] input:checked`)?.value ?? null,
          sideLabel,
        )
      await side.waitFor()
      const sideBefore = await chosenSide()
      const saved = page.waitForResponse((response) => response.url().endsWith('/settings/_api/google/category'))
      await side.getByText('Personal', { exact: true }).click()
      await saved
      await page.reload()
      await side.waitFor()
      await page.waitForFunction(
        (label) =>
          document.querySelector<HTMLInputElement>(`[aria-label="${label}"] input:checked`)?.value === 'Personal',
        sideLabel,
      )
      const sideAfter = await chosenSide()
      await capture('6b-google-side-of-the-day')
      assert({
        given: 'a connected account, Personal chosen for it, and the page reloaded',
        should: 'show Professional until chosen, save the choice once, and read Personal back',
        actual: [sideBefore, categoryPosts, sideAfter],
        expected: ['Professional', [{ email: 'jane@example.com', category: 'Personal' }], 'Personal'],
      })

      await page.getByRole('button', { name: '‹ Connections' }).click()
      await googleRow.getByRole('button', { name: 'Google settings' }).waitFor()
      const rowAfter = await googleRow.locator('.sky-set-sub').innerText()

      await page.setViewportSize({ width: 390, height: 900 })
      await page.goto(`${base}/settings/connections/google`)
      await page.getByRole('heading', { name: 'Google', exact: true }).waitFor()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
      await capture('7-google-phone')

      assert({
        given: 'the Google page over a scripted host, in a browser',
        should:
          'lead from the row, say what the person agrees to, follow the run as a row of its own named once the console shows the account, hand a stuck step to the person, read the account back, and fit a phone',
        actual: [
          rowBefore.includes('Sign in, tick the boxes'),
          url,
          agreeLine.includes('Google Cloud’s terms') && agreeLine.includes('API user data policy'),
          stuck.includes('Could not find the Publish app button') && stuck.includes('Google Auth Platform > Audience'),
          runRow,
          marks,
          run.continued,
          run.cancelled,
          accountSub.includes("Mail wasn't ticked") &&
            accountSub.includes('Set up by Sky on') &&
            accountSub.includes('sky-471915'),
          rowAfter.includes('jane@example.com') && rowAfter.includes('Mail not ticked'),
          overflow,
          errors,
        ],
        expected: [
          true,
          '/settings/connections/google',
          true,
          true,
          'jane@example.com',
          ['done', 'done', 'done', 'done', 'doing', 'todo', 'todo', 'todo'],
          1,
          0,
          true,
          true,
          false,
          [],
        ],
      })
    } finally {
      await browser?.close()
      server.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)
