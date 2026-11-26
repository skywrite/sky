import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import type { ResolvedModel } from '#shared/ai/models.ts'
import ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { prettyModel } from '#universal/ai/modelName.ts'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { SETTINGS_PAGES } from '../../web/client/settings/settingsRoutes.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text ?? '') : ''))
      .join('')
  return ''
}

test(
  {
    name: 'phone navigation — the bar, More, the Settings list, the days sheet, search, and live chats replace the drawer',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-phone-nav-'))
    const app = new Hono()
    app.get('/settings/_api/settings', (c) =>
      c.json({
        theme: 'system',
        textSize: 'default',
        models: [{ role: 'chat', label: 'New chats', value: '', profile: 'sol' }],
        profiles: [{ name: 'sol', builtin: true, provider: 'openai', model: 'gpt-6.1-sol', roles: ['chat'] }],
        experimental: { contextPreflight: false, workstreams: false },
      }),
    )
    app.get('/settings/_api/writing-voice/edits', (c) => c.json({ edits: [] }))
    app.route(
      '/',
      createTestHttpApp([root], {
        chat: {
          timeDir: path.join(root, 'time'),
          settings: {
            defaultModel: 'test',
            readingBudget: () => 0,
            choices: () => [{ name: 'test', label: 'Test model', provider: 'Test', roles: ['Thinking'] }],
            resolve: () => ({ model: {} as ResolvedModel, profile: { model: 'test' } }),
          },
          title: async () => 'Atlas API migration',
          createSession: async (_id, onEvent, _prefs, ask, restore) =>
            new ChatSession({
              today: new PlainDate('2026-01-27'),
              startTime: restore?.startTime ?? new PlainDateTime('2026-01-27 13:40'),
              days: 0,
              baseDir: root,
              timeDir: path.join(root, 'time'),
              chatLogDir: path.join(root, 'state', 'logs'),
              contextTokens: 0,
              resume: restore?.resume ?? null,
              restore: restore?.resume ? undefined : restore?.state,
              parent: restore?.resume ? null : restore?.parent,
              model: {} as ResolvedModel,
              profile: { model: 'test' },
              ambient: { today: { date: '2026-01-27', dayOfWeek: 'Tuesday' }, health: [], prices: [] },
              producers: {
                produceInitialQuery: async () => ({ ok: true, value: { paths: [] } }),
                evolveQueries: async () => ({ ok: true, value: { queries: [], changed: false } }),
                executeQuery: async () => ({ ok: true, value: { paths: [] } }),
              },
              systemPrompt: async () => 'Test assistant.',
              tools: async () => ({ tools: {}, toolApproval: {} }),
              approvalHandler: async ({ toolName }) => ask({ toolName, lines: ['Synthetic action'] }),
              autosavePath: null,
              onEvent,
              now: async () => new PlainDateTime('2026-01-27 13:42'),
              logError: async () => {},
              invokeModel: async ({ messages, sink }) => {
                const reply = textOf(messages.at(-1)?.content).includes('Atlas')
                  ? 'Atlas rollout summary is ready.'
                  : 'Done.'
                sink.write(reply)
                return {
                  text: reply,
                  content: [],
                  steps: [],
                  responseMessages: [{ role: 'assistant', content: reply }],
                }
              },
            }),
        },
      }),
    )
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server address')
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const base = `http://127.0.0.1:${address.port}`
      const screenshots = env.get('SKY_PHONE_NAV_SCREENSHOTS')
      const capture = async (name: string) => {
        if (screenshots) await page.screenshot({ path: path.join(screenshots, `${name}.png`), animations: 'disabled' })
      }
      const overflows = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
      const bar = page.getByRole('navigation', { name: 'Main' })
      const side = page.locator('.sky-side')

      // 1. A wide window keeps the sidebar, its days included, and has no bar.
      await page.goto(`${base}/`)
      await side.locator('.sky-side-dates').waitFor()
      assert({
        given: 'Today in a wide window',
        should: 'keep the sidebar with its days and leave the bar out',
        actual: [
          await side.isVisible(),
          await side.getByText('Past days', { exact: true }).isVisible(),
          await bar.isVisible(),
        ],
        expected: [true, true, false],
      })

      // 2. A phone: the bar replaces the sidebar, and search waits behind its button.
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`${base}/`)
      await bar.waitFor()
      const todayTab = bar.getByRole('link', { name: 'Today', exact: true })
      const searchField = page.getByRole('combobox', { name: 'Search anything' })
      assert({
        given: 'Today on a phone',
        should: 'show the bar with Today current, hide the sidebar and the search field, and fit the screen',
        actual: [
          await side.isVisible(),
          await todayTab.getAttribute('aria-current'),
          await searchField.isVisible(),
          await overflows(),
        ],
        expected: [false, 'page', false, false],
      })
      await capture('today')

      // 3. The date opens the days the sidebar listed; choosing one goes there.
      await page.locator('.sky-day-date').click()
      const days = page.getByRole('dialog', { name: 'Go to a day' })
      await days.waitFor()
      await capture('days')
      const tomorrow = days.getByRole('button', { name: /^Tomorrow/ })
      const tomorrowYmd = await tomorrow.locator('time').getAttribute('datetime')
      await tomorrow.click()
      await page.waitForURL(`${base}/${tomorrowYmd}`)
      await days.waitFor({ state: 'hidden' })
      assert({
        given: 'Tomorrow chosen in the days sheet',
        should: 'open that day, close the sheet, and keep Today current in the bar',
        actual: [new URL(page.url()).pathname, await todayTab.getAttribute('aria-current')],
        expected: [`/${tomorrowYmd}`, 'page'],
      })

      // 4. More opens everything else; tapping outside or Escape closes it.
      const more = bar.getByRole('button', { name: 'More', exact: true })
      const panel = page.getByRole('dialog', { name: 'More' })
      await more.click()
      await panel.waitFor()
      await capture('more')
      const rows = await panel.locator('.sky-list-label').allInnerTexts()
      assert({
        given: 'More tapped',
        should: 'open the panel with the tools and the records the drawer held',
        actual: [await more.getAttribute('aria-expanded'), rows.slice(0, 7)],
        expected: ['true', ['Whiteboard', 'Automations', 'Files', 'Settings', 'People & Orgs', 'Places', 'Recurring']],
      })
      await page.mouse.click(195, 60)
      await panel.waitFor({ state: 'hidden' })
      await more.click()
      await panel.waitFor()
      await page.keyboard.press('Escape')
      await panel.waitFor({ state: 'hidden' })
      assert({
        given: 'More closed by tapping outside, then by Escape',
        should: 'close the panel and hand focus back to More',
        actual: [
          await more.getAttribute('aria-expanded'),
          await page.evaluate(() => document.activeElement?.getAttribute('aria-controls')),
        ],
        expected: ['false', 'sky-more-panel'],
      })

      // 5. Settings on a phone is a list of every section, each with a way back.
      await more.click()
      await panel.getByRole('link', { name: 'Settings', exact: true }).click()
      const home = page.locator('[data-settings-section="home"]')
      // The current theme and chat model fill in once the settings have loaded.
      await home.locator('.sky-list-value').nth(1).waitFor()
      await capture('settings')
      assert({
        given: 'Settings opened from More',
        should: 'list every section with the theme and chat model, mark More, and name the tab',
        actual: [
          await page.title(),
          await more.getAttribute('aria-current'),
          await home.locator('.sky-list-row').count(),
          await home.locator('.sky-list-value').allInnerTexts(),
          await panel.isVisible(),
        ],
        expected: [
          'sky · Settings',
          'page',
          Object.keys(SETTINGS_PAGES).length,
          ['System', prettyModel('gpt-6.1-sol')],
          false,
        ],
      })
      await home.getByRole('link', { name: /^Appearance/ }).click()
      await page.getByRole('heading', { name: 'Appearance', exact: true }).waitFor()
      const back = page.getByRole('button', { name: '‹ Settings', exact: true })
      assert({
        given: 'a settings section on a phone',
        should: 'offer the way back to the list in place of the trail',
        actual: [
          new URL(page.url()).pathname,
          await back.isVisible(),
          await page.locator('.sky-set-breadcrumb').isVisible(),
          await page.title(),
        ],
        expected: ['/settings/appearance', true, false, 'sky · Appearance'],
      })
      await capture('appearance')
      await back.click()
      await home.waitFor()

      // 6. The round button opens search full screen, ready to type.
      await bar.getByRole('button', { name: 'Search', exact: true }).click()
      await searchField.waitFor()
      assert({
        given: 'the search button',
        should: 'open search with its field focused',
        actual: [
          await searchField.isVisible(),
          await searchField.evaluate((field) => field === document.activeElement),
        ],
        expected: [true, true],
      })
      await capture('search')
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await searchField.waitFor({ state: 'hidden' })

      // 7. A conversation takes the whole screen; its way back depends on where it began.
      await todayTab.click()
      const chatTab = bar.getByRole('button', { name: 'Chat', exact: true })
      await chatTab.click()
      await page.waitForFunction(() => document.title === 'sky:chat - New chat')
      await page.getByText('Ask a question, or hand Sky a task.').waitFor()
      const composer = page.locator('.sky-composer-shell')
      await composer.locator('[role="textbox"]').fill('Summarize the Atlas rollout checklist.')
      await composer.getByRole('button', { name: 'Send', exact: true }).click()
      await page.getByText('Atlas rollout summary is ready.', { exact: true }).waitFor()
      const chatBack = page.locator('.sky-chat-back')
      assert({
        given: 'a conversation started from Today on a phone',
        should: 'step the bar aside and go back to Today',
        actual: [await bar.isVisible(), (await chatBack.innerText()).trim()],
        expected: [false, '‹ Today'],
      })
      await capture('conversation')
      await chatBack.click()
      await chatTab.click()
      const live = page.getByRole('region', { name: 'Live chats' })
      await live.waitFor()
      await capture('chat')
      assert({
        given: 'the Chat page with one live chat',
        should: 'list it above the message box with Chat current',
        actual: [
          await live.locator('.sky-live-chat-title').allInnerTexts(),
          await chatTab.getAttribute('aria-current'),
        ],
        expected: [['Atlas API migration'], 'page'],
      })
      await live.getByRole('link', { name: /Atlas API migration/ }).click()
      await page.getByText('Atlas rollout summary is ready.', { exact: true }).waitFor()
      assert({
        given: 'a live chat opened from the Chat page',
        should: 'go back to the Chat page',
        actual: (await chatBack.innerText()).trim(),
        expected: '‹ Chat',
      })
      await chatBack.click()
      await live.waitFor()
      assert({
        given: 'the whole walk through the phone layout',
        should: 'stay within the screen and raise no page errors',
        actual: [await overflows(), errors],
        expected: [false, []],
      })
    } finally {
      await browser?.close()
      server.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)
