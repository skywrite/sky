import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { chromium } from 'playwright'
import Automation from '#shared/models/Automation/mod.ts'
import { setAutomationStatus } from '#shared/models/Automation/setStatus.ts'
import { describeTrigger, frameOf } from '#shared/models/Automation/trigger.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { configureAutomations, setupFromCharter, type AutomationCommand } from './automations/configure.ts'
import type { AutomationsRoutesOptions } from './automations/mod.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'

test(
  {
    name: 'describe then customize automations, command search, recap batches and editing',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 90000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-automations-e2e-'))
    const dir = path.join(root, 'automations')
    await mkdir(dir)
    const catalog: AutomationCommand[] = ['journal', 'notes'].map((name) => ({
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
    let failOnce = true
    const save = async (name: string, contents: string) => {
      Automation.fromMarkdown(contents, name)
      await writeFile(path.join(dir, `${name}.md`), contents)
      files.set(name, contents)
    }
    const host: AutomationsRoutesOptions = {
      commands: async () => catalog,
      configuration: async (name) => (files.has(name) ? setupFromCharter(name, files.get(name)!) : null),
      preview: async (setup) =>
        configureAutomations(setup, {
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
        if (name === 'recap-notes' && failOnce) {
          failOnce = false
          throw new Error('Mock write failed; retry this file.')
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
      runNow: async () => {
        throw new Error('This test must not execute commands.')
      },
      draft: async (request, revise) => {
        requests.push([request, revise])
        const name = revise ?? 'morning-brief'
        const contents = `---
# Keep the drafted context
run: recap:notes
at: ${revise ? 'EVERY-DAY 10:20' : 'EVERY-WEEKDAY 06:40'}
tz: Europe/Paris
until: 2025-11-30
args:
  day: today
  noEditor: false
status: active
created: 2025-01-01
tags: [mock]
---

${revise ? 'The revised recap instructions.' : 'Recap the notes, keeping their context.'}
`
        const automation = Automation.fromMarkdown(contents, name)
        return {
          name,
          contents,
          run: automation.run,
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
      await page.goto(`http://127.0.0.1:${address.port}/automations/new`)
      await page.getByRole('button', { name: 'Choose commands instead', exact: true }).click()
      const picker = page.getByRole('combobox', { name: 'Commands', exact: true })
      await picker.fill('saved notes')
      await page.getByRole('option', { name: /recap:notes/ }).waitFor()
      await picker.press('ArrowDown')
      await picker.press('Enter')
      await picker.press('Escape')
      assert({
        given: 'a description typed into command completion',
        should: 'select the matching installed command with the keyboard',
        actual: await page.locator('.mantine-MultiSelect-pill').allTextContents(),
        expected: ['recap:notes'],
      })
      await page.getByRole('button', { name: 'Morning recaps', exact: true }).click()
      await page.getByRole('combobox', { name: 'Repeat', exact: true }).click()
      await page.getByRole('option', { name: 'Weekdays', exact: true }).click()
      await page.getByLabel('Time', { exact: true }).fill('08:15')
      await page.getByText('More conditions', { exact: true }).click()
      await page.getByLabel('Time zone', { exact: true }).fill('Europe/Paris')
      await page.getByLabel('Last day to run', { exact: true }).fill('2025-12-31')

      const screenshots = env.get('SKY_AUTOMATIONS_SCREENSHOTS')
      if (screenshots) {
        await mkdir(screenshots, { recursive: true })
        await page.screenshot({ path: path.join(screenshots, 'desktop.png'), fullPage: true })
        await page.evaluate(() =>
          window.dispatchEvent(
            new StorageEvent('storage', {
              key: 'mantine-color-scheme-value',
              newValue: 'dark',
              storageArea: localStorage,
            }),
          ),
        )
        await page.waitForFunction(() => document.documentElement.getAttribute('data-mantine-color-scheme') === 'dark')
        await page.screenshot({ path: path.join(screenshots, 'dark.png'), fullPage: true })
        await page.evaluate(() =>
          window.dispatchEvent(
            new StorageEvent('storage', {
              key: 'mantine-color-scheme-value',
              newValue: 'light',
              storageArea: localStorage,
            }),
          ),
        )
        await page.waitForFunction(() => document.documentElement.getAttribute('data-mantine-color-scheme') === 'light')
      }
      await page.setViewportSize({ width: 390, height: 844 })
      assert({
        given: 'the command editor at phone width',
        should: 'fit without horizontal page overflow',
        actual: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        expected: true,
      })
      if (screenshots) await page.screenshot({ path: path.join(screenshots, 'mobile.png'), fullPage: true })
      await page.setViewportSize({ width: 1500, height: 1100 })
      await page.getByRole('button', { name: 'Preview automations', exact: true }).click()
      await page.getByRole('button', { name: 'Turn on 2 automations', exact: true }).waitFor()
      await page.getByLabel('Time', { exact: true }).fill('08:30')
      assert({
        given: 'a schedule edited after preview',
        should: 'remove the stale save action',
        actual: await page.getByRole('button', { name: 'Turn on 2 automations', exact: true }).count(),
        expected: 0,
      })
      await page.getByLabel('Time', { exact: true }).fill('08:15')
      await page.getByRole('button', { name: 'Preview automations', exact: true }).click()
      await page.getByRole('button', { name: 'Turn on 2 automations', exact: true }).waitFor()
      assert({
        given: 'the preview for two morning recaps',
        should: 'keep both files unwritten until turn-on',
        actual: await readdir(dir),
        expected: [],
      })
      await page.getByRole('button', { name: 'The whole file' }).first().click()
      const preview = await page.locator('pre.sky-auto-file').textContent()
      assert({
        given: 'the file preview',
        should: 'show the chosen schedule, previous day and no editor',
        actual: [
          preview?.includes('EVERY-WEEKDAY 08:15'),
          preview?.includes('day: yesterday'),
          preview?.includes('noEditor: true'),
        ],
        expected: [true, true, true],
      })
      await page.getByRole('button', { name: 'Turn on 2 automations', exact: true }).click()
      await page.getByRole('button', { name: 'Turn on 1 remaining', exact: true }).waitFor()
      assert({
        given: 'the second file failing to save',
        should: 'report the first saved file accurately',
        actual: [await readdir(dir), await page.getByRole('status').last().textContent()],
        expected: [['recap-journal.md'], '1 of 2 saved and active.'],
      })
      await page.getByRole('button', { name: 'Turn on 1 remaining', exact: true }).click()
      await page.waitForURL('**/automations/recap-journal')
      await page.getByRole('button', { name: 'Edit automation', exact: true }).click()
      await page.getByRole('button', { name: 'Browse commands', exact: true }).click()
      assert({
        given: 'Browse commands on a saved automation',
        should: 'show the catalog while keeping its current command selected',
        actual: [
          await page.getByRole('option').count(),
          await page.locator('.sky-auto-builder input[type="hidden"]').first().inputValue(),
        ],
        expected: [2, 'recap:journal'],
      })
      const command = page.getByRole('combobox', { name: 'Command', exact: true })
      await command.fill('saved notes')
      await page.getByRole('option', { name: /^recap:notes/ }).click()
      assert({
        given: 'an existing automation whose command is already selected',
        should: 'replace it directly with a matching catalog command',
        actual: await page.locator('.sky-auto-builder input[type="hidden"]').first().inputValue(),
        expected: 'recap:notes',
      })
      await command.press('Escape')
      assert({
        given: 'retrying a partial save',
        should: 'save only the remaining file',
        actual: creates,
        expected: ['recap-journal', 'recap-notes', 'recap-notes'],
      })
      const recap = Automation.fromMarkdown(await readFile(path.join(dir, 'recap-notes.md'), 'utf8'), 'recap-notes')
      assert({
        given: 'the saved recap charter',
        should: 'retain the chosen arguments and conditions',
        actual: [recap.args, describeTrigger(recap.trigger), frameOf(recap.trigger), recap.until?.ymd],
        expected: [{ day: 'yesterday', noEditor: true }, 'EVERY-WEEKDAY 08:15', 'Europe/Paris', '2025-12-31'],
      })
      await page.getByLabel('Time', { exact: true }).fill('09:45')
      await page.getByRole('button', { name: 'Preview automation', exact: true }).click()
      await page.getByRole('button', { name: 'Apply', exact: true }).click()
      await page.getByText('updated — file rewritten', { exact: true }).waitFor()
      assert({
        given: 'editing a saved automation through the same controls',
        should: 'save the replacement command and new time without changing its recap day or filename',
        actual: [
          Automation.fromMarkdown(files.get('recap-journal')!, 'recap-journal').run,
          describeTrigger(Automation.fromMarkdown(files.get('recap-journal')!, 'recap-journal').trigger),
          Automation.fromMarkdown(files.get('recap-journal')!, 'recap-journal').args,
          errors,
        ],
        expected: ['recap:notes', 'EVERY-WEEKDAY 09:45', { day: 'yesterday', noEditor: true }, []],
      })
      await page.getByLabel('Time', { exact: true }).fill('10:30')
      await page.getByRole('button', { name: 'Preview automation', exact: true }).click()
      await page.getByRole('button', { name: 'Apply', exact: true }).waitFor()
      await page.getByRole('button', { name: /^Recap notes/ }).click()
      await page.waitForURL('**/automations/recap-notes')
      await page.getByRole('button', { name: 'Preview automation', exact: true }).waitFor()
      assert({
        given: 'opening another automation after preparing an edit',
        should: 'show its own saved configuration',
        actual: [
          await page.getByLabel('Time', { exact: true }).inputValue(),
          await page.getByRole('button', { name: 'Apply', exact: true }).count(),
        ],
        expected: ['08:15', 0],
      })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('button', { name: 'Edit automation', exact: true }).click()
      assert({
        given: 'the saved automation at phone width',
        should: 'keep its edit action and command picker within the viewport',
        actual: await page.evaluate(() => {
          const edit = [...document.querySelectorAll('button')].find(
            (button) => button.textContent === 'Edit automation',
          )!
          const command = document.querySelector('.sky-auto-builder input[role="combobox"]')!
          const box = command.getBoundingClientRect()
          return [
            document.documentElement.scrollWidth <= innerWidth,
            edit.getBoundingClientRect().right <= innerWidth,
            box.top >= 0 && box.top < innerHeight,
          ]
        }),
        expected: [true, true, true],
      })

      assert({
        given: 'the direct command picker and batch creation',
        should: 'finish without asking the model to draft anything',
        actual: requests,
        expected: [],
      })
      await page.setViewportSize({ width: 1500, height: 1100 })
      await page.goto(`http://127.0.0.1:${address.port}/automations/new`)
      const describe = page.getByRole('textbox', { name: 'Every weekday at 7…', exact: true })
      assert({
        given: 'a new automation',
        should: 'start with describing it and keep the command form out of the way',
        actual: [await describe.isVisible(), await page.locator('.sky-auto-builder').count()],
        expected: [true, 0],
      })
      await describe.fill('Recap today’s notes each weekday at 06:40 in Paris, through November.')
      await describe.press('Enter')
      await page.getByRole('button', { name: 'Customize', exact: true }).click()
      await page.getByRole('button', { name: 'Preview automation', exact: true }).waitFor()
      await page.getByText('More conditions', { exact: true }).click()
      await page.getByText('recap:notes options', { exact: true }).click()
      assert({
        given: 'Customize after a described automation',
        should: 'carry over the generated settings and name without saving or loading an existing charter',
        actual: [
          await page.getByRole('combobox', { name: 'Command', exact: true }).inputValue(),
          await page.getByLabel('Time', { exact: true }).inputValue(),
          await page.getByRole('combobox', { name: 'Repeat', exact: true }).inputValue(),
          await page.getByRole('combobox', { name: 'Day to recap', exact: true }).inputValue(),
          await page.getByLabel('Time zone', { exact: true }).inputValue(),
          await page.getByLabel('Last day to run', { exact: true }).inputValue(),
          await page.getByLabel('Automation name', { exact: true }).inputValue(),
          await page.getByRole('combobox', { name: 'no-editor', exact: true }).inputValue(),
          await page.getByLabel('What this is for', { exact: true }).inputValue(),
          files.has('morning-brief'),
        ],
        expected: [
          'recap:notes',
          '06:40',
          'Weekdays',
          'Today',
          'Europe/Paris',
          '2025-11-30',
          'morning-brief',
          'No',
          'Recap the notes, keeping their context.',
          false,
        ],
      })
      await page.getByLabel('Time', { exact: true }).fill('07:20')
      assert({
        given: 'a manual change to the described proposal',
        should: 'withdraw the old save action until the updated preview is ready',
        actual: await page.getByRole('button', { name: 'Turn it on', exact: true }).count(),
        expected: 0,
      })
      await page.getByRole('combobox', { name: 'Command', exact: true }).fill('recap:journal')
      await page.getByRole('option', { name: /^recap:journal/ }).click()
      await page.getByRole('button', { name: 'Preview automation', exact: true }).click()
      await page.getByRole('button', { name: 'Turn it on', exact: true }).click()
      await page.waitForURL('**/automations/morning-brief')
      const customized = files.get('morning-brief')!
      const saved = Automation.fromMarkdown(customized, 'morning-brief')
      assert({
        given: 'saving a customized described automation',
        should: 'use the replacement and time while preserving its drafted context and filename',
        actual: [
          saved.run,
          describeTrigger(saved.trigger),
          frameOf(saved.trigger),
          saved.until?.ymd,
          saved.brief,
          customized.includes('# Keep the drafted context'),
          customized.includes('created: 2025-01-01'),
          Document.fromMarkdown(customized).yaml.tags,
          requests.length,
        ],
        expected: [
          'recap:journal',
          'EVERY-WEEKDAY 07:20',
          'Europe/Paris',
          '2025-11-30',
          'Recap the notes, keeping their context.',
          true,
          true,
          ['mock'],
          1,
        ],
      })
      await page.getByText('Describe a change', { exact: true }).click()
      const change = page.getByRole('textbox', {
        name: 'Tell sky what to change — “run at 8 instead”, “skip fridays”…',
        exact: true,
      })
      await change.fill('Use notes every day at 10:20 with revised instructions.')
      await change.press('Enter')
      await page.getByRole('button', { name: 'Customize', exact: true }).click()
      await page.getByRole('button', { name: 'Preview automation', exact: true }).waitFor()
      assert({
        given: 'customizing a described revision',
        should: 'load the unsaved proposal rather than the older settings on disk',
        actual: [
          await page.getByRole('combobox', { name: 'Command', exact: true }).inputValue(),
          await page.getByLabel('Time', { exact: true }).inputValue(),
          await page.getByLabel('What this is for', { exact: true }).inputValue(),
          requests[1]?.[1],
        ],
        expected: ['recap:notes', '10:20', 'The revised recap instructions.', 'morning-brief'],
      })
      await page.getByLabel('Time', { exact: true }).fill('10:45')
      await page.getByText('Describe a change', { exact: true }).click()
      await page.getByText('Commands & conditions', { exact: true }).first().click()
      assert({
        given: 'switching back to controls before describing another change',
        should: 'keep the unfinished manual adjustment',
        actual: await page.getByLabel('Time', { exact: true }).inputValue(),
        expected: '10:45',
      })
      await page.getByRole('button', { name: 'Preview automation', exact: true }).click()
      await page.getByRole('button', { name: 'Apply', exact: true }).click()
      await page.getByText('updated — file rewritten', { exact: true }).waitFor()
      const revised = Automation.fromMarkdown(files.get('morning-brief')!, 'morning-brief')
      assert({
        given: 'applying the customized revision',
        should: 'save both the described changes and the final manual adjustment',
        actual: [revised.run, describeTrigger(revised.trigger), revised.args, revised.brief, requests.length, errors],
        expected: [
          'recap:notes',
          'EVERY-DAY 10:45',
          { day: 'today', noEditor: false },
          'The revised recap instructions.',
          2,
          [],
        ],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  },
)
