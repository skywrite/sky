import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { chromium } from 'playwright'
import { executeAutomationCommands } from '#lib/automations/execute.ts'
import Automation from '#shared/models/Automation/mod.ts'
import { setAutomationStatus } from '#shared/models/Automation/setStatus.ts'
import { describeTrigger, frameOf } from '#shared/models/Automation/trigger.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { configureAutomation, setupFromCharter, type AutomationCommand } from './automations/configure.ts'
import type { AutomationsRoutesOptions } from './automations/mod.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'

test(
  {
    name: 'five commands create through a wizard and run as one automation, with customization and editing',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 90000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-automations-e2e-'))
    const dir = path.join(root, 'automations')
    await mkdir(dir)
    const catalog: AutomationCommand[] = ['journal', 'notes', 'tasks', 'meetings', 'activity'].map((name) => ({
      name: `recap:${name}`,
      description: `Recap saved ${name} activity.`,
      source: 'local',
      flags: [
        { name: 'day', kind: 'arg', type: 'plainDate', description: 'Day to recap' },
        { name: 'no-editor', kind: 'flag', type: 'bool', description: 'Keep the editor closed' },
      ],
    }))
    const files = new Map<string, string>()
    const creates: string[] = []
    const requests: [string, string | undefined][] = []
    const invoked: string[] = []
    let failOnce = true
    const save = async (name: string, contents: string) => {
      Automation.fromMarkdown(contents, name)
      await writeFile(path.join(dir, `${name}.md`), contents)
      files.set(name, contents)
    }
    await save(
      'legacy-recap',
      `---
# Keep the original note
run: recap:journal
args:
  day: yesterday
  noEditor: true
at: 07:00
status: paused
created: 2025-01-01
---

Keep the journal recap current.
`,
    )
    const host: AutomationsRoutesOptions = {
      commands: async () => catalog,
      configuration: async (name) => (files.has(name) ? setupFromCharter(name, files.get(name)!) : null),
      preview: async (setup) =>
        configureAutomation(setup, {
          commands: catalog,
          existingNames: new Set(files.keys()),
          today: new PlainDate('2025-03-15'),
          current:
            setup.revise && files.has(setup.revise)
              ? { name: setup.revise, contents: files.get(setup.revise)! }
              : undefined,
        }),
      status: async () => ({
        dir,
        charterErrors: [],
        rows: [...files].map(([name, contents]) => {
          const automation = Automation.fromMarkdown(contents, name)
          return {
            name,
            kind: automation.kind,
            run: automation.run,
            commands: automation.commands,
            trigger: describeTrigger(automation.trigger),
            frame: frameOf(automation.trigger),
            state: automation.status,
            due: false,
            brief: automation.brief,
            unknownKeys: [],
            file: `${name}.md`,
            runs: [],
          }
        }),
      }),
      setStatus: async (name, status) => {
        if (!files.has(name)) return false
        await save(name, setAutomationStatus(files.get(name)!, status))
        return true
      },
      create: async (name, contents) => {
        creates.push(name)
        if (failOnce) {
          failOnce = false
          throw new Error('Mock write failed; retry this automation.')
        }
        if (files.has(name)) return { kind: 'exists' }
        await save(name, contents)
        return { kind: 'created' }
      },
      save: async (name, contents) => {
        if (!files.has(name)) return { kind: 'missing' }
        await save(name, contents)
        return { kind: 'saved' }
      },
      runNow: async (name) => {
        if (!files.has(name)) return null
        return executeAutomationCommands(Automation.fromMarkdown(files.get(name)!, name).commands, async ({ run }) => {
          invoked.push(run)
          return { outcome: 'acted', message: 'Mock recap saved' }
        })
      },
      draft: async (request, revise) => {
        requests.push([request, revise])
        const name = revise ?? 'morning-recaps'
        const selected = revise ? catalog.slice(0, 2) : catalog
        const contents = `---
# Keep the drafted context
commands:
${selected.map(({ name }) => `  - run: ${name}\n    args:\n      day: ${revise ? 'today' : 'yesterday'}\n      noEditor: true`).join('\n')}
at: ${revise ? 'EVERY-DAY 10:20' : 'EVERY-DAY 06:30'}
tz: Europe/Paris
until: 2025-11-30
status: active
created: 2025-01-01
tags: [mock]
---

${revise ? 'The revised recap instructions.' : 'Prepare the previous day’s recaps for the morning.'}
`
        const automation = Automation.fromMarkdown(contents, name)
        return {
          name,
          contents,
          run: automation.run,
          commands: automation.commands,
          trigger: describeTrigger(automation.trigger),
          frame: frameOf(automation.trigger),
          brief: automation.brief,
          revised: !!revise,
        }
      },
    }
    const app = createTestHttpApp([dir], {
      automations: host,
      chat: {
        createSession: async () => {
          throw new Error('No chat fixture')
        },
        timeDir: path.join(root, 'time'),
      },
    })
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test address')
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })
      page.setDefaultTimeout(10000)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const base = `http://127.0.0.1:${address.port}`
      await page.goto(`${base}/automations/new`)
      const describe = page.getByRole('textbox', { name: 'Describe your automation', exact: true })
      const currentStep = page.locator('.sky-auto-steps [aria-current="step"]')
      const review = page.getByRole('button', { name: 'Review automation', exact: true })
      const back = page.getByRole('button', { name: 'Back', exact: true })
      const screenshots = env.get('SKY_AUTOMATIONS_SCREENSHOTS')
      if (screenshots) {
        await mkdir(screenshots, { recursive: true })
        await page.screenshot({ path: path.join(screenshots, 'describe-desktop.png'), fullPage: true })
      }
      assert({
        given: 'a new automation',
        should: 'start with describing it and keep the command form out of the way',
        actual: [
          await describe.isVisible(),
          await page.locator('.sky-auto-builder').count(),
          await currentStep.textContent(),
          await page.getByRole('button', { name: 'Continue', exact: true }).isDisabled(),
        ],
        expected: [true, 0, '1Describe', true],
      })
      await page.getByRole('button', { name: 'Choose commands instead', exact: true }).click()
      const picker = page.getByRole('combobox', { name: 'Commands', exact: true })
      await picker.fill('saved notes')
      await page.getByRole('option', { name: /recap:notes/ }).waitFor()
      await picker.press('ArrowDown')
      await picker.press('Enter')
      await picker.press('Escape')
      assert({
        given: 'a description typed into command completion',
        should: 'select the installed command with the keyboard',
        actual: await page.locator('.mantine-MultiSelect-pill').allTextContents(),
        expected: ['recap:notes'],
      })
      await page.getByRole('combobox', { name: 'Repeat', exact: true }).click()
      await page.getByRole('option', { name: 'At an interval', exact: true }).click()
      await page.getByRole('button', { name: 'Morning recaps', exact: true }).click()
      await review.click()
      await page.getByRole('button', { name: 'Turn it on', exact: true }).waitFor()
      assert({
        given: 'the morning preset after an interval schedule',
        should: 'preview one daily automation containing all five commands, without a model call or file write',
        actual: [
          await page.locator('.sky-auto-command-list').count(),
          await page.locator('.sky-auto-command-list li').count(),
          await page.locator('.sky-auto-spec').first().textContent(),
          await currentStep.textContent(),
          await page.locator('.sky-auto-builder').isVisible(),
          await describe.isVisible(),
          await readdir(dir),
          requests.length,
        ],
        expected: [1, 5, 'WhenEvery day at 7:00', '3Review', false, false, ['legacy-recap.md'], 0],
      })
      assert({
        given: 'continuing from the bottom of a long configuration form',
        should: 'open the review at the top and move keyboard focus to its heading',
        actual: await page.evaluate(() => [
          document.querySelector('.sky-main > .sky-scroll')!.scrollTop,
          document.activeElement?.textContent,
        ]),
        expected: [0, 'Ready to turn it on?'],
      })
      await back.click()
      await page.getByLabel('Time', { exact: true }).fill('08:15')
      await page.getByLabel('What this is for', { exact: true }).fill('Prepare the mock activity summary.')
      await back.click()
      await page.getByRole('button', { name: 'Choose commands instead', exact: true }).click()
      assert({
        given: 'going back through both earlier steps of a manual setup',
        should: 'preserve commands, timing and context without a model call or a save action',
        actual: [
          await page.locator('.mantine-MultiSelect-pill').allTextContents(),
          await page.getByLabel('Time', { exact: true }).inputValue(),
          await page.getByLabel('What this is for', { exact: true }).inputValue(),
          await page.getByRole('button', { name: 'Turn it on', exact: true }).count(),
          requests.length,
          creates.length,
        ],
        expected: [catalog.map(({ name }) => name), '08:15', 'Prepare the mock activity summary.', 0, 0, 0],
      })
      await page.getByLabel('Automation name', { exact: true }).fill('invalid name')
      await review.click()
      await page.getByRole('alert').filter({ hasText: 'Use letters, digits and dashes' }).waitFor()
      assert({
        given: 'invalid settings at the review boundary',
        should: 'stay on Configure with the values available to correct and nothing written',
        actual: [await currentStep.textContent(), await page.locator('.sky-auto-builder').isVisible(), creates.length],
        expected: ['2Configure', true, 0],
      })
      await page.getByLabel('Automation name', { exact: true }).fill('mock-recaps')
      await review.click()
      await page.getByRole('button', { name: 'Turn it on', exact: true }).waitFor()
      assert({
        given: 'correcting the settings and reviewing again',
        should: 'use the latest schedule in the new proposal',
        actual: await page.locator('.sky-auto-spec').first().textContent(),
        expected: 'WhenEvery day at 8:15',
      })

      await page.goto(`${base}/automations/new`)
      await describe.fill('Run the previous day’s recaps every morning at 06:30.')
      await page.route(
        '**/automations/_api/draft',
        (route) =>
          route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Mock drafting unavailable; try again.' }),
          }),
        { times: 1 },
      )
      await describe.press('Enter')
      await page.getByRole('alert').filter({ hasText: 'Mock drafting unavailable' }).waitFor()
      assert({
        given: 'a failed description request',
        should: 'keep the description ready to retry on its own step',
        actual: [
          await currentStep.textContent(),
          await describe.inputValue(),
          await page.getByRole('button', { name: 'Turn it on', exact: true }).count(),
        ],
        expected: ['1Describe', 'Run the previous day’s recaps every morning at 06:30.', 0],
      })
      await page.getByRole('button', { name: 'Continue', exact: true }).click()
      await review.waitFor()
      await page.getByText('More conditions', { exact: true }).click()
      assert({
        given: 'a described group advancing to Configure',
        should: 'load every command and shared setting on its own step without writing a file',
        actual: [
          await currentStep.textContent(),
          await describe.isVisible(),
          await page.locator('.mantine-MultiSelect-pill').allTextContents(),
          await page.getByLabel('Time', { exact: true }).inputValue(),
          await page.getByRole('combobox', { name: 'Day to recap', exact: true }).inputValue(),
          await page.getByLabel('Time zone', { exact: true }).inputValue(),
          await page.getByLabel('Last day to run', { exact: true }).inputValue(),
          await page.getByLabel('Automation name', { exact: true }).inputValue(),
          await page.getByLabel('Automation name', { exact: true }).count(),
          files.size,
        ],
        expected: [
          '2Configure',
          false,
          catalog.map(({ name }) => name),
          '06:30',
          'Previous day',
          'Europe/Paris',
          '2025-11-30',
          'morning-recaps',
          1,
          1,
        ],
      })
      await review.click()
      await page.getByRole('button', { name: 'Turn it on', exact: true }).waitFor()
      await back.click()
      await page.getByLabel('Time', { exact: true }).fill('06:45')
      assert({
        given: 'an adjustment after preview',
        should: 'remove the stale save action',
        actual: await page.getByRole('button', { name: 'Turn it on', exact: true }).count(),
        expected: 0,
      })
      if (screenshots) {
        await page.locator('.sky-auto-hero').scrollIntoViewIfNeeded()
        await page.screenshot({ path: path.join(screenshots, 'configure-desktop.png'), fullPage: true })
      }
      await review.click()
      await page.getByRole('button', { name: 'Turn it on', exact: true }).waitFor()
      if (screenshots) {
        await page.screenshot({ path: path.join(screenshots, 'desktop.png'), fullPage: true })
      }
      await page.setViewportSize({ width: 390, height: 844 })
      const closeNavigation = page.getByRole('button', { name: 'Close', exact: true })
      if (await closeNavigation.isVisible()) await closeNavigation.click()
      await page.waitForFunction(() => document.querySelector('.sky-side')!.getBoundingClientRect().right <= 0)
      assert({
        given: 'a five-command review at phone width',
        should: 'fit without horizontal overflow',
        actual: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        expected: true,
      })
      if (screenshots) {
        await page.screenshot({ path: path.join(screenshots, 'mobile.png'), fullPage: true })
      }
      await back.click()
      assert({
        given: 'Back from Review at phone width',
        should: 'restore the edited schedule on Configure without a stale proposal or overflow',
        actual: [
          await page.getByLabel('Time', { exact: true }).inputValue(),
          await page.locator('.sky-auto-command-list').count(),
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        ],
        expected: ['06:45', 0, true],
      })
      if (screenshots) await page.screenshot({ path: path.join(screenshots, 'configure-mobile.png'), fullPage: true })
      await back.click()
      assert({
        given: 'Back from Configure at phone width',
        should: 'restore the original description without overflowing the page',
        actual: [
          await describe.inputValue(),
          await page.locator('.sky-auto-builder').isVisible(),
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        ],
        expected: ['Run the previous day’s recaps every morning at 06:30.', false, true],
      })
      if (screenshots) await page.screenshot({ path: path.join(screenshots, 'describe-mobile.png'), fullPage: true })
      await page.getByRole('button', { name: 'Continue', exact: true }).click()
      assert({
        given: 'continuing with the same description after going back',
        should: 'keep the manual edits without another model request',
        actual: [await page.getByLabel('Time', { exact: true }).inputValue(), requests.length],
        expected: ['06:45', 1],
      })
      await review.click()
      await page.getByRole('button', { name: 'Turn it on', exact: true }).waitFor()
      await page.setViewportSize({ width: 1500, height: 1100 })
      await page.evaluate(() =>
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: 'mantine-color-scheme-value',
            newValue: 'dark',
            storageArea: window.localStorage,
          }),
        ),
      )
      await page.locator('html[data-mantine-color-scheme="dark"]').waitFor()
      if (screenshots) await page.screenshot({ path: path.join(screenshots, 'review-dark.png'), fullPage: true })
      await page.evaluate(() =>
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: 'mantine-color-scheme-value',
            newValue: 'light',
            storageArea: window.localStorage,
          }),
        ),
      )
      await page.getByRole('button', { name: 'Turn it on', exact: true }).click()
      await page.getByText('Mock write failed; retry this automation.', { exact: true }).waitFor()
      assert({
        given: 'a failed create',
        should: 'leave no partial group files',
        actual: await readdir(dir),
        expected: ['legacy-recap.md'],
      })
      await page.getByRole('button', { name: 'Turn it on', exact: true }).click()
      await page.waitForURL('**/automations/morning-recaps')
      const contents = await readFile(path.join(dir, 'morning-recaps.md'), 'utf8')
      const saved = Automation.fromMarkdown(contents, 'morning-recaps')
      assert({
        given: 'turning on five commands and retrying the failed write',
        should: 'create exactly one new charter with the selected arguments, schedule and drafted context',
        actual: [
          (await readdir(dir)).sort(),
          creates,
          saved.commands,
          describeTrigger(saved.trigger),
          frameOf(saved.trigger),
          saved.until?.ymd,
          contents.includes('# Keep the drafted context'),
          contents.includes('created: 2025-01-01'),
          Document.fromMarkdown(contents).yaml.tags,
          saved.brief,
        ],
        expected: [
          ['legacy-recap.md', 'morning-recaps.md'],
          ['morning-recaps', 'morning-recaps'],
          catalog.map(({ name }) => ({ run: name, args: { day: 'yesterday', noEditor: true } })),
          'EVERY-DAY 06:45',
          'Europe/Paris',
          '2025-11-30',
          true,
          true,
          ['mock'],
          'Prepare the previous day’s recaps for the morning.',
        ],
      })
      await page.getByRole('button', { name: 'Run now', exact: true }).click()
      await page.getByText(/ran — recap:journal: acted/).waitFor()
      assert({
        given: 'Run now on one group',
        should: 'invoke all five commands in order',
        actual: invoked,
        expected: catalog.map(({ name }) => name),
      })
      await page.getByRole('switch', { name: 'Morning recaps on', exact: true }).focus()
      await page.getByRole('switch', { name: 'Morning recaps on', exact: true }).press('Space')
      await page.getByLabel('Morning recaps off', { exact: true }).waitFor()
      assert({
        given: 'the group’s one pause switch',
        should: 'pause its charter while preserving all commands',
        actual: [Automation.fromMarkdown(files.get('morning-recaps')!, 'morning-recaps').status, files.size],
        expected: ['paused', 2],
      })
      await page.getByRole('button', { name: 'Edit automation', exact: true }).click()
      await page.locator('.mantine-MultiSelect-pill').filter({ hasText: 'recap:activity' }).locator('button').click()
      await page.getByRole('button', { name: 'Browse commands', exact: true }).click()
      await page.getByRole('option', { name: /^recap:activity/ }).click()
      await picker.press('Escape')
      await page.getByLabel('Time', { exact: true }).fill('07:15')
      await page.getByRole('button', { name: 'Preview automation', exact: true }).click()
      await page.getByRole('button', { name: 'Apply', exact: true }).click()
      await page.getByText('updated — file rewritten', { exact: true }).waitFor()
      assert({
        given: 'editing the group and removing then adding a command',
        should: 'keep all five under the same paused automation and change its shared schedule',
        actual: [
          Automation.fromMarkdown(files.get('morning-recaps')!, 'morning-recaps').commands.length,
          Automation.fromMarkdown(files.get('morning-recaps')!, 'morning-recaps').status,
          describeTrigger(Automation.fromMarkdown(files.get('morning-recaps')!, 'morning-recaps').trigger),
          files.size,
        ],
        expected: [5, 'paused', 'EVERY-DAY 07:15', 2],
      })

      await page.getByText('Describe a change', { exact: true }).click()
      const change = page.getByRole('textbox', {
        name: 'Tell sky what to change — “run at 8 instead”, “skip fridays”…',
        exact: true,
      })
      await change.fill('Use just journal and notes every day at 10:20, for today.')
      await change.press('Enter')
      await page.getByRole('button', { name: 'Customize', exact: true }).click()
      await page.getByRole('button', { name: 'Preview automation', exact: true }).waitFor()
      assert({
        given: 'customizing a described revision',
        should: 'load the unsaved two-command proposal instead of the five-command file',
        actual: [
          await page.locator('.mantine-MultiSelect-pill').allTextContents(),
          await page.getByLabel('Time', { exact: true }).inputValue(),
          await page.getByLabel('What this is for', { exact: true }).inputValue(),
          requests[1]?.[1],
        ],
        expected: [['recap:journal', 'recap:notes'], '10:20', 'The revised recap instructions.', 'morning-recaps'],
      })
      await page.getByLabel('Time', { exact: true }).fill('10:45')
      await page.getByText('Describe a change', { exact: true }).click()
      await page.getByText('Commands & conditions', { exact: true }).first().click()
      assert({
        given: 'switching editor modes',
        should: 'preserve unfinished changes',
        actual: await page.getByLabel('Time', { exact: true }).inputValue(),
        expected: '10:45',
      })
      await page.getByRole('button', { name: 'Preview automation', exact: true }).click()
      await page.getByRole('button', { name: 'Apply', exact: true }).click()
      await page.getByText('updated — file rewritten', { exact: true }).waitFor()
      const revised = Automation.fromMarkdown(files.get('morning-recaps')!, 'morning-recaps')
      assert({
        given: 'applying the customized revision',
        should: 'save its complete command list and final manual adjustment to the same file',
        actual: [revised.commands, describeTrigger(revised.trigger), revised.brief, files.size],
        expected: [
          catalog.slice(0, 2).map(({ name }) => ({ run: name, args: { day: 'today', noEditor: true } })),
          'EVERY-DAY 10:45',
          'The revised recap instructions.',
          2,
        ],
      })

      await page.goto(`${base}/automations/legacy-recap`)
      await page.getByRole('button', { name: 'Edit automation', exact: true }).click()
      await picker.fill('saved notes')
      await page.getByRole('option', { name: /^recap:notes/ }).click()
      await picker.press('Escape')
      await page.getByRole('button', { name: 'Preview automation', exact: true }).click()
      await page.getByRole('button', { name: 'Apply', exact: true }).click()
      await page.getByText('updated — file rewritten', { exact: true }).waitFor()
      const legacy = Automation.fromMarkdown(files.get('legacy-recap')!, 'legacy-recap')
      assert({
        given: 'adding a command to a legacy single-command automation',
        should: 'expand it in place, preserving its pause state, context and file count',
        actual: [
          legacy.commands.map(({ run }) => run),
          legacy.status,
          legacy.brief,
          files.get('legacy-recap')!.includes('# Keep the original note'),
          files.size,
        ],
        expected: [['recap:journal', 'recap:notes'], 'paused', 'Keep the journal recap current.', true, 2],
      })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('button', { name: 'Edit automation', exact: true }).click()
      assert({
        given: 'the saved automation at phone width',
        should: 'keep the editor in view and finish without browser errors',
        actual: [
          await page.evaluate(() => {
            const box = document.querySelector('.sky-auto-builder input[role="combobox"]')!.getBoundingClientRect()
            return document.documentElement.scrollWidth <= innerWidth && box.top >= 0 && box.top < innerHeight
          }),
          errors,
        ],
        expected: [true, []],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  },
)
