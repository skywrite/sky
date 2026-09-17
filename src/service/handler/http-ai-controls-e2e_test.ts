import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { chromium } from 'playwright'
import { PROFILES, getAllProfiles, getRoles, type ResolvedModel } from '#shared/ai/models.ts'
import type { SkyConfig } from '#shared/config/types.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { effortLevels, presetEffort, validateEffort } from '#universal/ai/effort.ts'
import { FILE_CHAT_REPLY, fileChatHost } from './chat/filesTestHelpers.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'
import { prettyModel, ROLE_LABEL, type SettingsHost } from './settings/mod.ts'

test(
  {
    name: 'Chat tuning and preset settings work directly, persist, and fit narrow screens',
    timeout: 60000,
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-ai-controls-'))
    await mkdir(path.join(root, 'journal'))
    const config: SkyConfig = {
      version: 1,
      dir: root,
      userDataDir: path.join(root, 'data'),
      codeDir: '/Code',
      inputDir: '/Input',
      outputDir: '/Output',
      editor: undefined,
      categories: [],
      commands: { dirs: [], day: { start: [], end: [] } },
      bins: {},
      slack: {},
      web: { theme: 'light' },
      voice: {},
      experimental: {},
      ai: { models: { strong: '', fast: '', transcription: '' }, profiles: {}, roles: {} },
      server: { port: 0 },
      nbfs: { layout: 'YYYY/W##/MM-DD' },
    }
    const settings: SettingsHost = {
      load: () => ({ config, path: '/Config/config.jsonc', home: '/Home', file: null, env: {} }),
      voices: () => ({ current: 'marin', researcherCurrent: 'ash', groups: { male: ['ash'], female: ['marin'] } }),
      models: () =>
        Object.entries(getRoles(config.ai)).map(([role, profile]) => ({
          role,
          label: ROLE_LABEL[role],
          profile,
          value: '',
        })),
      builtinProfiles: () =>
        Object.entries(PROFILES).map(([name, profile]) => ({
          name,
          ...profile,
          options: profile.options as Record<string, unknown> | undefined,
        })),
      providers: () => ['anthropic', 'openai', 'ollama', 'lm-studio', 'cerebras'],
      writeProfile: async (name, profile) => {
        config.ai.profiles![name] = profile
      },
      deleteProfile: async (name) => {
        delete config.ai.profiles![name]
      },
      editors: async () => [],
      memoryNotes: async () => 0,
      about: async () => ({ version: 'test', date: null }),
      reveal: async () => {},
      write: async (key, value) => {
        if (key.startsWith('ai.roles.'))
          config.ai.roles![key.slice('ai.roles.'.length) as keyof NonNullable<SkyConfig['ai']['roles']>] = value
      },
    }
    const fixture = fileChatHost(root)
    config.ai.profiles!['custom-effort'] = {
      provider: 'lm-studio',
      model: 'sample-model',
      options: { reasoningEffort: 'none', temperature: 0.4 },
    }
    fixture.host.settings = {
      get defaultModel() {
        return getRoles(config.ai).reasoning
      },
      defaultContextTokens: 0,
      choices: () =>
        Object.entries(getAllProfiles(config.ai)).map(([name, profile]) => ({
          name,
          label: prettyModel(profile.model),
          provider: profile.provider,
          roles: [],
          contextWindow: profile.contextWindow,
          builtin: name in PROFILES,
          group: profile.model,
          effort: { default: presetEffort(profile), levels: effortLevels(profile) },
        })),
      resolve: (name, effort = 'default') => {
        const profile = getAllProfiles(config.ai)[name]
        if (!profile) throw new Error('Unknown preset')
        validateEffort(profile, effort)
        return {
          model: {} as ResolvedModel,
          profile: {
            provider: profile.provider,
            model: profile.model,
            preset: name,
            effort: effort === 'default' ? (presetEffort(profile) ?? undefined) : effort,
          },
          contextWindow: profile.contextWindow,
        }
      },
    }
    const app = createTestHttpApp([path.join(root, 'journal')], { settings, chat: fixture.host })
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing browser test address')
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath:
          env.get('SKY_BROWSER_EXECUTABLE') ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      })
      const page = await browser.newPage({ viewport: { width: 1600, height: 1150 }, deviceScaleFactor: 2 })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const origin = `http://127.0.0.1:${address.port}`
      const screenshots = env.get('SKY_AI_CONTROLS_SCREENSHOTS')
      const capture = async (name: string) => {
        if (screenshots) await page.screenshot({ path: path.join(screenshots, `${name}.png`), animations: 'disabled' })
      }
      await page.goto(`${origin}/thread/tuning`)
      const toggle = page.getByRole('button', { name: 'Chat settings', exact: true })
      await toggle.waitFor()
      const collapsed = await toggle.boundingBox()
      const inputBefore = await page.locator('.sky-composer-shell').boundingBox()
      await toggle.click()
      const expanded = await toggle.boundingBox()
      const inputAfter = await page.locator('.sky-composer-shell').boundingBox()
      const panel = await page.getByRole('region', { name: 'Chat settings', exact: true }).boundingBox()
      assert({
        given: 'opening the controls above the composer',
        should: 'expand upward while keeping the input and summary row anchored',
        actual: [
          Math.abs(inputBefore!.y - inputAfter!.y) < 1,
          Math.abs(collapsed!.y - expanded!.y) < 1,
          panel!.y + panel!.height <= expanded!.y,
          expanded!.y + expanded!.height < inputAfter!.y,
        ],
        expected: [true, true, true, true],
      })
      const effort = page.getByRole('radiogroup', { name: 'Effort', exact: true })
      const from = await effort.getByRole('radio', { name: 'X-high', exact: true }).boundingBox()
      const to = await effort.getByRole('radio', { name: 'Medium', exact: true }).boundingBox()
      await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
      await page.mouse.down()
      await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 8 })
      await page.mouse.up()
      await page.waitForFunction(() =>
        document.querySelector('[aria-label="Chat settings"]')?.textContent?.includes('Medium effort'),
      )
      const contextSlider = page.getByRole('slider', { name: 'Notebook context', exact: true })
      await contextSlider.focus()
      await contextSlider.press('ArrowRight')
      await page.waitForFunction(() =>
        document.querySelector('[aria-label="Chat settings"]')?.textContent?.includes('25k context'),
      )
      const temporary = page.getByRole('switch', { name: 'Temporary chat' })
      await temporary.click()
      await page.waitForFunction(() => document.querySelector('.sky-main')?.getAttribute('data-temporary') === 'true')
      assert({
        given: 'changes inside chat settings',
        should: 'keep the panel open while adjusting controls',
        actual: await toggle.getAttribute('aria-expanded'),
        expected: 'true',
      })
      await page.getByRole('textbox', { name: 'Message sky…', exact: true }).click()
      await page.getByRole('textbox', { name: 'Message sky…', exact: true }).fill('Review the sample proposal.')
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      await page.getByText(FILE_CHAT_REPLY, { exact: true }).waitFor()
      const temporaryPosition = await temporary.boundingBox()
      await temporary.click()
      await page.getByRole('button', { name: 'Save & close', exact: true }).waitFor()
      const savedPosition = await temporary.boundingBox()
      assert({
        given: 'direct effort dragging and the Temporary switch',
        should: 'keep alignment, apply effort, and collapse the panel when writing a message',
        actual: [
          Math.abs(collapsed!.x + collapsed!.width / 2 - expanded!.x - expanded!.width / 2) < 1,
          Math.abs(temporaryPosition!.x - savedPosition!.x) < 1,
          fixture.sessions.get('tuning')!.modelProfile.effort,
          await toggle.getAttribute('aria-expanded'),
        ],
        expected: [true, true, 'medium', 'false'],
      })
      await temporary.click()
      await page.waitForFunction(() => document.querySelector('.sky-main')?.getAttribute('data-temporary') === 'true')
      await toggle.click()
      await capture('chat-expanded')
      await toggle.click()
      await capture('chat-collapsed')
      await page.reload()
      await toggle.waitFor()
      assert({
        given: 'a page reload',
        should: 'retain the chat effort and Temporary state',
        actual: [(await toggle.textContent())?.includes('Medium effort'), await temporary.getAttribute('aria-checked')],
        expected: [true, 'true'],
      })
      await page.goto(`${origin}/settings/ai/models`)
      await capture('settings-before-interaction')
      const thinking = page.getByRole('combobox', { name: 'Default preset for Thinking', exact: true })
      await thinking.click()
      await page.getByRole('option', { name: 'default-sonnet-5', exact: true }).click()
      const roleEffort = page.getByRole('radiogroup', { name: 'Default effort for Thinking', exact: true })
      await roleEffort.getByRole('radio', { name: 'Low', exact: true }).click()
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="Default effort for Balanced"] [aria-checked="true"]')?.textContent ===
          'Low',
      )
      assert({
        given: 'Thinking reassigned to the preset already used by Balanced and Vision',
        should: 'save the assignment and show the shared effort change in every role',
        actual: [
          config.ai.roles?.reasoning,
          config.ai.profiles?.['default-sonnet-5']?.options?.effort,
          await page
            .getByRole('radiogroup', { name: 'Default effort for Vision' })
            .getByRole('radio', { name: 'Low', exact: true })
            .getAttribute('aria-checked'),
        ],
        expected: ['default-sonnet-5', 'low', 'true'],
      })
      await capture('settings-defaults')
      await page.locator('.sky-preset-toggle').filter({ hasText: 'custom-effort' }).click()
      await page.getByRole('button', { name: 'Save preset', exact: true }).click()
      await page.locator('.sky-preset-editor').waitFor({ state: 'hidden' })
      assert({
        given: 'an existing custom provider effort edited in Settings',
        should: 'keep its raw provider options',
        actual: config.ai.profiles?.['custom-effort']?.options,
        expected: { reasoningEffort: 'none', temperature: 0.4 },
      })
      await page.getByRole('button', { name: '＋ New preset', exact: true }).click()
      await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('deep-work')
      await page.getByRole('combobox', { name: 'Preset model', exact: true }).click()
      await page.getByRole('option', { name: 'Claude Opus 5 · anthropic', exact: true }).click()
      await page
        .getByRole('radiogroup', { name: 'Effort', exact: true })
        .getByRole('radio', { name: 'Max', exact: true })
        .click()
      await page.getByRole('button', { name: 'Save preset', exact: true }).click()
      await page.locator('.sky-preset-toggle').filter({ hasText: 'deep-work' }).waitFor()
      assert({
        given: 'a new named preset created with separate model and effort controls',
        should: 'save its model and default effort',
        actual: [config.ai.profiles?.['deep-work']?.model, config.ai.profiles?.['deep-work']?.options?.effort],
        expected: ['claude-opus-5', 'max'],
      })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('heading', { name: 'Models', exact: true }).scrollIntoViewIfNeeded()
      await capture('settings-mobile')
      assert({
        given: 'Settings on a narrow screen',
        should: 'fit without horizontal overflow',
        actual: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        expected: false,
      })
      await page.goto(`${origin}/thread/tuning`)
      await toggle.click()
      const mobileTemporary = await temporary.boundingBox()
      const mobileClose = await page.getByRole('button', { name: 'Discard', exact: true }).boundingBox()
      await capture('chat-mobile')
      assert({
        given: 'the phone header',
        should: 'keep Temporary beside the close action',
        actual:
          Math.abs(mobileTemporary!.y + mobileTemporary!.height / 2 - mobileClose!.y - mobileClose!.height / 2) < 2,
        expected: true,
      })
      assert({
        given: 'the expanded chat on a narrow screen',
        should: 'fit without overflow or browser errors',
        actual: [await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), errors],
        expected: [false, []],
      })
      config.ai.profiles!['default-opus-5'] = { provider: 'anthropic', model: 'claude-haiku-4-5' }
      await page.reload()
      await toggle.click()
      await page.getByRole('button', { name: 'Use preset default', exact: true }).click()
      await page.waitForFunction(() =>
        document.querySelector('[aria-label="Chat settings"]')?.textContent?.includes('Default effort'),
      )
      assert({
        given: 'a preset changed to a model without adjustable effort',
        should: 'let an existing chat clear its older effort override',
        actual: (await (await page.request.get(`${origin}/chat/tuning/settings`)).json()).effort,
        expected: 'default',
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
