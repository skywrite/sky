import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'
import { createAboutMeRoutes } from './settings/aboutMe.ts'
import { createAboutMeHost } from './settings/createAboutMeHost.ts'
import type { SettingsData } from './settings/mod.ts'

test(
  {
    name: 'Settings groups, profile learning, saved drafts, and legacy links work on desktop and mobile',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-settings-browser-'))
    await mkdir(path.join(root, 'journal'))
    const host = createAboutMeHost(
      { DIR_BASE: root, DIR_STATE: path.join(root, '.state') },
      {
        readPage: async () => 'Jane Doe leads Atlas.',
        summarize: async (input) => ({
          name: input.name,
          text: `${input.text}\n\nI lead [Atlas](https://example.com/about).`,
          questions: ['What would you like to focus on next?'],
        }),
      },
    )
    const settings: SettingsData = {
      theme: 'light',
      experimental: { contextPreflight: false },
      textSize: 'default',
      voice: { current: 'marin', researcherCurrent: 'ash', groups: { male: ['ash'], female: ['marin'] } },
      models: [{ role: 'reasoning', label: 'Thinking', value: 'Sample model', profile: 'sample' }],
      profiles: [{ name: 'sample', provider: 'ollama', model: 'sample-model', builtin: true, roles: ['Thinking'] }],
      writingVoice: { profile: 'sample', choices: [{ value: 'sample', label: 'Sample model' }] },
      providers: ['ollama'],
      memoryNotes: 2,
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
    app.route('/settings/_api/about-me', createAboutMeRoutes(host))
    app.get('/settings/_api/settings', (c) => c.json(settings))
    app.post('/settings/_api/set', async (c) => {
      const input = await c.req.json()
      if (input.key === 'web.theme') settings.theme = input.value
      if (input.key === 'web.textSize') settings.textSize = input.value
      return c.json({ ok: true })
    })
    app.get('/settings/_api/writing-voice', (c) =>
      c.json({
        rules: { text: 'Use clear language.', revision: 'rules', compacted: [] },
        examples: [],
        compacting: false,
        compactionError: null,
      }),
    )
    app.get('/settings/_api/connections', (c) =>
      c.json({ google: { client: false, accounts: [], setup: [] }, secrets: [] }),
    )
    app.get('/settings/_api/connections/slack', (c) => c.json({ installed: false }))
    app.get('/settings/_api/prompts/list', (c) => c.json({ prompts: [] }))
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
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const base = `http://127.0.0.1:${address.port}`
      const nav = page.locator('.sky-settings-nav')
      const screenshots = env.get('SKY_SETTINGS_SCREENSHOTS')
      const capture = async (name: string) => {
        if (screenshots) await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true })
      }
      await page.goto(`${base}/settings`)
      await page.getByRole('heading', { name: 'Appearance', exact: true }).waitFor()
      await nav.getByRole('button', { name: 'Me', exact: true }).click()
      await page.getByLabel('Your name', { exact: true }).fill('Jane Doe')
      await page.getByLabel('About you', { exact: true }).fill('I build tools for small teams.')
      await nav.getByRole('button', { name: 'Models', exact: true }).click()
      await page.getByRole('heading', { name: 'Models', exact: true }).waitFor()
      assert({
        given: 'the Models page',
        should: 'show the selected child and keep configuration details tucked away',
        actual: [
          await nav.locator('[aria-current="page"]').innerText(),
          await page.getByText('sample-model', { exact: false }).count(),
        ],
        expected: ['Models', 0],
      })
      await page.locator('.sky-preset-toggle').filter({ hasText: 'sample' }).click()
      await page.getByRole('combobox', { name: 'Preset model', exact: true }).waitFor()
      await capture('models-light')
      await nav.getByRole('button', { name: 'Collapse Me', exact: true }).click()
      assert({
        given: 'a collapsed group',
        should: 'hide its children independently',
        actual: await nav.getByRole('button', { name: 'About me', exact: true }).isVisible(),
        expected: false,
      })
      await nav.getByRole('button', { name: 'Me', exact: true }).click()
      assert({
        given: 'a return to About me',
        should: 'keep the unsaved profile draft',
        actual: await page.getByLabel('About you', { exact: true }).inputValue(),
        expected: 'I build tools for small teams.',
      })
      await page.getByLabel('Profile link 1', { exact: true }).fill('https://example.com/about')
      await page.getByRole('button', { name: 'Learn about me', exact: true }).click()
      await page.getByLabel('Suggested profile', { exact: true }).waitFor()
      assert({
        given: 'a suggested profile',
        should: 'wait for the user to save it',
        actual: (await host.read()).text,
        expected: '',
      })
      await nav.getByRole('button', { name: 'Models', exact: true }).click()
      await nav.getByRole('button', { name: 'About me', exact: true }).click()
      await page.getByLabel('Suggested profile', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Use this profile', exact: true }).click()
      await page.getByRole('button', { name: 'Save about me', exact: true }).click()
      await page.getByText('Saved. Sky will use this context in new conversations.', { exact: true }).waitFor()
      await page.reload()
      await page.getByLabel('Your name', { exact: true }).waitFor()
      assert({
        given: 'a saved profile after reload',
        should: 'retain the profile and source link',
        actual: [
          await page.getByLabel('About you', { exact: true }).inputValue(),
          await page.getByLabel('Profile link 1', { exact: true }).inputValue(),
        ],
        expected: [
          'I build tools for small teams.\n\nI lead [Atlas](https://example.com/about).',
          'https://example.com/about',
        ],
      })
      await capture('about-me-light')
      await page.getByLabel('Profile link 1', { exact: true }).scrollIntoViewIfNeeded()
      await capture('about-me-links-light')
      await page.getByLabel('About you', { exact: true }).fill('My unsaved local edit.')
      const saved = await host.read()
      await host.save({ ...saved, text: 'An edit from the notebook.' })
      await page.getByRole('button', { name: 'Save about me', exact: true }).click()
      await page.getByRole('button', { name: 'Load saved profile', exact: true }).waitFor()
      assert({
        given: 'a concurrent edit',
        should: 'keep both the local draft and the newer notebook content',
        actual: [await page.getByLabel('About you', { exact: true }).inputValue(), (await host.read()).text],
        expected: ['My unsaved local edit.', 'An edit from the notebook.'],
      })
      await page.getByRole('button', { name: 'Load saved profile', exact: true }).click()
      await page.getByRole('button', { name: 'Save about me', exact: true }).waitFor({ state: 'visible' })
      for (const [route, title] of [
        ['/settings/writing-voice', 'Writing style'],
        ['/settings/ai', 'Models'],
        ['/settings/voice', 'Voice'],
        ['/settings/prompts', 'Prompts'],
        ['/settings/connections', 'Connections'],
        ['/settings/notebook', 'Notebook'],
        ['/settings/advanced', 'Advanced'],
        ['/settings/experimental', 'Experimental'],
        ['/settings/about', 'About Sky'],
      ]) {
        await page.goto(`${base}${route}`)
        await page.getByRole('heading', { name: title, exact: true }).waitFor()
      }
      settings.theme = 'dark'
      await page.goto(`${base}/settings/me/writing-style`)
      await page.getByLabel('Your writing rules', { exact: true }).waitFor()
      await capture('writing-style-dark')
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`${base}/settings/me`)
      await page.getByLabel('Your name', { exact: true }).waitFor()
      await capture('about-me-mobile-dark')
      await page.getByLabel('Profile link 1', { exact: true }).scrollIntoViewIfNeeded()
      await capture('about-me-links-mobile-dark')
      await page.getByRole('button', { name: 'Navigation', exact: true }).click()
      await nav.getByRole('button', { name: 'Voice', exact: true }).click()
      await page.getByRole('heading', { name: 'Voice', exact: true }).waitFor()
      assert({
        given: 'a phone-sized settings page',
        should: 'navigate through the existing drawer without overflow or browser errors',
        actual: [
          await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
          await page.getByRole('button', { name: 'Navigation', exact: true }).isVisible(),
          errors,
        ],
        expected: [false, true, []],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
