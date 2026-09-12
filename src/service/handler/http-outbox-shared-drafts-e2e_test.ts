import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import { OutboxReview } from '#lib/outbox/review.ts'
import { SavedMessages } from '#lib/outbox/sources.ts'
import { OutboxStore } from '#lib/outbox/store.ts'
import { currentDraftVersion } from '#lib/writingVoice/draftTypes.ts'
import { sampleOutboxItem } from '#lib/writingVoice/testHelpers.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { EDITED_DRAFT, ORIGINAL_DRAFT, WARM_DRAFT, writingDraftTestHost } from './chat/draftsTestHelpers.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'
import { createWritingVoiceRoutes } from './settings/writingVoice.ts'

test(
  {
    name: 'Outbox shares chat’s editor, discussion, learning, and version history without implicit delivery',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 90000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-shared-browser-'))
    const host = writingDraftTestHost(root)
    const drafts = host.writingDrafts
    const store = new OutboxStore(
      path.join(root, 'outbox'),
      path.join(root, 'outbox-state'),
      drafts.voice.store,
      drafts,
    )
    let nativeWrites = 0
    const review = new OutboxReview(
      store,
      new SavedMessages(root, { Slack: [], Email: [] }),
      async () => {
        nativeWrites++
        return { id: 'mock-native', url: 'https://example.com/draft' }
      },
      () => '2025-03-15 12:00 UTC',
    )
    const seed = {
      ...sampleOutboxItem(),
      origin: 'followup' as const,
      title: 'Review the Atlas rollout',
      draft: ORIGINAL_DRAFT,
      originalDraft: ORIGINAL_DRAFT,
    }
    seed.conversation.target = { medium: 'Email', account: 'jane@example.com', thread: 'mock-thread' }
    const item = await store.put(seed, null)
    const app = new Hono()
    app.get('/settings/_api/settings', (c) => c.json({ theme: 'system', textSize: 'default' }))
    app.route('/settings/_api/writing-voice', createWritingVoiceRoutes(drafts.voice))
    app.route(
      '/',
      createTestHttpApp([path.join(root, 'time'), path.join(root, 'me'), path.join(root, 'outbox')], {
        chat: host,
        outbox: {
          report: async () => ({
            items: (await store.list()).filter((record) => record.status !== 'dismissed'),
            preferences: await store.preferences(),
            automation: { name: 'outbox', status: 'paused' },
            lastScan: null,
          }),
          get: (id) => store.ensureDraft(id),
          changeDraft: (id, revision, mutation) => store.changeDraft(id, revision, mutation),
          setup: async () => ({}),
          scan: async () => ({ outcome: 'nothing' }),
          save: (id, revision, text) => review.save(id, revision, text),
          approve: (id, revision, text, changed) => review.approve(id, revision, text, changed),
          dismiss: (id, revision) => review.dismiss(id, revision),
          preferences: (text, revision) => store.savePreferences(text, revision),
        },
      }),
    )
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing server address')
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${address.port}/outbox?item=${item.id}`)
      const card = page.locator('.sky-outbox-column .sky-writing-draft').first()
      await card.getByRole('button', { name: 'Edit', exact: true }).click()
      await card.getByLabel('Edit draft text').fill(EDITED_DRAFT)
      await card.getByLabel('Why I changed this (optional)').fill('Include the agreed review date.')
      assert({
        given: 'an unsaved edit in the shared Outbox editor',
        should: 'hold delivery until the owner saves it',
        actual: await page.getByRole('button', { name: 'Approve draft in Gmail', exact: true }).isDisabled(),
        expected: true,
      })
      await card.getByRole('button', { name: 'Save edit', exact: true }).click()
      await card.locator('.sky-writing-draft-version').filter({ hasText: 'Version 2' }).waitFor()
      await drafts.idle()
      assert({
        given: 'an Outbox edit saved with an explanation',
        should: 'update the shared record and learn once without any native write',
        actual: [
          currentDraftVersion(await drafts.require(item.draftId!)).text,
          (await drafts.voice.store.list()).length,
          nativeWrites,
        ],
        expected: [EDITED_DRAFT, 1, 0],
      })

      await card.getByRole('button', { name: 'Ask Sky to revise', exact: true }).click()
      const panel = page.locator('.sky-reply-panel')
      await panel.getByRole('heading', { name: 'Draft discussion', exact: true }).waitFor()
      await panel
        .getByPlaceholder('Ask Sky to revise this draft…')
        .fill('Make it warmer while keeping the review date.')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await card
        .locator('.sky-writing-draft-body')
        .getByText('I would appreciate your review by Friday.', { exact: false })
        .waitFor()
      await drafts.idle()
      assert({
        given: 'a proposed revision from the Outbox draft discussion',
        should: 'update the same record and wait for acceptance before learning the revision',
        actual: [
          (await store.get(item.id))?.draftId,
          (await store.get(item.id))?.draft,
          (await drafts.voice.store.list()).length,
          nativeWrites,
        ],
        expected: [item.draftId, WARM_DRAFT, 1, 0],
      })
      await panel.getByRole('button', { name: 'Close thread', exact: true }).click()
      await card.getByRole('button', { name: 'Use this version', exact: true }).click()
      await card.locator('.sky-writing-draft-version').filter({ hasText: 'Accepted' }).waitFor()
      await drafts.idle()
      await card.getByRole('button', { name: 'Undo', exact: true }).click()
      await card.locator('.sky-writing-draft-version').filter({ hasText: 'Version 4' }).waitFor()
      await page.reload()
      await card.locator('.sky-writing-draft-version').filter({ hasText: 'Version 4' }).waitFor()
      assert({
        given: 'an accepted AI revision followed by Undo and a page reload',
        should: 'retain every version while leaving delivery untouched',
        actual: [
          (await drafts.require(item.draftId!)).versions.length,
          (await store.get(item.id))?.draft,
          (await drafts.voice.store.list()).length,
          nativeWrites,
        ],
        expected: [4, EDITED_DRAFT, 2, 0],
      })

      const body = card.locator('.sky-writing-draft-body')
      const selected = await body.evaluate((element) => {
        const paragraphs = element.querySelectorAll('p')
        const range = document.createRange()
        range.setStart(paragraphs[0]!.firstChild!, 0)
        range.setEnd(paragraphs[1]!.firstChild!, 20)
        const selection = window.getSelection()!
        selection.removeAllRanges()
        selection.addRange(range)
        return selection.toString()
      })
      await page.waitForResponse((response) => response.url().endsWith('/outbox/_api/status'))
      assert({
        given: 'a selection spanning draft paragraphs during Outbox polling',
        should: 'preserve the selection through refresh',
        actual: await page.evaluate(() => window.getSelection()?.toString()),
        expected: selected,
      })
      await card.getByRole('button', { name: 'Versions · 4', exact: true }).click()
      await card.getByRole('region', { name: 'Changes if restored' }).waitFor()
      const screenshots = env.get('SKY_DRAFT_SCREENSHOTS')
      if (screenshots) {
        await mkdir(screenshots, { recursive: true })
        await page.screenshot({ path: path.join(screenshots, 'outbox-desktop.png'), fullPage: true })
      }
      await page.setViewportSize({ width: 430, height: 950 })
      await page.reload()
      await card.locator('.sky-writing-draft-version').filter({ hasText: 'Version 4' }).waitFor()
      const hideDetails = page.getByRole('button', { name: 'Hide details', exact: true })
      if (await hideDetails.isVisible()) await hideDetails.click()
      const mobileEdit = card.getByRole('button', { name: 'Edit', exact: true })
      await mobileEdit.scrollIntoViewIfNeeded()
      const fits = await mobileEdit.evaluate((element) => {
        const box = element.getBoundingClientRect()
        return box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight
      })
      assert({
        given: 'the shared editor on a narrow screen',
        should: 'keep the controls on screen without horizontal overflow or client errors',
        actual: [
          fits,
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
          errors,
        ],
        expected: [true, true, []],
      })
      if (screenshots) await page.screenshot({ path: path.join(screenshots, 'outbox-mobile.png'), fullPage: true })
      await card.getByRole('button', { name: 'Ask Sky to revise', exact: true }).click()
      await panel.getByPlaceholder('Ask Sky to revise this draft…').waitFor()
      await panel.getByRole('button', { name: 'Close thread', exact: true }).click({ trial: true })
      const panelWithinLayout = await panel.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const layout = element.closest('.sky-outbox-layout')!.getBoundingClientRect()
        return (
          box.top >= layout.top && box.bottom <= layout.bottom + 1 && box.left >= 0 && box.right <= window.innerWidth
        )
      })
      assert({
        given: 'the draft discussion reopened on mobile',
        should: 'retain the conversation in an accessible panel',
        actual: [
          await panel.getByText('Make it warmer while keeping the review date.', { exact: true }).isVisible(),
          panelWithinLayout,
          nativeWrites,
        ],
        expected: [true, true, 0],
      })
      if (screenshots)
        await page.screenshot({ path: path.join(screenshots, 'outbox-mobile-discussion.png'), fullPage: true })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await drafts.idle()
      await rm(root, { recursive: true, force: true })
    }
  },
)
