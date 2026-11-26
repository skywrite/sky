import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { chromium } from 'playwright'
import { PROFILES, getAllProfiles, getRoles, type ResolvedModel } from '#shared/ai/models.ts'
import type { SkyConfig } from '#shared/config/types.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { effectiveEffort, effortLevels, validateEffort } from '#universal/ai/effort.ts'
import { prettyModel } from '#universal/ai/modelName.ts'
import { FILE_CHAT_REPLY, fileChatHost } from './chat/filesTestHelpers.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'
import { ROLE_LABEL, type SettingsHost } from './settings/mod.ts'

test(
  {
    name: 'Chat model settings lock after sending, including branches, and fit narrow screens',
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
      commands: { dirs: [], day: { start: [] } },
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
      voices: () => ({ current: 'marin', groups: { male: ['ash'], female: ['marin'] } }),
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
      providers: () => ['anthropic', 'openai', 'gemini', 'ollama', 'lm-studio', 'cerebras'],
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
      write: async (key, value, rolePreset) => {
        if (key.startsWith('ai.roles.'))
          config.ai.roles![key.slice('ai.roles.'.length) as keyof NonNullable<SkyConfig['ai']['roles']>] = value
        if (rolePreset) config.ai.profiles![value] = rolePreset
      },
      writeAccountCategory: async () => {},
    }
    const fixture = fileChatHost(root)
    // The reply's one model request read 212,000 tokens and wrote 400.
    fixture.steps.push({
      usage: {
        inputTokens: 212_000,
        outputTokens: 400,
        totalTokens: 212_400,
        inputTokenDetails: { noCacheTokens: 12_000, cacheReadTokens: 200_000, cacheWriteTokens: 0 },
        outputTokenDetails: { textTokens: 400, reasoningTokens: 0 },
      },
    })
    config.ai.profiles!['custom-effort'] = {
      provider: 'lm-studio',
      model: 'sample-model',
      options: { reasoningEffort: 'none', temperature: 0.4 },
    }
    fixture.host.settings = {
      get defaultModel() {
        return getRoles(config.ai).reasoning
      },
      readingBudget: () => 0,
      choices: () =>
        Object.entries(getAllProfiles(config.ai)).map(([name, profile]) => ({
          name,
          label: prettyModel(profile.model),
          provider: profile.provider,
          roles: [],
          contextWindow: profile.contextWindow,
          builtin: name in PROFILES,
          group: profile.model,
          effort: { default: effectiveEffort(profile), levels: effortLevels(profile) },
        })),
      resolve: (name, effort = 'default', fixed) => {
        const profile = fixed ?? getAllProfiles(config.ai)[name]
        if (!profile) throw new Error('Unknown preset')
        validateEffort(profile, effort)
        return {
          config: structuredClone(profile),
          model: {} as ResolvedModel,
          profile: {
            provider: profile.provider,
            model: profile.model,
            preset: name,
            effort: effort === 'default' ? (effectiveEffort(profile) ?? undefined) : effort,
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
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
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
      assert({
        given: 'an empty draft',
        should: 'allow model selection and explain when settings become fixed',
        actual: [
          await page.getByRole('combobox', { name: 'Model', exact: true }).isEnabled(),
          await page
            .getByText('These settings become fixed after your first message, including in branches.')
            .isVisible(),
        ],
        expected: [true, true],
      })
      const from = await effort.getByRole('radio', { name: 'X-high', exact: true }).boundingBox()
      const to = await effort.getByRole('radio', { name: 'Medium', exact: true }).boundingBox()
      await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
      await page.mouse.down()
      await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 8 })
      await page.mouse.up()
      await page.waitForFunction(() =>
        document.querySelector('[aria-label="Chat settings"]')?.textContent?.includes('Medium effort'),
      )
      const meter = page.getByRole('meter', { name: 'Context in use', exact: true })
      assert({
        given: 'chat settings before the first message, on a model that holds a million tokens',
        should: 'offer no context control, and show nothing held yet against all the model can hold',
        actual: [
          await page.getByRole('slider').count(),
          await meter.getAttribute('aria-valuenow'),
          await meter.getAttribute('aria-valuemax'),
          (await toggle.textContent())?.includes('0 of 1M context'),
        ],
        expected: [0, '0', '1000000', true],
      })
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
      const checkLocked = async (given: string) => {
        assert({
          given,
          should: 'keep model and effort visible but fixed, with a clear explanation, and show what the chat holds',
          actual: [
            await page.getByRole('combobox', { name: 'Model', exact: true }).isDisabled(),
            await effort.getByRole('radio', { name: 'Medium', exact: true }).isDisabled(),
            await page
              .getByText('Model and effort are fixed for this chat and its branches. Start a new chat to change them.')
              .isVisible(),
            (await toggle.textContent())?.includes('Medium effort'),
            (await toggle.textContent())?.includes('212k of 1M context'),
            await meter.getAttribute('aria-valuenow'),
          ],
          expected: [true, true, true, true, true, '212400'],
        })
      }
      await checkLocked('a chat after its first reply')
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
      await toggle.click()
      await checkLocked('the same chat after reloading')
      assert({
        given: 'the chat settings opened after reloading',
        should: 'preserve the conversation title in the browser tab',
        actual: (await page.title()).includes('Review the sample proposal'),
        expected: true,
      })
      const source = await (await page.request.get(`${origin}/chat/tuning`)).json()
      const branch = await (
        await page.request.post(`${origin}/chat/tuning/branch`, { data: source.branchPoints[1] })
      ).json()
      await page.goto(`${origin}/thread/${branch.id}`)
      await toggle.click()
      await checkLocked('a branch before its first new message')
      // Unsent drafts still support the complete model and effort picker.
      await page.goto(`${origin}/thread/draft-tuning`)
      await toggle.click()
      for (const [model, defaultEffort] of [
        ['GPT 6.1 Sol', 'High'],
        ['Claude Sonnet 5.5', 'High'],
      ]) {
        await page.getByRole('combobox', { name: 'Model', exact: true }).click()
        await page.getByRole('option', { name: model, exact: true }).click()
        await page.waitForFunction(
          (level) => document.querySelector('.sky-chat-effort-field [aria-checked="true"]')?.textContent === level,
          defaultEffort,
        )
        assert({
          given: `selecting ${model} without an effort override`,
          should: 'select its effective preset default while keeping the chat on inherited effort',
          actual: [
            await effort.getByRole('radio', { name: defaultEffort, exact: true }).getAttribute('aria-checked'),
            (await toggle.textContent())?.includes(`${defaultEffort} effort`),
            (await (await page.request.get(`${origin}/chat/draft-tuning/settings`)).json()).effort,
          ],
          expected: ['true', true, 'default'],
        })
        await effort.getByRole('radio', { name: 'Low', exact: true }).click()
        await page.getByRole('button', { name: 'Use preset default', exact: true }).click()
        await page.waitForFunction(
          (level) => document.querySelector('.sky-chat-effort-field [aria-checked="true"]')?.textContent === level,
          defaultEffort,
        )
        await page.reload()
        await toggle.click()
        assert({
          given: `clearing ${model}'s override and reloading`,
          should: 'restore the highlighted preset default',
          actual: await effort.getByRole('radio', { name: defaultEffort, exact: true }).getAttribute('aria-checked'),
          expected: 'true',
        })
      }
      await page.getByRole('combobox', { name: 'Model', exact: true }).click()
      await page.getByRole('option', { name: 'Claude Opus 5.5', exact: true }).click()
      await effort.getByRole('radio', { name: 'Medium', exact: true }).click()
      await page.waitForFunction(() =>
        document.querySelector('[aria-label="Chat settings"]')?.textContent?.includes('Medium effort'),
      )
      await page.goto(`${origin}/settings/ai/models`)
      await capture('settings-before-interaction')
      const openRole = (label: string) =>
        page.getByRole('link', { name: `Change preset for ${label}`, exact: true }).click()
      const openLibrary = () => page.getByRole('link', { name: 'Preset library', exact: true }).click()
      const openAssignments = () => page.getByRole('link', { name: 'Assignments', exact: true }).click()
      const dialog = page.getByRole('dialog')
      const cancel = () => dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.getByRole('link', { name: 'Change preset', exact: true }).click()
      const chatPreset = dialog.getByRole('combobox', { name: 'Default preset for Chat', exact: true })
      await chatPreset.click()
      const list = page.getByRole('listbox')
      const local = list.getByRole('group', { name: 'LM Studio', exact: true })
      await list.getByRole('group', { name: 'OpenAI', exact: true }).getByRole('option', { selected: true }).waitFor()
      await capture('settings-chat-provider-groups')
      await chatPreset.fill('lm studio')
      assert({
        given: 'a provider search in the new-chat preset picker',
        should: 'keep its built-in and custom presets together under one heading',
        actual: [
          await list.getByRole('group').count(),
          await local.getByRole('option').filter({ hasText: 'default-local-fast' }).count(),
          await local.getByRole('option').filter({ hasText: 'custom-effort' }).count(),
        ],
        expected: [1, 1, 1],
      })
      await chatPreset.fill('default-local-fast')
      await chatPreset.press('ArrowDown')
      await chatPreset.press('Enter')
      await dialog.getByText('LM Studio · default-local-fast', { exact: true }).waitFor()
      await cancel()
      const openThinking = async () => {
        await openRole('Thinking')
        await dialog.getByRole('combobox', { name: 'Default preset for Thinking', exact: true }).click()
        await page.getByRole('option').filter({ hasText: 'default-sonnet-5.5' }).click()
      }
      await openRole('Frontier')
      const frontier = dialog.getByRole('combobox', { name: 'Default preset for Frontier', exact: true })
      const frontierEffort = dialog.getByRole('radiogroup', { name: 'Default effort for Frontier', exact: true })
      assert({
        given: 'the Frontier assignment',
        should: 'identify its preset and the X-high effort it inherits',
        actual: [
          await frontier.inputValue(),
          await frontierEffort.getByRole('radio', { name: 'X-high' }).getAttribute('aria-checked'),
        ],
        expected: ['Claude Fable 5.2 · X-high effort', 'true'],
      })
      await cancel()
      await openThinking()
      const roleEffort = dialog.getByRole('radiogroup', { name: 'Default effort for Thinking', exact: true })
      assert({
        given: 'Sonnet 5.5 selected before saving',
        should: 'highlight its default effort and identify the other affected roles',
        actual: [
          await roleEffort.getByRole('radio', { name: 'High', exact: true }).getAttribute('aria-checked'),
          await dialog.getByText(/also updates Balanced and Vision/).isVisible(),
        ],
        expected: ['true', true],
      })
      await cancel()
      assert({
        given: 'a cancelled change of preset',
        should: 'keep the assignment and its inherited effort',
        actual: [config.ai.roles?.reasoning, config.ai.profiles?.['default-sonnet-5.5']?.options?.effort],
        expected: [undefined, undefined],
      })
      await openLibrary()
      await page.locator('a[href$="/edit/default-sonnet-5.5"]').click()
      assert({
        given: 'editing a preset that inherits the model default',
        should: 'highlight High in the preset editor',
        actual: await dialog.getByRole('radio', { name: 'High', exact: true }).getAttribute('aria-checked'),
        expected: 'true',
      })
      await dialog.getByRole('button', { name: 'Save preset', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      assert({
        given: 'saving an inherited default without changing it',
        should: 'keep the effort option omitted',
        actual: config.ai.profiles?.['default-sonnet-5.5']?.options?.effort,
        expected: undefined,
      })
      await openAssignments()
      await openThinking()
      await roleEffort.getByRole('radio', { name: 'Low', exact: true }).click()
      await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      assert({
        given: 'Thinking reassigned to the preset already used by Balanced and Vision with a new effort',
        should: 'save both changes and update all three assignments',
        actual: [
          config.ai.roles?.reasoning,
          config.ai.profiles?.['default-sonnet-5.5']?.options?.effort,
          ...(await Promise.all(
            ['Thinking', 'Balanced', 'Vision'].map((role) =>
              page
                .getByRole('link', { name: `Change preset for ${role}`, exact: true })
                .getByText('Low', { exact: true })
                .isVisible(),
            ),
          )),
        ],
        expected: ['default-sonnet-5.5', 'low', true, true, true],
      })
      await capture('settings-defaults')
      await openLibrary()
      await page.getByText('Custom', { exact: true }).click()
      await page.locator('a[href$="/edit/custom-effort"]').click()
      await dialog.getByRole('button', { name: 'Save preset', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      assert({
        given: 'an existing custom provider effort edited in Settings',
        should: 'keep its raw provider options',
        actual: config.ai.profiles?.['custom-effort']?.options,
        expected: { reasoningEffort: 'none', temperature: 0.4 },
      })
      await page.getByRole('link', { name: 'New preset', exact: true }).click()
      await dialog.getByRole('textbox', { name: 'Preset name', exact: true }).fill('deep-work')
      await dialog.getByRole('combobox', { name: 'Preset model', exact: true }).click()
      await page.getByRole('option', { name: 'Claude Opus 5.5 · Anthropic', exact: true }).click()
      await dialog
        .getByRole('radiogroup', { name: 'Effort', exact: true })
        .getByRole('radio', { name: 'Max', exact: true })
        .click()
      await dialog.getByRole('button', { name: 'Create preset', exact: true }).click()
      await page.locator('a[href$="/edit/deep-work"]').waitFor()
      assert({
        given: 'a new named preset created with separate model and effort controls',
        should: 'save its model and default effort',
        actual: [config.ai.profiles?.['deep-work']?.model, config.ai.profiles?.['deep-work']?.options?.effort],
        expected: ['claude-opus-5-5', 'max'],
      })
      await page.getByRole('link', { name: 'New preset', exact: true }).click()
      await dialog.getByRole('textbox', { name: 'Preset name', exact: true }).fill('local-review')
      await dialog.getByRole('combobox', { name: 'Preset model', exact: true }).click()
      await page.getByRole('option', { name: 'Custom model…', exact: true }).click()
      await dialog.getByRole('textbox', { name: 'Model ID', exact: true }).fill('sample-local-model')
      await dialog.getByRole('combobox', { name: 'Provider', exact: true }).click()
      await page.getByRole('option', { name: 'lm-studio', exact: true }).click()
      await dialog.getByRole('textbox', { name: 'Other options (JSON)' }).fill('{"reasoningEffort":"none"}')
      await dialog.getByRole('button', { name: 'Create preset', exact: true }).click()
      await page.locator('a[href$="/edit/local-review"]').waitFor()
      assert({
        given: 'a new custom model that takes its own provider effort option',
        should: 'keep the manually entered option when the preset is created',
        actual: config.ai.profiles?.['local-review']?.options,
        expected: { reasoningEffort: 'none' },
      })
      await openAssignments()
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
      await checkLocked('the existing chat on a phone')
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
      config.ai.profiles!['default-opus-5.5'] = { provider: 'anthropic', model: 'claude-haiku-4-5' }
      await page.reload()
      await toggle.click()
      await checkLocked('a chat after its global preset was changed to another model')
      assert({
        given: 'a global preset edit',
        should: 'keep the existing chat’s actual model in its summary',
        actual: (await toggle.textContent())?.includes('Claude Opus 5.5'),
        expected: true,
      })
      await page.goto(`${origin}/thread/${branch.id}`)
      await toggle.click()
      await checkLocked('an inherited branch on a phone')
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
