import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import { TRANSCRIPTION_MODELS, type MacWhisperModels } from '#commands/all/audio/transcript/lib/models.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'
import { createAboutMeRoutes } from './settings/aboutMe.ts'
import { createAboutMeHost } from './settings/createAboutMeHost.ts'
import type { SettingsData } from './settings/mod.ts'

test(
  {
    name: 'Settings groups, profile learning, saved drafts, experimental navigation, and legacy links work on desktop and mobile',
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
      transcription: {
        value: 'openai/gpt-transcribe',
        choices: TRANSCRIPTION_MODELS.map((model) => ({ ...model, configured: model.provider === 'openai' })),
      },
      calendar: { classifyEvents: false },
      theme: 'light',
      experimental: { contextPreflight: false, workstreams: false },
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
    let refuseTranscriptionSave = false
    let refuseWorkstreamSave = false
    let persistBeforeRefusal = false
    let modelRequests = 0
    let localModels: MacWhisperModels = {
      available: true,
      models: [
        { id: 'whisperkit:sample-small', name: 'Sample Small', size: '100 MB', current: true },
        { id: 'whisper-cpp:sample-large', name: 'Sample Large', size: '1.5 GB', current: false },
      ],
      error: null,
    }
    app.get('/settings/_api/transcription/macwhisper', (c) => {
      modelRequests++
      return c.json(localModels)
    })
    app.route('/settings/_api/about-me', createAboutMeRoutes(host))
    app.get('/settings/_api/settings', (c) => c.json(settings))
    app.post('/settings/_api/set', async (c) => {
      const input = await c.req.json()
      if (input.key === 'ai.models.transcription') {
        if (refuseTranscriptionSave) return c.json({ message: 'This setting could not be saved.' }, 503)
        settings.transcription.value = input.value
      }
      if (input.key === 'web.theme') settings.theme = input.value
      if (input.key === 'web.textSize') settings.textSize = input.value
      if (input.key === 'experimental.workstreams') {
        if (persistBeforeRefusal) settings.experimental.workstreams = input.value === true || input.value === 'true'
        if (refuseWorkstreamSave) return c.json({ message: 'This setting could not be saved.' }, 503)
        settings.experimental.workstreams = input.value === true || input.value === 'true'
      }
      return c.json({ ok: true })
    })
    app.get('/settings/_api/writing-voice', (c) =>
      c.json({
        rules: { text: 'Use clear language.', revision: 'rules', folding: [] },
        edits: [],
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
      const sidebar = page.locator('.sky-side')
      const workstreams = sidebar.getByRole('button', { name: 'Workstreams', exact: true })
      const returnToday = () =>
        page.locator('.sky-main > .sky-head').getByRole('button', { name: '‹ Today', exact: true }).click()
      const setWorkstreams = async (enabled: boolean) => {
        const saved = page.waitForResponse(
          (response) =>
            response.url().endsWith('/settings/_api/set') &&
            response.request().method() === 'POST' &&
            response.request().postDataJSON().key === 'experimental.workstreams',
        )
        await page
          .locator('[aria-label="Workstreams"]')
          .getByText(enabled ? 'On' : 'Off', { exact: true })
          .click()
        return (await saved).status()
      }
      const screenshots = env.get('SKY_SETTINGS_SCREENSHOTS')
      const capture = async (name: string) => {
        if (screenshots)
          await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true, animations: 'disabled' })
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
      await nav.getByRole('button', { name: 'Audio transcription', exact: true }).click()
      const transcription = page.getByRole('combobox', { name: 'Transcription provider', exact: true })
      await transcription.click()
      await page.getByRole('option', { name: 'Mistral', exact: true }).click()
      await page.getByText('Saved. New transcriptions will use this provider.', { exact: true }).waitFor()
      await nav.getByRole('button', { name: 'Models', exact: true }).click()
      await nav.getByRole('button', { name: 'Audio transcription', exact: true }).click()
      await page.getByText('voxtral-mini-latest', { exact: true }).waitFor()
      assert({
        given: 'Mistral is selected and the page is revisited',
        should: 'retain the provider and explain its limit and missing key',
        actual: [
          await transcription.inputValue(),
          await page.getByText('500 MB per file', { exact: true }).isVisible(),
          await page.getByText('Not configured', { exact: true }).isVisible(),
        ],
        expected: ['Mistral', true, true],
      })
      await capture('transcription-desktop')
      assert({
        given: 'a cloud provider is selected',
        should: 'leave MacWhisper discovery idle',
        actual: modelRequests,
        expected: 0,
      })
      await transcription.click()
      await page.getByRole('option', { name: 'MacWhisper (local)', exact: true }).click()
      const localModel = page.getByRole('combobox', { name: 'MacWhisper model', exact: true })
      await page.waitForFunction(
        () => !(document.querySelector('[aria-label="MacWhisper model"]') as HTMLInputElement)?.disabled,
      )
      await localModel.click()
      await page.getByRole('option', { name: 'Sample Large · 1.5 GB', exact: true }).click()
      await page.waitForFunction(
        () =>
          (document.querySelector('[aria-label="MacWhisper model"]') as HTMLInputElement)?.value ===
          'Sample Large · 1.5 GB',
      )
      await nav.getByRole('button', { name: 'Models', exact: true }).click()
      await nav.getByRole('button', { name: 'Audio transcription', exact: true }).click()
      await page.waitForFunction(
        () =>
          (document.querySelector('[aria-label="MacWhisper model"]') as HTMLInputElement)?.value ===
          'Sample Large · 1.5 GB',
      )
      assert({
        given: 'MacWhisper is selected and an installed model is chosen',
        should: 'retain the model when revisited, remove the cloud cap and hide API key setup',
        actual: [
          settings.transcription.value,
          await transcription.inputValue(),
          await page.getByText('No provider upload limit', { exact: true }).isVisible(),
          await page.getByText('API access', { exact: true }).count(),
        ],
        expected: ['macwhisper/whisper-cpp:sample-large', 'MacWhisper (local)', true, 0],
      })
      await capture('macwhisper-desktop')
      await page.setViewportSize({ width: 390, height: 844 })
      await page.waitForFunction(() => document.querySelector('.sky-side')!.getBoundingClientRect().right <= 0)
      assert({
        given: 'MacWhisper settings on a phone',
        should: 'keep the model picker and explanatory text within the viewport',
        actual: await page
          .locator('.sky-set .sky-set-sub, .sky-set .sky-set-note, [aria-label="MacWhisper model"]')
          .evaluateAll((elements) => elements.every((element) => element.getBoundingClientRect().right <= innerWidth)),
        expected: true,
      })
      await capture('macwhisper-mobile')
      await page.setViewportSize({ width: 1440, height: 1100 })
      const installed = localModels
      localModels = { available: true, models: [], error: null }
      await page.getByRole('button', { name: 'Refresh models', exact: true }).click()
      await page
        .getByText('Download a local transcription model in MacWhisper, then refresh the models here.', { exact: true })
        .waitFor()
      assert({
        given: 'the saved model has been removed',
        should: 'disable an empty picker and explain the missing model',
        actual: [
          await localModel.isDisabled(),
          await page.getByText('The saved model is no longer installed.', { exact: false }).isVisible(),
        ],
        expected: [true, true],
      })
      localModels = { available: false, models: [], error: 'Open MacWhisper and try again.' }
      await page.getByRole('button', { name: 'Refresh models', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'Open MacWhisper and try again.' }).waitFor()
      localModels = installed
      await page.getByRole('button', { name: 'Refresh models', exact: true }).click()
      await page.waitForFunction(
        () => !(document.querySelector('[aria-label="MacWhisper model"]') as HTMLInputElement)?.disabled,
      )
      await transcription.click()
      await page.getByRole('option', { name: 'Mistral', exact: true }).click()
      await page.getByText('voxtral-mini-latest', { exact: true }).waitFor()
      refuseTranscriptionSave = true
      await transcription.click()
      await page.getByRole('option', { name: 'OpenAI', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'This setting could not be saved.' }).waitFor()
      assert({
        given: 'a refused provider save',
        should: 'retain the saved provider',
        actual: await transcription.inputValue(),
        expected: 'Mistral',
      })
      refuseTranscriptionSave = false
      await page.setViewportSize({ width: 390, height: 844 })
      await page.waitForFunction(() => document.querySelector('.sky-side')!.getBoundingClientRect().right <= 0)
      await capture('transcription-mobile')
      assert({
        given: 'the transcription page on a phone',
        should: 'fit without horizontal scrolling',
        actual: await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        expected: true,
      })
      await page.setViewportSize({ width: 1440, height: 1100 })
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
        ['/settings/ai/transcription', 'Audio transcription'],
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
      await returnToday()
      assert({
        given: 'the ordinary sidebar with experimental Workstreams off by default',
        should: 'omit the Workstreams entry',
        actual: await workstreams.count(),
        expected: 0,
      })
      await sidebar.getByRole('link', { name: 'Settings', exact: true }).click()
      await nav.getByRole('button', { name: 'Experimental', exact: true }).click()
      await page
        .getByText('Show Workstreams in the sidebar to organize ongoing work with Sky.', { exact: true })
        .waitFor()
      await page.evaluate(() => {
        document.documentElement.dataset.settingsSession = 'same-document'
      })
      const enabled = await setWorkstreams(true)
      await capture('experimental-workstreams-desktop')
      await returnToday()
      await workstreams.waitFor({ state: 'visible' })
      assert({
        given: 'Workstreams is enabled from Settings and the owner returns to Today',
        should: 'show the sidebar entry immediately without a document reload',
        actual: [
          enabled,
          settings.experimental.workstreams,
          await page.locator('html').getAttribute('data-settings-session'),
        ],
        expected: [200, true, 'same-document'],
      })
      await page.reload()
      await workstreams.waitFor({ state: 'visible' })
      assert({
        given: 'a reload after enabling Workstreams',
        should: 'restore the saved sidebar preference',
        actual: [await workstreams.count(), settings.experimental.workstreams],
        expected: [1, true],
      })
      await sidebar.getByRole('link', { name: 'Settings', exact: true }).click()
      await nav.getByRole('button', { name: 'Experimental', exact: true }).click()
      refuseWorkstreamSave = true
      const refused = await setWorkstreams(false)
      await page.waitForFunction(
        () => document.querySelector<HTMLInputElement>('[aria-label="Workstreams"] input[value="on"]')?.checked,
      )
      await returnToday()
      await workstreams.waitFor({ state: 'visible' })
      assert({
        given: 'the service refuses a Workstreams setting change',
        should: 'restore the switch and keep the previously saved sidebar entry',
        actual: [refused, settings.experimental.workstreams, await workstreams.count()],
        expected: [503, true, 1],
      })
      refuseWorkstreamSave = false
      await sidebar.getByRole('link', { name: 'Settings', exact: true }).click()
      await nav.getByRole('button', { name: 'Experimental', exact: true }).click()
      await setWorkstreams(false)
      await returnToday()
      await workstreams.waitFor({ state: 'detached' })
      assert({
        given: 'Workstreams is switched off again',
        should: 'remove only its optional sidebar entry',
        actual: [
          settings.experimental.workstreams,
          await workstreams.count(),
          await sidebar.getByRole('button', { name: 'Today', exact: true }).isVisible(),
        ],
        expected: [false, 0, true],
      })
      await sidebar.getByRole('link', { name: 'Settings', exact: true }).click()
      await nav.getByRole('button', { name: 'Experimental', exact: true }).click()
      refuseWorkstreamSave = true
      persistBeforeRefusal = true
      const lostResponse = await setWorkstreams(true)
      await page.waitForFunction(
        () => document.querySelector<HTMLInputElement>('[aria-label="Workstreams"] input[value="on"]')?.checked,
      )
      await returnToday()
      await workstreams.waitFor({ state: 'visible' })
      assert({
        given: 'the service saves Workstreams but its success response is lost',
        should: 'recover the saved value and update the sidebar from the settings reload',
        actual: [lostResponse, settings.experimental.workstreams, await workstreams.count()],
        expected: [503, true, 1],
      })
      refuseWorkstreamSave = false
      persistBeforeRefusal = false
      await sidebar.getByRole('link', { name: 'Settings', exact: true }).click()
      await nav.getByRole('button', { name: 'Experimental', exact: true }).click()
      await setWorkstreams(false)
      await returnToday()
      await workstreams.waitFor({ state: 'detached' })
      settings.theme = 'dark'
      await page.goto(`${base}/settings/me/writing-style`)
      await page.getByLabel('Your writing rules', { exact: true }).waitFor()
      await capture('writing-style-dark')
      await page.goto(`${base}/settings/ai/transcription`)
      await page.getByText('voxtral-mini-latest', { exact: true }).waitFor()
      assert({
        given: 'a fresh page load',
        should: 'load the saved transcription provider',
        actual: await transcription.inputValue(),
        expected: 'Mistral',
      })
      await capture('transcription-dark')
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
      await returnToday()
      await page.getByRole('button', { name: 'Navigation', exact: true }).click()
      assert({
        given: 'the mobile navigation drawer with Workstreams off',
        should: 'use the same saved visibility preference',
        actual: await workstreams.count(),
        expected: 0,
      })
      await sidebar.getByRole('link', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Navigation', exact: true }).click()
      await nav.getByRole('button', { name: 'Experimental', exact: true }).click()
      await setWorkstreams(true)
      await capture('experimental-workstreams-mobile')
      await returnToday()
      await page.getByRole('button', { name: 'Navigation', exact: true }).click()
      await workstreams.waitFor({ state: 'visible' })
      assert({
        given: 'Workstreams is enabled from mobile Settings',
        should: 'show one usable entry in the navigation drawer',
        actual: [await workstreams.count(), await workstreams.isVisible()],
        expected: [1, true],
      })
      await sidebar.getByRole('link', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Navigation', exact: true }).click()
      await nav.getByRole('button', { name: 'Experimental', exact: true }).click()
      await setWorkstreams(false)
      await returnToday()
      await page.getByRole('button', { name: 'Navigation', exact: true }).click()
      assert({
        given: 'Workstreams is disabled again on mobile',
        should: 'hide the entry without overflow or browser errors',
        actual: [
          await workstreams.count(),
          settings.experimental.workstreams,
          await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
          errors,
        ],
        expected: [0, false, false, []],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
