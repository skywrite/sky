import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { chromium } from 'playwright'
import { hash } from '#lib/outbox/files.ts'
import { reconcileFollowups } from '#lib/outbox/followups.ts'
import { OutboxReview } from '#lib/outbox/review.ts'
import { SavedMessages } from '#lib/outbox/sources.ts'
import { OutboxStore } from '#lib/outbox/store.ts'
import { OutboxError } from '#lib/outbox/types.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { resolveTimeRef } from '#shared/nbfs/timeRef.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'

const NOW = '2025-03-15 14:00'
const REPLY = 'I’ll ask Casey Example to share the weekly update in the channel.'
const FOLLOWUP = 'Casey, please share the weekly update in the channel so the group can see it.'

test(
  {
    name: 'Outbox approval exposes a linked follow-up that remains editable across reload and parent archive',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-followup-browser-'))
    const store = new OutboxStore(path.join(root, 'outbox'), path.join(root, 'state'))
    const sources = new SavedMessages(root, { Slack: [], Email: [] })
    const ref = '2025-03-15/actions/messages/slack_Atlas.md'
    const file = path.join(root, resolveTimeRef(ref))
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(
      file,
      new Document(
        {
          from: 'Jane Doe',
          to: 'Alex Example',
          medium: 'Slack',
          link: 'https://atlas.slack.com/archives/C012ABCDEF/p1700000000000100',
        },
        'Can the group see the weekly update?',
      ).toMarkdown(),
    )
    const conversation = (await sources.conversation(ref))!
    const parent = await store.put(
      {
        id: hash(conversation.key).slice(0, 32),
        created: NOW,
        updated: NOW,
        status: 'needs_review',
        conversation,
        title: 'Reply to Jane about the weekly update',
        situation: 'Jane asked to share the weekly update with the group.',
        reasoning: 'A reply is needed.',
        questions: [],
        originalDraft: 'I’ll ask Morgan Example to share it.',
        draft: 'I’ll ask Morgan Example to share it.',
        edited: false,
        stale: false,
        reviews: [],
        native: null,
        placementError: null,
      },
      null,
    )
    let nativeWrites = 0
    let refusePreflight = true
    let releaseFollowups!: () => void
    const followupWait = new Promise<void>((resolve) => {
      releaseFollowups = resolve
    })
    let followupRun: Promise<unknown> | undefined
    const planned: string[] = []
    const review = new OutboxReview(
      store,
      sources,
      async () => {
        nativeWrites++
        return { id: 'native-draft', url: 'https://example.com/draft' }
      },
      () => NOW,
      async () => {
        if (refusePreflight) {
          refusePreflight = false
          throw new OutboxError('An existing Slack draft needs review before this reply can be saved.')
        }
      },
      undefined,
      async ({ reply }) => {
        planned.push(reply)
        if (planned.length === 1) {
          await followupWait
          throw new Error('The follow-up model could not finish. Try again.')
        }
        return [
          {
            recipient: 'Casey Example',
            commitment: REPLY,
            title: 'Ask Casey to share the weekly update',
            situation: 'Your reply to Jane calls for a separate message to Casey.',
            draft: FOLLOWUP,
          },
        ]
      },
    )
    const app = createTestHttpApp([path.join(root, 'time'), path.join(root, 'outbox')], {
      chat: {
        createSession: async () => {
          throw new Error('No chat fixture')
        },
        timeDir: path.join(root, 'time'),
      },
      outbox: {
        report: async () => {
          for (const item of await store.list()) await reconcileFollowups(store, item)
          return {
            items: (await store.list()).filter((item) => item.status !== 'dismissed'),
            done: [],
            preferences: await store.preferences(),
            automation: { name: 'outbox', status: 'paused' },
            lastScan: null,
          }
        },
        setup: async () => ({}),
        scan: async () => ({ outcome: 'nothing' }),
        get: (id) => store.get(id),
        save: (id, revision, draft) => review.save(id, revision, draft),
        approve: async (id, revision, draft, changes) => {
          const item = await review.approve(id, revision, draft, changes)
          followupRun = review.completeFollowups(id)
          return item
        },
        retryFollowups: async (id, revision) => {
          const item = await review.retryFollowups(id, revision)
          followupRun = review.completeFollowups(id)
          return item
        },
        dismiss: (id, revision) => review.dismiss(id, revision),
        reportSent: (id, revision, evidence) => review.reportSent(id, revision, evidence),
        preferences: (text, revision) => store.savePreferences(text, revision),
      },
    })
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing server address')
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const base = `http://127.0.0.1:${address.port}/outbox`
      await page.goto(base)
      await page.getByRole('link', { name: parent.title, exact: true }).click()
      await page.getByLabel('Reply draft', { exact: true }).fill(REPLY)
      await page.getByRole('button', { name: 'Approve draft in Slack', exact: true }).click()
      await page
        .getByRole('alert')
        .getByText('An existing Slack draft needs review before this reply can be saved.', { exact: true })
        .waitFor()
      await page.waitForFunction(() => {
        const box = document.querySelector('[role="alert"]')?.getBoundingClientRect()
        return box && box.top >= 0 && box.bottom <= window.innerHeight
      })
      assert({
        given: 'Slack preflight refuses the placement',
        should: 'show the error next to the clicked action before any model call or native write',
        actual: [nativeWrites, planned.length],
        expected: [0, 0],
      })
      const approvedResponse = page.waitForResponse(
        (response) => response.url().endsWith('/approve') && response.status() === 200,
      )
      await page.getByRole('button', { name: 'Approve draft in Slack', exact: true }).click()
      await approvedResponse
      await page.getByText('Draft saved in Slack. Preparing follow-up drafts…', { exact: true }).waitFor()
      assert({
        given: 'a slow follow-up model after native approval',
        should: 'show confirmed Slack placement while the model is still running',
        actual: [nativeWrites, (await store.get(parent.id))?.status],
        expected: [1, 'ready'],
      })
      await page.goto(base)
      await page.getByRole('tab', { name: /^Ready/ }).click()
      await page.getByRole('link', { name: parent.title, exact: true }).click()
      await page.getByText('Draft saved in Slack. Preparing follow-up drafts…', { exact: true }).waitFor()
      releaseFollowups()
      await followupRun
      await page.getByRole('button', { name: 'Retry follow-up drafts', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Retry follow-up drafts', exact: true }).click()
      await page
        .getByText('Draft saved in Slack. Added a draft for Casey Example to Outbox.', { exact: true })
        .waitFor()
      await page.getByRole('link', { name: 'Message to Casey Example ↗', exact: true }).click()
      await page.getByRole('heading', { name: 'Ask Casey to share the weekly update', exact: true }).waitFor()
      assert({
        given: 'the owner approves edited wording and opens the generated follow-up',
        should: 'show its actual draft, recipient, original approved reply, and separate review state',
        actual: [
          await page.getByLabel('Reply draft', { exact: true }).inputValue(),
          await page.getByText(REPLY, { exact: true }).count(),
          nativeWrites,
          planned,
        ],
        expected: [FOLLOWUP, 1, 1, [REPLY, REPLY]],
      })
      await page
        .getByLabel('Reply draft', { exact: true })
        .fill('Casey, please put the weekly update in the shared channel.')
      await page.getByRole('button', { name: 'Save edit', exact: true }).click()
      await page.getByRole('link', { name: `${parent.title} ↗`, exact: true }).click()
      await page.getByRole('button', { name: 'Record that I sent it', exact: true }).click()
      await page
        .getByRole('textbox', { name: 'Where and when did you send it?' })
        .fill('Sent the approved reply in Slack just now.')
      await page.getByRole('button', { name: 'Save sent report', exact: true }).click()
      await page.getByRole('link', { name: 'Ask Casey to share the weekly update', exact: true }).waitFor()
      await page.reload()
      await page.getByRole('link', { name: 'Ask Casey to share the weekly update', exact: true }).click()
      assert({
        given: 'a sent report for the original reply and a browser reload',
        should: 'retain one follow-up, its saved edit, and a single native placement',
        actual: [
          await page.getByLabel('Reply draft', { exact: true }).inputValue(),
          (await store.list()).length,
          planned.length,
          nativeWrites,
        ],
        expected: ['Casey, please put the weekly update in the shared channel.', 2, 2, 1],
      })
      const screenshot = env.get('SKY_BROWSER_SCREENSHOT')
      if (screenshot) await page.screenshot({ path: screenshot, fullPage: true })
      await page.getByRole('link', { name: `${parent.title} ↗`, exact: true }).click()
      await page.getByText('You recorded this message as sent.', { exact: true }).waitFor()
      await page.goto(`${base}?item=${parent.id}`)
      await page.getByText('You recorded this message as sent.', { exact: true }).waitFor()
      assert({
        given: 'the original reply is archived',
        should: 'still open its context through both the follow-up and its direct link without browser errors',
        actual: errors,
        expected: [],
      })
    } finally {
      releaseFollowups()
      await followupRun?.catch(() => {})
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
