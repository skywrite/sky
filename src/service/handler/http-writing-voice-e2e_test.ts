import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import { OutboxReview } from '#lib/outbox/review.ts'
import { SavedMessages } from '#lib/outbox/sources.ts'
import { OutboxStore } from '#lib/outbox/store.ts'
import { captureOutboxRevision } from '#lib/writingVoice/outbox.ts'
import { SAMPLE, sampleOutboxItem, voiceFixture } from '#lib/writingVoice/testHelpers.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'
import { createWritingVoiceRoutes } from './settings/writingVoice.ts'

test(
  {
    name: 'Writing voice learns from Outbox and Chat through clickable answers and compacts the shared examples',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const f = await voiceFixture()
    const store = new OutboxStore(path.join(f.root, 'outbox'), path.join(f.root, 'outbox-state'), f.store)
    const sources = new SavedMessages(f.root, { Slack: [], Email: [] })
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
    app.route('/settings/_api/writing-voice', createWritingVoiceRoutes(f.voice))
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
    app.get('/chat/voice-example', (c) =>
      c.json({
        turns: [
          { role: 'user', content: 'Draft a project update.' },
          { role: 'assistant', content: `> ${SAMPLE.original}` },
          { role: 'user', content: SAMPLE.revised },
        ],
        documents: 0,
        kept: 0,
        busy: true,
      }),
    )
    app.route(
      '/',
      createTestHttpApp([path.join(f.root, 'me'), path.join(f.root, 'outbox')], {
        outbox: {
          report: async () => ({
            items: await store.list(),
            preferences: await store.preferences(),
            automation: { name: 'outbox', status: 'paused' },
            lastScan: null,
          }),
          setup: async () => ({}),
          scan: async () => ({ outcome: 'nothing' }),
          save: async (id, revision, draft) => {
            const before = (await store.get(id))!
            const after = await review.save(id, revision, draft)
            const example = await captureOutboxRevision(f.voice, before, after)
            if (example) await f.voice.prepare(example.id)
            return after
          },
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
      await page.getByLabel('Reply draft', { exact: true }).fill(SAMPLE.revised)
      await page.getByRole('button', { name: 'Save edit', exact: true }).click()
      await page.getByRole('button', { name: 'I prefer stating the point directly in emails.', exact: true }).click()
      await page.getByText('Learned: I prefer stating the point directly in emails.', { exact: true }).waitFor()
      const outboxExample = (await f.store.list(`outbox:${item.id}`))[0]
      assert({
        given: 'a saved Outbox edit and one click on the reason',
        should: 'retain the exact pair and chosen explanation in the shared learning store',
        actual: [outboxExample.original, outboxExample.revised, outboxExample.answer],
        expected: [SAMPLE.original, SAMPLE.revised, 'I prefer stating the point directly in emails.'],
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
      await page.getByLabel('Revise the draft', { exact: true }).fill(SAMPLE.revised)
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
      await page.getByRole('button', { name: 'Compact learned examples', exact: true }).click()
      await page.getByText('2 examples compacted into your writing rules.', { exact: true }).waitFor()
      await page.reload()
      await page.getByLabel('Your writing rules', { exact: true }).waitFor()
      const rulesText = await page.getByLabel('Your writing rules', { exact: true }).inputValue()
      assert({
        given: 'examples taught from two surfaces and manual compaction',
        should: 'retain both scoped lessons after reload and remove the examples',
        actual: [
          (await f.store.list()).length,
          rulesText.includes('I prefer stating the point directly in emails.'),
          rulesText.includes('keep introductions in letters.'),
        ],
        expected: [0, true, true],
      })

      await f.voice.capture({ ...SAMPLE, source: 'chat:voice-example' })
      await page.goto(`${base}/thread/voice-example`)
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
      await page.waitForResponse((response) => response.url().includes('/writing-voice/examples?source='))
      assert({
        given: 'a selected range spanning the changed excerpts during chat polling',
        should: 'preserve selection through unrelated refreshes',
        actual: await page.evaluate(() => window.getSelection()?.toString()),
        expected: selected,
      })
      await page.setViewportSize({ width: 390, height: 844 })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
      await page.getByRole('button', { name: 'This recipient already knows the context.', exact: true }).click()
      await page.getByText('Learned: This recipient already knows the context.', { exact: true }).waitFor()
      assert({
        given: 'the question inside Chat on a phone-sized screen',
        should: 'remain usable and save the selected answer without browser errors',
        actual: [overflow, (await f.store.list('chat:voice-example'))[0].answer, errors],
        expected: [false, 'This recipient already knows the context.', []],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await f.dispose()
    }
  },
)
