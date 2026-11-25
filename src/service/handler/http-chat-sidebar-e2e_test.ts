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
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
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
    name: 'Live chats appear nested under Chat on chat pages, stay hidden without a badge elsewhere, and keep titles synced',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-chat-sidebar-'))
    const app = new Hono()
    app.get('/settings/_api/settings', (c) => c.json({ theme: 'light', textSize: 'default' }))
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
          title: async (turns) => {
            const question = turns.findLast((turn) => turn.role === 'user')?.content ?? ''
            if (question.includes('Rollback')) return 'Rollback checklist'
            if (question.includes('Atlas')) return 'Atlas API migration'
            if (question.includes('board')) return 'Q4 board memo'
            if (question.includes('regex')) return 'Quick regex check'
            return 'General chat'
          },
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
                const text = textOf(messages.at(-1)?.content)
                if (text.includes('board')) {
                  await ask({ toolName: 'post_update', lines: ['Post synthetic summary to #exec-prep'] })
                  const reply = 'Board memo summary settled.'
                  sink.write(reply)
                  return {
                    text: reply,
                    content: [],
                    steps: [],
                    responseMessages: [{ role: 'assistant', content: reply }],
                  }
                }
                const reply = text.includes('Rollback')
                  ? 'Rollback steps are ready.'
                  : text.includes('regex')
                    ? 'Regex pattern is ready.'
                    : 'Atlas rollout summary is ready.'
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

      // 1. On Today: Chat has no badge and no nested live-chat list.
      await page.goto(`${base}/`)
      const side = page.locator('.sky-side')
      const chatNavButton = side.getByRole('button', { name: 'Chat', exact: true })
      await chatNavButton.waitFor()
      assert({
        given: 'Today page',
        should: 'keep Chat as a plain row without a count badge or expanded list',
        actual: {
          chatText: (await chatNavButton.innerText()).trim(),
          liveListCount: await side.locator('.sky-side-chats').count(),
        },
        expected: {
          chatText: 'Chat',
          liveListCount: 0,
        },
      })

      // 2. Click Chat: opens empty New chat with empty Live chats state.
      await chatNavButton.click()
      await side.locator('.sky-side-chats').waitFor()
      assert({
        given: 'a brand-new chat with zero open conversations',
        should: 'highlight Chat, show the empty state under Live chats, hide +, and set the page title',
        actual: {
          chatCurrent: await chatNavButton.getAttribute('aria-current'),
          emptyText: await side.locator('.sky-side-chat-empty').innerText(),
          plusCount: await side.getByRole('button', { name: 'New chat', exact: true }).count(),
          title: await page.title(),
        },
        expected: {
          chatCurrent: 'page',
          emptyText: 'No live chats yet.',
          plusCount: 0,
          title: 'sky:chat - New chat',
        },
      })

      const composer = page.locator('.sky-composer-shell')
      const input = composer.locator('[role="textbox"]')
      const send = composer.getByRole('button', { name: 'Send', exact: true })

      // 3. Send first chat ("Atlas API migration").
      await input.fill('Summarize the Atlas rollout checklist.')
      await send.click()
      await page.getByText('Atlas rollout summary is ready.', { exact: true }).waitFor()
      const atlasRow = side.locator('.sky-side-chat', { hasText: 'Atlas API migration' })
      await atlasRow.waitFor()
      const atlasUrl = page.url()

      assert({
        given: 'a live chat after its first reply',
        should: 'highlight the live chat row, show + on Chat, display the count, and update the page title',
        actual: {
          atlasCurrent: await atlasRow.getAttribute('aria-current'),
          chatCurrent: await chatNavButton.getAttribute('aria-current'),
          plusVisible: await side.getByRole('button', { name: 'New chat', exact: true }).isVisible(),
          count: await side.locator('.sky-side-chats-count').innerText(),
          title: await page.title(),
        },
        expected: {
          atlasCurrent: 'page',
          chatCurrent: null,
          plusVisible: true,
          count: '1',
          title: 'sky:chat - Atlas API migration',
        },
      })

      // 4. Branch from Atlas API migration -> opens in a new tab and nests under its parent in the sidebar.
      await page.getByRole('button', { name: 'Response options', exact: true }).click()
      const popupPromise = page.waitForEvent('popup')
      await page.getByRole('menuitem', { name: 'Branch from here…' }).click()
      const popup = await popupPromise
      await popup.close()
      const newBranchRow = side.locator('.sky-side-chat', { hasText: 'New branch' })
      await newBranchRow.waitFor()
      await newBranchRow.click()
      await page.waitForFunction(() => document.title === 'sky:chat - New branch')
      await input.fill('Rollback steps if latency spikes.')
      await send.click()
      await page.getByText('Rollback steps are ready.', { exact: true }).waitFor()
      const branchRow = side.locator('.sky-side-chat', { hasText: 'Rollback checklist' })
      await branchRow.waitFor()

      assert({
        given: 'a live branch of a live chat',
        should: 'indent the branch directly below its parent in the sidebar',
        actual: {
          order: await side.locator('.sky-side-chat-title').allInnerTexts(),
          isBranch: await branchRow.getAttribute('data-branch'),
        },
        expected: {
          order: ['Atlas API migration', 'Rollback checklist'],
          isBranch: 'true',
        },
      })

      // 5. Start a temporary chat via the + button on Chat.
      await side.getByRole('button', { name: 'New chat', exact: true }).click()
      await page.waitForFunction(() => document.title === 'sky:chat - New chat')
      await page.getByRole('switch', { name: /Temporary/i }).click()
      await input.fill('Give me a quick regex for week ids.')
      await send.click()
      await page.getByText('Regex pattern is ready.', { exact: true }).waitFor()
      const tempRow = side.locator('.sky-side-chat', { hasText: 'Quick regex check' })
      await tempRow.waitFor()

      assert({
        given: 'a temporary live chat',
        should: 'mark it Temporary with a hollow temporary indicator in the sidebar',
        actual: {
          subText: await tempRow.locator('.sky-side-chat-sub').innerText(),
          tempDot: await tempRow.locator('.sky-side-chat-dot').getAttribute('data-temp'),
        },
        expected: {
          subText: 'Temporary',
          tempDot: 'true',
        },
      })

      // 6. Start a chat waiting for approval ("Q4 board memo"), then switch to Atlas and verify "Needs your go".
      await side.getByRole('button', { name: 'New chat', exact: true }).click()
      await input.fill('Draft the Q4 board update and post it.')
      await send.click()
      await page.getByRole('button', { name: 'Allow', exact: true }).waitFor()
      const boardRow = side.locator('.sky-side-chat', { hasText: 'Q4 board memo' })
      await boardRow.locator('.sky-side-chat-sub', { hasText: 'Needs your go' }).waitFor()

      // Switch to Atlas via the sidebar link and verify navigation + returnTo + title.
      await atlasRow.click()
      await page.getByText('Atlas rollout summary is ready.', { exact: true }).waitFor()
      assert({
        given: 'clicking another live chat in the sidebar while another chat waits for approval',
        should: 'switch in place, preserve returnTo, sync title, and keep Needs your go visible on the waiting chat',
        actual: {
          url: page.url(),
          title: await page.title(),
          atlasCurrent: await atlasRow.getAttribute('aria-current'),
          boardSub: await boardRow.locator('.sky-side-chat-sub').innerText(),
          count: await side.locator('.sky-side-chats-count').innerText(),
        },
        expected: {
          url: atlasUrl,
          title: 'sky:chat - Atlas API migration',
          atlasCurrent: 'page',
          boardSub: 'Needs your go',
          count: '4',
        },
      })

      // 7. Browser back returns to the waiting chat and keeps active state + title synced.
      await page.goBack()
      await page.getByRole('button', { name: 'Allow', exact: true }).waitFor()
      assert({
        given: 'browser back navigation between live chats',
        should: 'sync both the highlighted sidebar row and browser tab title',
        actual: {
          boardCurrent: await boardRow.getAttribute('aria-current'),
          title: await page.title(),
        },
        expected: {
          boardCurrent: 'page',
          title: 'sky:chat - Q4 board memo',
        },
      })

      // Cleanly decline the held approval so the test server exits without dangling tool waits.
      await page.getByRole('button', { name: 'Not now', exact: true }).click()
      await page.getByText('Board memo summary settled.', { exact: true }).waitFor()

      // 8. Return to Today: live chats list collapses AND Chat row has NO badge/count.
      await side.getByRole('button', { name: 'Today', exact: true }).click()
      await side.locator('.sky-side-dates').waitFor()
      assert({
        given: 'returning to Today while 4 live chats remain open',
        should: 'collapse the sidebar live-chat list and keep Chat free of any number badge',
        actual: {
          chatText: (await chatNavButton.innerText()).trim(),
          liveListCount: await side.locator('.sky-side-chats').count(),
        },
        expected: {
          chatText: 'Chat',
          liveListCount: 0,
        },
      })

      // 9. Mobile drawer: clicking a live chat switches threads and closes the drawer.
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(atlasUrl)
      await page.getByText('Atlas rollout summary is ready.', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Navigation', exact: true }).click()
      await side.locator('.sky-side-chat', { hasText: 'Quick regex check' }).waitFor()
      await side.locator('.sky-side-chat', { hasText: 'Quick regex check' }).click()
      await page.getByText('Regex pattern is ready.', { exact: true }).waitFor()
      await page.waitForFunction(() => document.querySelector('.sky-side')!.getBoundingClientRect().right <= 0)

      assert({
        given: 'switching chats from the mobile sidebar drawer',
        should: 'navigate cleanly, close the drawer, and leave no page errors',
        actual: {
          title: await page.title(),
          errors,
        },
        expected: {
          title: 'sky:chat - Quick regex check',
          errors: [],
        },
      })
    } finally {
      await browser?.close()
      server.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)
