import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import { currentDraftVersion } from '#lib/writingVoice/draftTypes.ts'
import { listChatAutosaves } from '#shared/models/Chat/ChatStore/autosave.ts'
import { serializeContextLog, splitContextLog } from '#shared/models/Chat/document/ContextLog/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { EDITED_DRAFT, ORIGINAL_DRAFT, WARM_DRAFT, writingDraftTestHost } from './chat/draftsTestHelpers.ts'
import { createChatRoutes } from './chat/mod.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'
import { createWritingVoiceRoutes } from './settings/writingVoice.ts'

test(
  { name: 'a chat restored from large tool history shows an editable draft without recovery JSON', timeout: 90000 },
  async (t) => {
    let host: ReturnType<typeof writingDraftTestHost>
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Mock drafting notebook\n',
        tempPrefix: 'sky-large-draft-recovery-',
        day: true,
        chat: (root) => {
          host = writingDraftTestHost(root)
          return {
            ...host,
            snapshots: async () => {
              const prior = createChatRoutes({ ...host, snapshots: async () => [] })
              const response = await prior.request('/main/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  message: 'Draft an email to Jane.',
                  profile: 'test-thread-model',
                  contextTokens: 0,
                  saves: true,
                }),
              })
              const reply = await response.text()
              if (!response.ok || reply.includes('event: error')) throw new Error(reply)
              const snapshot = (await listChatAutosaves(path.join(root, 'state')))[0]!
              const { body, entries, details } = splitContextLog(await readFile(snapshot.path, 'utf8'))
              const result = details?.session?.modelMessages?.find((message) => message.role === 'tool')?.content[0]
              if (
                result?.type !== 'tool-result' ||
                result.output.type !== 'json' ||
                !result.output.value ||
                typeof result.output.value !== 'object' ||
                Array.isArray(result.output.value)
              )
                throw new Error('Expected the saved writer result')
              result.output.value = { ...result.output.value, context: 'Mock tool history. '.repeat(150_000) }
              await writeFile(snapshot.path, body + serializeContextLog(entries, details))
              return host.snapshots!()
            },
          }
        },
      },
      async ({ page, origin, errors }) => {
        await page.goto(`${origin}/thread/main`)
        const main = page.locator('.sky-split-main')
        const draft = main.locator('.sky-writing-draft')
        await draft.getByRole('button', { name: 'Edit', exact: true }).waitFor()
        const restored = await (await page.request.get(`${origin}/chat/main`)).json()
        assert({
          given: 'a service recovering a conversation whose tool history spans several megabytes',
          should: 'restore the draft link and keep recovery JSON out of the reply',
          actual: [
            restored.turns.length,
            restored.turns.at(-1).content.includes('CONTEXT-LOG'),
            await draft.locator('.sky-writing-draft-body').innerText(),
            await main.locator('.sky-body pre').count(),
          ],
          expected: [2, false, ORIGINAL_DRAFT, 0],
        })
        await draft.getByRole('button', { name: 'Edit', exact: true }).click()
        await draft.getByLabel('Edit draft text', { exact: true }).fill(EDITED_DRAFT)
        await draft.getByRole('button', { name: 'Save edit', exact: true }).click()
        await draft.getByText('The Atlas draft is ready. Please review it by Friday.', { exact: true }).waitFor()
        await page.reload()
        await draft.getByRole('button', { name: 'Versions · 2', exact: true }).waitFor()
        assert({
          given: 'a direct edit to the recovered draft and a browser reload',
          should: 'retain the edit without browser errors',
          actual: [await draft.locator('.sky-writing-draft-body').innerText(), errors],
          expected: [EDITED_DRAFT, []],
        })
        await host!.writingDrafts.idle()
      },
    )
  },
)

test(
  {
    name: 'reformatted Ghostwriter drafts keep their editor in the latest reply through edits and reloads',
    timeout: 90000,
  },
  async (t) => {
    const subject = 'Atlas update\n============\n\n'
    const present = (text: string) => text.replace(subject, '**Atlas update**\n\n')
    let host: ReturnType<typeof writingDraftTestHost>
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Mock drafting notebook\n',
        tempPrefix: 'sky-reformatted-drafts-',
        day: true,
        chat: (root) =>
          (host = writingDraftTestHost(root, {
            draft: (input) => subject + (/warmer/i.test(input.instruction ?? '') ? WARM_DRAFT : ORIGINAL_DRAFT),
            reply: (text) =>
              `Here is the message.\n\n> ${present(text).replaceAll('\n', '\n> ')}\n\nCheck before sending.`,
          })),
      },
      async ({ page, origin, errors }) => {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
        await page.setViewportSize({ width: 1440, height: 1100 })
        const first = await page.request.post(`${origin}/chat/main/messages`, {
          data: { message: 'Draft a message to Jane.', profile: 'test-thread-model', contextTokens: 0, saves: true },
        })
        if (!first.ok() || (await first.text()).includes('event: error')) throw new Error(await first.text())
        await page.goto(`${origin}/thread/main`)
        const main = page.locator('.sky-split-main')
        const replies = main.locator('.sky-turn[data-speaker="Sky"]')
        await replies.first().getByRole('button', { name: 'Edit', exact: true }).waitFor()
        const composer = main.getByPlaceholder('Message sky…')
        await composer.fill('Make this warmer.')
        await composer.press('Enter')
        const current = replies.nth(1).locator('.sky-writing-draft')
        await current.getByRole('button', { name: 'Edit', exact: true }).waitFor()
        assert({
          given: 'Ghostwriter saves an underlined subject and the chat agent presents it in bold',
          should: 'frame both appearances and place the sole editor on the latest reply without duplicate quotes',
          actual: [
            await main.locator('.sky-writing-draft').count(),
            await main.locator('.sky-body blockquote').count(),
            await replies.first().getByRole('button', { name: 'Edit', exact: true }).count(),
            await current.getByRole('button', { name: 'Versions · 2', exact: true }).count(),
          ],
          expected: [2, 0, 0, 1],
        })
        await current.getByRole('button', { name: 'Edit', exact: true }).click()
        assert({
          given: 'Edit on a draft whose reply formatting changed',
          should: 'edit the saved Ghostwriter record',
          actual: await current.getByLabel('Edit draft text', { exact: true }).inputValue(),
          expected: subject + WARM_DRAFT,
        })
        await current.getByLabel('Edit draft text', { exact: true }).fill(subject + EDITED_DRAFT)
        await current.getByRole('button', { name: 'Save edit', exact: true }).click()
        await current.getByText('The Atlas draft is ready. Please review it by Friday.', { exact: true }).waitFor()
        await page.reload()
        await current.getByRole('button', { name: 'Versions · 3', exact: true }).waitFor()
        await current.getByRole('button', { name: 'Copy', exact: true }).click()
        const { drafts } = await (await page.request.get(`${origin}/chat/main/drafts`)).json()
        assert({
          given: 'a direct edit followed by a reload',
          should: 'keep the same draft, full history, edited clipboard text, and one editor',
          actual: [
            drafts.length,
            drafts[0].versions.map((version: { text: string }) => version.text),
            await page.evaluate(() => navigator.clipboard.readText()),
            await main.locator('.sky-writing-draft').getByRole('button', { name: 'Edit', exact: true }).count(),
          ],
          expected: [
            1,
            [subject + ORIGINAL_DRAFT, subject + WARM_DRAFT, subject + EDITED_DRAFT],
            subject + EDITED_DRAFT,
            1,
          ],
        })
        const selected = await current.locator('.sky-writing-draft-body').evaluate((element) => {
          const paragraphs = element.querySelectorAll('p')
          const range = document.createRange()
          range.setStart(paragraphs[0]!.firstChild!, 0)
          range.setEnd(paragraphs[1]!.firstChild!, 25)
          const selection = window.getSelection()!
          selection.removeAllRanges()
          selection.addRange(range)
          return selection.toString()
        })
        await page.waitForResponse((reply) => reply.url().endsWith('/chat/main/drafts'))
        assert({
          given: 'text selected across paragraphs in a reformatted draft during background refresh',
          should: 'preserve selection and render without browser errors',
          actual: [await page.evaluate(() => window.getSelection()?.toString()), errors],
          expected: [selected, []],
        })
        const screenshots = env.get('SKY_DRAFT_SCREENSHOTS')
        if (screenshots) {
          await mkdir(screenshots, { recursive: true })
          await page.evaluate(() => window.getSelection()?.removeAllRanges())
          await page.screenshot({ path: path.join(screenshots, 'reformatted-drafts.png'), fullPage: true })
        }
        await host!.writingDrafts.idle()
      },
    )
  },
)

test(
  {
    name: 'main chat revisions stay readable in each response while thread edits update the latest draft',
    timeout: 90000,
  },
  async (t) => {
    let host: ReturnType<typeof writingDraftTestHost>
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Mock drafting notebook\n',
        tempPrefix: 'sky-main-draft-revisions-',
        day: true,
        chat: (root) => (host = writingDraftTestHost(root)),
      },
      async ({ page, origin, errors }) => {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
        await page.setViewportSize({ width: 1440, height: 1100 })
        const first = await page.request.post(`${origin}/chat/main/messages`, {
          data: { message: 'Draft an email to Jane.', profile: 'test-thread-model', contextTokens: 0, saves: true },
        })
        if (!first.ok() || (await first.text()).includes('event: error')) throw new Error(await first.text())
        await page.goto(`${origin}/thread/main`)
        const main = page.locator('.sky-split-main')
        const replies = main.locator('.sky-turn[data-speaker="Sky"]')
        const bodies = main.locator('.sky-writing-draft-body')
        const original = replies.nth(0).locator('.sky-writing-draft')
        const composer = main.getByPlaceholder('Message sky…')
        await original.getByRole('button', { name: 'Edit', exact: true }).waitFor()
        const unsavedShots = env.get('SKY_DRAFT_SCREENSHOTS')
        if (unsavedShots) {
          await mkdir(unsavedShots, { recursive: true })
          await page.screenshot({ path: path.join(unsavedShots, 'chat-unsaved.png'), fullPage: true })
        }

        await composer.fill('Make this warmer.')
        await composer.press('Enter')
        const second = replies.nth(1).locator('.sky-writing-draft')
        await second.getByRole('button', { name: 'Edit', exact: true }).waitFor()
        assert({
          given: 'a draft revised from the main conversation composer',
          should: 'keep the original readable and show the complete revision in the new response with its editor',
          actual: [
            await bodies.allInnerTexts(),
            await original.getByText('Earlier version', { exact: true }).count(),
            await original.getByRole('button', { name: 'Edit', exact: true }).count(),
            await main.getByRole('link', { name: 'View current draft ↑', exact: true }).count(),
          ],
          expected: [[ORIGINAL_DRAFT, WARM_DRAFT], 1, 0, 0],
        })
        for (const [card, expected] of [
          [original, ORIGINAL_DRAFT],
          [second, WARM_DRAFT],
        ] as const) {
          await card.getByRole('button', { name: 'Copy', exact: true }).click()
          assert({
            given: 'Copy on an earlier or current draft',
            should: 'copy the wording displayed in that response',
            actual: await page.evaluate(() => navigator.clipboard.readText()),
            expected,
          })
        }
        await second.getByRole('button', { name: 'Edit', exact: true }).click()
        await second.getByLabel('Edit draft text', { exact: true }).fill(EDITED_DRAFT)
        await second.getByRole('button', { name: 'Save edit', exact: true }).click()
        await second.getByText('The Atlas draft is ready. Please review it by Friday.', { exact: true }).waitFor()
        await composer.fill('Show the current wording again.')
        await composer.press('Enter')
        const latest = replies.nth(2).locator('.sky-writing-draft')
        await latest.getByRole('button', { name: 'Edit', exact: true }).waitFor()
        await page.reload()
        await latest.getByRole('button', { name: 'Edit', exact: true }).waitFor()
        assert({
          given: 'another main response and a reload',
          should: 'retain each response’s wording and keep just the newest appearance editable',
          actual: [
            await bodies.allInnerTexts(),
            await main.locator('.sky-writing-draft').getByRole('button', { name: 'Edit', exact: true }).count(),
          ],
          expected: [[ORIGINAL_DRAFT, WARM_DRAFT, EDITED_DRAFT], 1],
        })

        const selected = await original.locator('.sky-writing-draft-body').evaluate((element) => {
          const paragraphs = element.querySelectorAll('p')
          const range = document.createRange()
          range.setStart(paragraphs[0]!.firstChild!, 0)
          range.setEnd(paragraphs[1]!.firstChild!, 25)
          const selection = window.getSelection()!
          selection.removeAllRanges()
          selection.addRange(range)
          return selection.toString()
        })
        await page.waitForResponse((reply) => reply.url().endsWith('/chat/main/drafts'))
        assert({
          given: 'earlier draft text selected across paragraphs and a background refresh',
          should: 'preserve the selection',
          actual: await page.evaluate(() => window.getSelection()?.toString()),
          expected: selected,
        })
        await page.evaluate(() => window.getSelection()?.removeAllRanges())
        const screenshots = env.get('SKY_DRAFT_SCREENSHOTS')
        if (screenshots) {
          await mkdir(screenshots, { recursive: true })
          await page.screenshot({ path: path.join(screenshots, 'main-revisions.png'), fullPage: true })
        }

        await composer.fill('Keep this unsent main-chat message.')
        const opened = page.waitForResponse(
          (reply) => reply.url().endsWith('/chat/main/replies') && reply.request().method() === 'POST',
        )
        await latest.getByRole('button', { name: 'Work on this…', exact: true }).click()
        const sourceTurn = (await opened).request().postDataJSON().turn
        const panel = page.getByRole('complementary', { name: 'Thread', exact: true })
        const threadComposer = panel.getByPlaceholder('What would you like to change?')
        await threadComposer.fill('Make this warmer.')
        await threadComposer.press('Enter')
        await latest
          .getByText('The Atlas draft is ready. I would appreciate your review by Friday.', { exact: true })
          .waitFor()
        assert({
          given: 'a revision requested through the latest draft’s discussion',
          should: 'open at that response and update its card without adding a main reply or changing earlier drafts',
          actual: [sourceTurn, await replies.count(), await bodies.allInnerTexts(), await composer.inputValue()],
          expected: [3, 3, [ORIGINAL_DRAFT, WARM_DRAFT, WARM_DRAFT], 'Keep this unsent main-chat message.'],
        })
        await panel.getByRole('button', { name: 'Close thread', exact: true }).click()
        await page.setViewportSize({ width: 390, height: 844 })
        await page.waitForFunction(() => document.querySelector('.sky-side')!.getBoundingClientRect().right <= 0)
        assert({
          given: 'all draft appearances on a phone viewport',
          should: 'fit within the conversation and have one unique editor anchor without browser errors',
          actual: [
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
            await main.locator('.sky-writing-draft[id]').count(),
            await main.getByRole('link', { name: 'View current draft ↑', exact: true }).count(),
            errors,
          ],
          expected: [true, 1, 0, []],
        })
        await host!.writingDrafts.idle()
      },
    )
  },
)

test(
  {
    name: 'Chat draft frames edit, copy, undo, discuss, recover unsaved text and preserve selection through refreshes',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 90000,
  },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sky-writing-draft-browser-'))
    const host = writingDraftTestHost(root)
    const app = new Hono()
    app.get('/settings/_api/settings', (c) => c.json({ theme: 'system', textSize: 'default' }))
    app.route('/settings/_api/writing-voice', createWritingVoiceRoutes(host.writingDrafts.voice))
    app.route('/', createTestHttpApp([path.join(root, 'time'), path.join(root, 'me')], { chat: host }))
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing server address')
    const base = `http://127.0.0.1:${address.port}`
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1100 },
        permissions: ['clipboard-read', 'clipboard-write'],
      })
      const page = await context.newPage()
      const errors: string[] = []
      const screenshots = env.get('SKY_DRAFT_SCREENSHOTS')
      if (screenshots) await mkdir(screenshots, { recursive: true })
      page.on('pageerror', (error) => errors.push(error.message))
      const response = await app.request('/chat/main/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Draft an email to Jane.',
          profile: 'test-thread-model',
          contextTokens: 0,
          saves: true,
        }),
      })
      await response.text()
      await page.goto(`${base}/thread/main`)
      const card = page.locator('.sky-split-main .sky-writing-draft').first()
      const body = card.locator('.sky-writing-draft-body')
      await body.getByText('Hi Jane,', { exact: true }).waitFor()
      await card.getByRole('button', { name: 'Copy', exact: true }).click()
      assert({
        given: 'Copy on the framed message',
        should: 'copy only the draft, excluding surrounding advice',
        actual: await page.evaluate(() => navigator.clipboard.readText()),
        expected: ORIGINAL_DRAFT,
      })

      const select = async () =>
        body.evaluate((element) => {
          const paragraphs = element.querySelectorAll('p')
          const range = document.createRange()
          range.setStart(paragraphs[0]!.firstChild!, 0)
          range.setEnd(paragraphs[1]!.firstChild!, 25)
          const selection = window.getSelection()!
          selection.removeAllRanges()
          selection.addRange(range)
          ;(window as unknown as { draftTextNode: Node }).draftTextNode = paragraphs[0]!.firstChild!
          return selection.toString()
        })
      const selected = await select()
      await page.waitForResponse((reply) => reply.url().endsWith('/chat/main/drafts'))
      assert({
        given: 'selected draft text spanning paragraphs across a poll',
        should: 'retain the text nodes and selection',
        actual: await body.evaluate((element) => [
          window.getSelection()?.toString(),
          element.querySelector('p')!.firstChild === (window as unknown as { draftTextNode: Node }).draftTextNode,
        ]),
        expected: [selected, true],
      })
      await page.evaluate(() => window.getSelection()?.removeAllRanges())
      const first = await body.locator('p').first().boundingBox()
      const second = await body.locator('p').nth(1).boundingBox()
      if (!first || !second) throw new Error('Draft paragraphs have no layout')
      await page.mouse.move(first.x + 3, first.y + first.height / 2)
      await page.mouse.down()
      await page.mouse.move(second.x + 90, second.y + 10, { steps: 5 })
      await page.waitForResponse((reply) => reply.url().endsWith('/chat/main/drafts'))
      await page.mouse.move(second.x + 200, second.y + 10, { steps: 3 })
      await page.mouse.up()
      assert({
        given: 'a selection drag spanning a background refresh',
        should: 'keep a range across paragraphs',
        actual: await page.evaluate(() => (window.getSelection()?.toString().length ?? 0) > 20),
        expected: true,
      })

      await card.getByRole('button', { name: 'Edit', exact: true }).click()
      await card.getByLabel('Edit draft text', { exact: true }).fill(EDITED_DRAFT)
      await card
        .getByLabel('Why I changed this (optional)', { exact: true })
        .fill('State the action and timing explicitly.')
      await card.getByRole('button', { name: 'Save edit', exact: true }).click()
      await body.getByText('The Atlas draft is ready. Please review it by Friday.', { exact: true }).waitFor()
      await host.writingDrafts.idle()
      await card.getByRole('button', { name: 'Undo', exact: true }).click()
      await body
        .getByText('The Atlas draft is ready. Please review it with the launch team.', { exact: true })
        .waitFor()
      await card.getByRole('button', { name: /^Versions/ }).click()
      const comparison = card.getByRole('region', { name: 'Changes if restored', exact: true })
      const diff = comparison.locator('.sky-writing-draft-diff')
      await comparison.getByText('Current version 3 → Version 2', { exact: true }).waitFor()
      assert({
        given: 'Versions is expanded after an undo',
        should: 'report its expanded state and compare the previous version with the current draft by default',
        actual: [
          await card.getByRole('button', { name: /^Versions/ }).getAttribute('aria-expanded'),
          await diff.evaluate((element) =>
            ['ins', 'del'].map((tag) => {
              const copy = element.cloneNode(true) as HTMLElement
              copy.querySelectorAll(tag).forEach((change) => change.remove())
              return copy.textContent
            }),
          ),
          (await diff.locator('ins').count()) > 0 && (await diff.locator('del').count()) > 0,
        ],
        expected: ['true', [ORIGINAL_DRAFT, EDITED_DRAFT], true],
      })
      const selectedDiff = await diff.evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        window.getSelection()!.removeAllRanges()
        window.getSelection()!.addRange(range)
        return window.getSelection()!.toString()
      })
      await page.waitForResponse((reply) => reply.url().endsWith('/chat/main/drafts'))
      assert({
        given: 'selected comparison text across a background refresh',
        should: 'keep the selection intact',
        actual: await page.evaluate(() => window.getSelection()?.toString()),
        expected: selectedDiff,
      })
      await page.evaluate(() => window.getSelection()?.removeAllRanges())
      if (screenshots) await card.screenshot({ path: path.join(screenshots, 'versions.png') })
      await card.getByLabel('Version history', { exact: true }).click()
      await page.getByRole('option', { name: 'Version 2 · You', exact: true }).click()
      await card.getByRole('button', { name: 'Restore this version', exact: true }).click()
      await body.getByText('The Atlas draft is ready. Please review it by Friday.', { exact: true }).waitFor()
      await card.getByRole('button', { name: /^Versions/ }).click()

      const composer = page.locator('.sky-split-main').getByPlaceholder('Message sky…')
      await composer.fill('Keep this unsent main-chat message.')
      await card.getByRole('button', { name: 'Work on this…', exact: true }).click()
      const panel = page.getByRole('complementary', { name: 'Thread', exact: true })
      await panel.getByRole('heading', { name: 'Draft discussion', exact: true }).waitFor()
      const replyComposer = panel.getByPlaceholder('What would you like to change?')
      await replyComposer.fill('Make this warmer; I want the request to feel appreciative.')
      await replyComposer.press('Enter')
      await body
        .getByText('The Atlas draft is ready. I would appreciate your review by Friday.', { exact: true })
        .waitFor()
      await panel.getByRole('button', { name: 'Use this version', exact: true }).click()
      await host.writingDrafts.idle()
      const record = ((await (await app.request('/chat/main/drafts')).json()) as { drafts: { id: string }[] })
        .drafts[0]!
      assert({
        given: 'a revision requested in the draft’s reply thread',
        should:
          'update the single main draft without consuming its composer or treating an unaccepted proposal as the owner’s writing',
        actual: [
          await composer.inputValue(),
          await page.locator('.sky-split-main .sky-writing-draft').count(),
          currentDraftVersion(await host.writingDrafts.require(record.id)).text,
        ],
        expected: ['Keep this unsent main-chat message.', 1, WARM_DRAFT],
      })
      await panel.getByRole('button', { name: 'Close thread', exact: true }).click()
      await card.getByRole('button', { name: 'Use this version', exact: true }).waitFor({ state: 'hidden' })

      if (screenshots) {
        await page.screenshot({ path: path.join(screenshots, 'desktop.png'), fullPage: true })
      }
      await card.getByRole('button', { name: 'Edit', exact: true }).click()
      const unsaved = `${WARM_DRAFT}\n\nMy unsaved closing.`
      await card.getByLabel('Edit draft text', { exact: true }).fill(unsaved)
      const before = await host.writingDrafts.require(record.id)
      await host.writingDrafts.revise(record.id, before.revision, `${WARM_DRAFT}\n\nA newer revision.`, 'sky')
      await card
        .getByText('A newer version was saved while you were editing. Your text is still here.', { exact: true })
        .waitFor()
      await page.reload()
      await card.getByLabel('Edit draft text', { exact: true }).waitFor()
      assert({
        given: 'a newer server revision and then a page reload during an edit',
        should: 'restore the owner’s unsaved text and refuse a stale save',
        actual: [
          await card.getByLabel('Edit draft text', { exact: true }).inputValue(),
          await card.getByRole('button', { name: 'Save edit', exact: true }).isDisabled(),
        ],
        expected: [unsaved, true],
      })
      const closed = await app.request('/chat/main/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ save: true }),
      })
      const saved = ((await closed.json()) as { saved: { path: string } }).saved
      const opened = await app.request('/chat/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: path.relative(root, saved.path) }),
      })
      const reopenedId = ((await opened.json()) as { id: string }).id
      await page.goto(`${base}/thread/${reopenedId}`)
      await card.getByLabel('Edit draft text', { exact: true }).waitFor()
      assert({
        given: 'the saved chat is reopened with a different runtime ID',
        should: 'restore the same draft’s unsaved edit by its stable identity',
        actual: await card.getByLabel('Edit draft text', { exact: true }).inputValue(),
        expected: unsaved,
      })
      await card.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.setViewportSize({ width: 390, height: 844 })
      await page.waitForFunction(() => document.querySelector('.sky-side')!.getBoundingClientRect().right <= 0)
      await body.getByText('A newer revision.', { exact: true }).waitFor()
      await card.getByRole('button', { name: /^Versions/ }).click()
      await card.getByRole('region', { name: 'Changes if restored', exact: true }).waitFor()
      assert({
        given: 'the same draft on a phone viewport',
        should: 'fit without horizontal scrolling or browser errors',
        actual: await page.evaluate(() => [
          document.documentElement.scrollWidth <= window.innerWidth,
          document.querySelector('.sky-writing-draft')!.scrollWidth <=
            document.querySelector('.sky-writing-draft')!.clientWidth,
        ]),
        expected: [true, true],
      })
      if (screenshots) await page.screenshot({ path: path.join(screenshots, 'mobile.png'), fullPage: true })
      if (screenshots) await card.screenshot({ path: path.join(screenshots, 'versions-mobile.png') })
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.waitForFunction(() => document.documentElement.getAttribute('data-mantine-color-scheme') === 'dark')
      if (screenshots) await page.screenshot({ path: path.join(screenshots, 'dark.png'), fullPage: true })
      if (screenshots) await card.screenshot({ path: path.join(screenshots, 'versions-dark.png') })
      assert({
        given: 'the full edit and discussion workflow',
        should: 'run without client exceptions',
        actual: errors,
        expected: [],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await host.writingDrafts.idle()
      await rm(root, { recursive: true, force: true })
    }
  },
)
