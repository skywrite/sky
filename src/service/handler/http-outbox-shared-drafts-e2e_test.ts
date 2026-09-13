import { mkdir, mkdtemp, rm } from 'node:fs/promises'
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
    const storage = createOutboxStorage({ DIR_BASE: root, DIR_STATE: path.join(root, 'data', 'state') })
    const store = new OutboxStore(storage.dir, storage.dir, drafts.voice.store, drafts, storage.initialize)
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
      situation:
        'Jane needs your approval of the **Atlas** rollout.\n\nChoose the scope before she prepares the pilot.',
      draft: ORIGINAL_DRAFT,
      originalDraft: ORIGINAL_DRAFT,
    }
    seed.conversation.target = { medium: 'Email', account: 'jane@example.com', thread: 'mock-thread' }
    const sourceRef = '2025-03-15/actions/messages/email_Atlas.md'
    const requestQuote = 'Please send the Atlas draft for review.'
    const resolutionQuote = 'The review date is confirmed.'
    seed.conversation.sources = [
      {
        ref: sourceRef,
        hash: 'mock-source',
        from: 'Jane Doe',
        to: 'Alex Example',
        body: `${requestQuote}\n\n${resolutionQuote}\n\n**Pilot scope**\n\n- Confirm the timing\n- Confirm the budget`,
      },
    ]
    const origin = {
      kind: 'message' as const,
      ref: sourceRef,
      message: 'mock-message',
      at: '2025-03-15 09:00',
      quote: requestQuote,
    }
    seed.requestIds = ['b'.repeat(32)]
    seed.requests = [
      {
        id: 'b'.repeat(32),
        summary: 'Send the Atlas draft',
        origin,
        status: 'open',
        explanation: 'The draft is ready to share.',
        context: '',
        evidence: [],
        resolution: null,
        present: true,
        reports: [],
      },
      {
        id: 'c'.repeat(32),
        summary: 'Confirm the review date',
        origin: { ...origin, quote: 'Can you confirm the review date?' },
        status: 'resolved',
        explanation: 'The owner confirmed the date.',
        context: '',
        evidence: [],
        resolution: { ...origin, quote: resolutionQuote },
        present: true,
        reports: [],
      },
    ]
    const legacy = new OutboxStore(path.join(root, 'outbox'), storage.dir, drafts.voice.store, drafts)
    const item = await legacy.put(seed, null)
    const app = new Hono()
    app.get('/settings/_api/settings', (c) => c.json({ theme: 'system', textSize: 'default' }))
    app.route('/settings/_api/writing-voice', createWritingVoiceRoutes(drafts.voice))
    app.route(
      '/',
      createTestHttpApp([path.join(root, 'time'), path.join(root, 'me')], {
        chat: host,
        outbox: {
          report: async () => ({
            ...attentionQueue((await store.list()).filter((record) => record.status !== 'dismissed')),
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
      const situation = page.locator('.sky-outbox-situation')
      await situation.locator('strong').waitFor()
      assert({
        given: 'a brief with paragraphs and emphasis',
        should: 'render readable text instead of literal Markdown or a single dense paragraph',
        actual: [await situation.locator('p').count(), await situation.locator('strong').textContent()],
        expected: [2, 'Atlas'],
      })
      const firstParagraph = (await situation.locator('p').first().boundingBox())!
      const lastParagraph = (await situation.locator('p').last().boundingBox())!
      await page.mouse.move(firstParagraph.x + 1, firstParagraph.y + 10)
      await page.mouse.down()
      await page.mouse.move(lastParagraph.x + lastParagraph.width - 1, lastParagraph.y + lastParagraph.height - 5, {
        steps: 10,
      })
      const dragging = await page.evaluate(() => window.getSelection()?.toString())
      await page.waitForResponse((response) => response.url().endsWith('/outbox/_api/status'))
      assert({
        given: 'a drag spanning brief paragraphs while background polling refreshes the view',
        should: 'preserve the selected text and its existing nodes',
        actual: [Boolean(dragging?.includes('Atlas')), await page.evaluate(() => window.getSelection()?.toString())],
        expected: [true, dragging],
      })
      await page.mouse.up()
      const beforeUpdate = (await store.get(item.id))!
      await store.put(
        {
          ...beforeUpdate,
          situation:
            'Jane needs your approval of the **revised Atlas** rollout.\n\nChoose the scope before she prepares the pilot.',
        },
        beforeUpdate.revision,
      )
      await situation.getByText('revised Atlas', { exact: true }).waitFor()
      const requests = page.locator('.sky-outbox-requests')
      await requests.locator('summary').click()
      assert({
        given: 'a conversation with one open ask and one resolved ask',
        should: 'show each request, its scope, and the exact resolution evidence',
        actual: [
          await requests.locator('section').count(),
          await requests.getByText('Included in this review', { exact: false }).count(),
          await requests.getByText('Resolved', { exact: false }).count(),
          await requests.getByText(resolutionQuote, { exact: true }).textContent(),
        ],
        expected: [2, 1, 1, resolutionQuote],
      })
      const selectedRequest = await requests
        .locator('blockquote')
        .first()
        .evaluate((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          const selection = window.getSelection()!
          selection.removeAllRanges()
          selection.addRange(range)
          return selection.toString()
        })
      await page.waitForResponse((response) => response.url().endsWith('/outbox/_api/status'))
      assert({
        given: 'source evidence selected while the request list refreshes',
        should: 'preserve the selection',
        actual: await page.evaluate(() => window.getSelection()?.toString()),
        expected: selectedRequest,
      })
      await requests.getByRole('button', { name: 'View source message', exact: true }).first().click()
      const sourceVisible = await page.evaluate((ref) => {
        const source = document.getElementById(`outbox-source-${ref}`)!
        const rail = source.closest('aside')!.getBoundingClientRect()
        const box = source.getBoundingClientRect()
        return box.top >= rail.top && box.top < rail.bottom
      }, sourceRef)
      assert({
        given: 'a request source link',
        should: 'bring its saved conversation into view',
        actual: sourceVisible,
        expected: true,
      })
      const sourceText = page.locator('.sky-outbox-message-body')
      assert({
        given: 'saved source messages with paragraphs, emphasis and a list',
        should: 'make the original conversation readable in the source rail',
        actual: [
          await sourceText.locator('p').count(),
          await sourceText.locator('strong').textContent(),
          await sourceText.locator('li').count(),
        ],
        expected: [3, 'Pilot scope', 2],
      })
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

      await card.getByRole('button', { name: 'Work on this…', exact: true }).click()
      const panel = page.locator('.sky-reply-panel')
      await panel.getByRole('heading', { name: 'Draft discussion', exact: true }).waitFor()
      await panel
        .getByPlaceholder('What would you like to change?')
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
      await card.getByRole('button', { name: 'Work on this…', exact: true }).click()
      await panel.getByPlaceholder('What would you like to change?').waitFor()
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
      const summary = 'Jane needs your choice of pilot scope before she prepares the rollout.'
      const legacyCard = await store.put(
        {
          ...seed,
          id: 'd'.repeat(32),
          title: '3 requests need a reply',
          summary,
          situation:
            '3 requests remain in this conversation. ' +
            'The detailed background belongs inside the conversation. '.repeat(20),
          recommendation: 'Long drafting instructions belong inside the review. '.repeat(20),
          draft: '',
          originalDraft: '',
          questions: ['Which scope should Jane use for the pilot?'],
          conversation: {
            ...seed.conversation,
            sources: [
              { ...seed.conversation.sources[0], body: '# Atlas pilot scope\n\n' + seed.conversation.sources[0].body },
            ],
          },
        },
        null,
      )
      for (const width of [1500, 430]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.goto(`http://127.0.0.1:${address.port}/outbox`)
        const row = page.locator('.sky-outbox-list-item').filter({ hasText: 'Atlas pilot scope' })
        await row.locator('.sky-outbox-card-summary').waitFor()
        assert({
          given: `a legacy count title, a dedicated summary and extensive analysis at ${width}px`,
          should: 'show the subject and short summary with a bounded preview, leaving the full analysis inside',
          actual: [
            await row.locator('.sky-outbox-row-content > strong').textContent(),
            await row.locator('.sky-outbox-card-summary').textContent(),
            await row.getByText('3 requests need a reply', { exact: true }).count(),
            await row.locator('.sky-outbox-row-suggestion').count(),
            (await row.boundingBox())!.height < 520,
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
          ],
          expected: ['Atlas pilot scope', summary, 0, 0, true, true],
        })
        if (screenshots)
          await page.screenshot({ path: path.join(screenshots, `outbox-list-${width}.png`), fullPage: true })
      }
      await page.goto(`http://127.0.0.1:${address.port}/outbox?item=${legacyCard.id}`)
      await page.getByRole('heading', { name: 'Atlas pilot scope', exact: true }).waitFor()
      assert({
        given: 'the same card opened for review',
        should: 'retain all of its context behind the concise list summary',
        actual: await page.locator('.sky-outbox-situation').textContent(),
        expected: legacyCard.situation,
      })
      const unchecked = await store.put(
        {
          ...seed,
          id: 'e'.repeat(32),
          origin: 'conversation',
          title: 'Consider answering a request to Sam',
          questions: ['Do you want to step in for Sam?'],
          recommendation: 'You could nudge Sam about this.',
        },
        null,
      )
      await page.goto(`http://127.0.0.1:${address.port}/outbox`)
      const awaitingTab = page.getByRole('tab', { name: 'Awaiting check 1' })
      await awaitingTab.waitFor()
      assert({
        given: 'an older scanner result whose ownership has not been checked',
        should: 'keep it out of the main review list',
        actual: await page.getByText(unchecked.title, { exact: true }).count(),
        expected: 0,
      })
      await awaitingTab.click()
      const pendingRow = page.locator('.sky-outbox-list-item').filter({ hasText: unchecked.title })
      await pendingRow.waitFor()
      assert({
        given: 'the separate list of results awaiting a check',
        should: 'avoid presenting an unverified draft or question as an owner decision',
        actual: await pendingRow.locator('.sky-outbox-preview').count(),
        expected: 0,
      })
      await page.goto(`http://127.0.0.1:${address.port}/outbox?item=${unchecked.id}`)
      await page.getByText('Awaiting the relevance check.', { exact: false }).waitFor()
      assert({
        given: 'an unchecked result opened directly',
        should: 'retain the earlier context without asking the owner its speculative question',
        actual: [
          await page.locator('.sky-outbox-questions').count(),
          await page.locator('.sky-outbox-recommendation').count(),
        ],
        expected: [0, 0],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await drafts.idle()
      await rm(root, { recursive: true, force: true })
    }
  },
)
