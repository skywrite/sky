import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import { attentionQueue } from '#lib/outbox/attentionQueue.ts'
import { OutboxReview } from '#lib/outbox/review.ts'
import { SavedMessages } from '#lib/outbox/sources.ts'
import { createOutboxStorage } from '#lib/outbox/storage.ts'
import { OutboxStore } from '#lib/outbox/store.ts'
import { SAMPLE, sampleOutboxItem } from '#lib/writingVoice/testHelpers.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { EDITED_DRAFT, writingDraftTestHost } from './chat/draftsTestHelpers.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'
import { createWritingVoiceRoutes } from './settings/writingVoice.ts'

const FIRST_REASON = 'Make the requested action explicit.'
const SECOND_REASON = 'This wording only fits this situation.'

test(
  {
    name: 'Writing voice learns from drafts in Outbox, Settings and Chat through clickable answers, then folds the lessons into the rules',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 90000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-writing-voice-browser-'))
    const host = writingDraftTestHost(root)
    const drafts = host.writingDrafts
    const storage = createOutboxStorage({ DIR_BASE: root, DIR_STATE: path.join(root, 'data', 'state') })
    const store = new OutboxStore(storage.dir, storage.dir, drafts.voice.store, drafts, storage.initialize)
    const sources = new SavedMessages(root, { Slack: [], Email: [] })
    const { revision: _revision, ...item } = sampleOutboxItem()
    await store.put(item, null)
    const review = new OutboxReview(
      store,
      sources,
      async () => {
        throw new Error('No native writes in this test')
      },
      () => '2025-03-15 12:00',
    )
    const app = new Hono()
    app.route('/settings/_api/writing-voice', createWritingVoiceRoutes(drafts))
    let writingProfile = 'default-fable-5.1-high'
    app.get('/settings/_api/settings', (c) =>
      c.json({
        theme: 'light',
        textSize: 'default',
        writingVoice: {
          profile: writingProfile,
          choices: [
            { value: 'default-fable-5.1-high', label: 'Claude Fable 5.1 - High' },
            { value: 'sample-writer', label: 'Sample writer' },
          ],
        },
      }),
    )
    app.post('/settings/_api/set', async (c) => {
      const { key, value } = await c.req.json()
      if (key !== 'ai.writingVoiceProfile' || !['default-fable-5.1-high', 'sample-writer'].includes(value))
        return c.json({ message: 'Unknown setting or model' }, 400)
      writingProfile = value
      return c.json({ ok: true })
    })
    app.route(
      '/',
      createTestHttpApp([path.join(root, 'time'), path.join(root, 'me')], {
        chat: host,
        outbox: {
          report: async () => ({
            ...attentionQueue((await store.list()).filter((record) => record.status !== 'dismissed')),
            done: [],
            preferences: await store.preferences(),
            automation: { name: 'outbox', status: 'paused' },
            lastScan: null,
          }),
          get: (id) => store.get(id),
          changeDraft: (id, revision, mutation) => store.changeDraft(id, revision, mutation),
          setup: async () => ({}),
          scan: async () => ({ outcome: 'nothing' }),
          save: (id, revision, draft) => review.save(id, revision, draft),
          approve: (id, revision, draft, changes) => review.approve(id, revision, draft, changes),
          dismiss: (id, revision) => review.dismiss(id, revision),
          preferences: (text, revision) => store.savePreferences(text, revision),
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
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const base = `http://127.0.0.1:${address.port}`
      await page.goto(`${base}/outbox?item=${item.id}`)
      const reply = page.locator('.sky-outbox-column .sky-writing-draft').first()
      await reply.getByRole('button', { name: 'Edit', exact: true }).click()
      await reply.getByLabel('Edit draft text').fill(SAMPLE.revised)
      await reply.getByRole('button', { name: 'Save edit', exact: true }).click()
      await page.getByRole('button', { name: FIRST_REASON, exact: true }).click()
      await page.getByText(`Learned: ${FIRST_REASON}`, { exact: true }).waitFor()
      await drafts.idle()
      const outboxDraft = await drafts.require((await store.get(item.id))!.draftId!)
      assert({
        given: 'an Outbox reply edited without a reason, and one click on the reason Sky offered',
        should: 'keep the exact pair, the question, the chosen reason and the lesson on the draft’s own version',
        actual: [
          outboxDraft.versions.map((version) => version.text),
          Boolean(outboxDraft.versions[1]!.question),
          outboxDraft.versions[1]!.answer,
          outboxDraft.versions[1]!.lesson?.text,
        ],
        expected: [[SAMPLE.original, SAMPLE.revised], true, FIRST_REASON, FIRST_REASON],
      })

      await page.getByRole('button', { name: 'Your voice', exact: true }).click()
      await page.locator('summary').filter({ hasText: 'Writing model' }).click()
      await page.getByRole('combobox', { name: 'Model configuration', exact: true }).click()
      const savedModel = page.waitForResponse(
        (response) => response.url().endsWith('/settings/_api/set') && response.request().method() === 'POST',
      )
      await page.getByRole('option', { name: 'Sample writer', exact: true }).click()
      await savedModel
      await page.reload()
      await page.locator('summary').filter({ hasText: 'Writing model' }).click()
      assert({
        given: 'a model chosen in Writing style settings',
        should: 'write the dedicated setting and retain the selection after reload',
        actual: [
          writingProfile,
          await page.getByRole('combobox', { name: 'Model configuration', exact: true }).inputValue(),
        ],
        expected: ['sample-writer', 'Sample writer'],
      })
      await page.getByLabel('What do you want to say?', { exact: true }).fill(SAMPLE.original)
      await page.getByRole('button', { name: 'Draft in my voice', exact: true }).click()
      await page.getByLabel('Revise the draft', { exact: true }).fill(`${SAMPLE.revised} Thank you.`)
      await page.getByRole('button', { name: 'Learn from this revision', exact: true }).click()
      await page.getByRole('button', { name: 'Write my own', exact: true }).click()
      await page
        .getByLabel('What would you like Sky to learn?', { exact: true })
        .fill('Use direct openings for short updates; keep introductions in letters.')
      await page.getByRole('button', { name: 'Save answer', exact: true }).click()
      await page
        .getByText('Learned: Use direct openings for short updates; keep introductions in letters.', { exact: true })
        .waitFor()
      const screenshot = env.get('SKY_BROWSER_SCREENSHOT')
      if (screenshot) await page.screenshot({ path: screenshot, fullPage: true })
      await page.getByRole('button', { name: 'Fold lessons into my rules', exact: true }).click()
      await page.getByText('2 lessons folded into your writing rules.', { exact: true }).waitFor()
      await page.reload()
      await page.getByLabel('Your writing rules', { exact: true }).waitFor()
      const rulesText = await page.getByLabel('Your writing rules', { exact: true }).inputValue()
      assert({
        given: 'lessons taught from two surfaces and folded in by hand',
        should: 'hold both scoped lessons in the rules after reload, read none from the drafts, and keep both drafts',
        actual: [
          (await drafts.learning.edits()).length,
          rulesText.includes(FIRST_REASON),
          rulesText.includes('keep introductions in letters.'),
          (await drafts.ids()).length,
          (await drafts.require(outboxDraft.id)).versions[1]!.folded,
        ],
        expected: [0, true, true, 2, true],
      })

      const sent = await page.request.post(`${base}/chat/main/messages`, {
        data: { message: 'Draft an email to Jane.', profile: 'test-thread-model', contextTokens: 0, saves: true },
      })
      if (!sent.ok() || (await sent.text()).includes('event: error')) throw new Error(await sent.text())
      await page.goto(`${base}/thread/main`)
      const frame = page.locator('.sky-split-main .sky-writing-draft').first()
      await frame.getByRole('button', { name: 'Edit', exact: true }).click()
      await frame.getByLabel('Edit draft text', { exact: true }).fill(EDITED_DRAFT)
      await frame.getByRole('button', { name: 'Save edit', exact: true }).click()
      await page.getByRole('button', { name: 'Write my own', exact: true }).waitFor()
      const selected = await page.evaluate(() => {
        const paragraphs = document.querySelectorAll('.sky-writing-questions .sky-writing-change p')
        const range = document.createRange()
        range.setStart(paragraphs[0].firstChild!, 0)
        range.setEnd(paragraphs[1].firstChild!, paragraphs[1].textContent!.length)
        const selection = window.getSelection()!
        selection.removeAllRanges()
        selection.addRange(range)
        return selection.toString()
      })
      await page.waitForResponse((response) => response.url().endsWith('/chat/main/drafts'))
      assert({
        given: 'a selected range spanning the changed excerpts during chat polling',
        should: 'preserve selection through unrelated refreshes',
        actual: await page.evaluate(() => window.getSelection()?.toString()),
        expected: selected,
      })
      await page.setViewportSize({ width: 390, height: 844 })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
      await page.getByRole('button', { name: SECOND_REASON, exact: true }).click()
      await page.getByText(`Learned: ${SECOND_REASON}`, { exact: true }).waitFor()
      await drafts.idle()
      assert({
        given: 'the question under a chat draft’s frame on a phone-sized screen',
        should: 'remain usable and save the selected answer on that draft without browser errors',
        actual: [overflow, (await drafts.learning.edits())[0]?.answer, errors],
        expected: [false, SECOND_REASON, []],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await drafts.idle()
      await rm(root, { recursive: true, force: true })
    }
  },
)
