import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { chromium } from 'playwright'
import { hash } from '#lib/outbox/files.ts'
import { OutboxReview } from '#lib/outbox/review.ts'
import { SavedMessages } from '#lib/outbox/sources.ts'
import { OutboxStore } from '#lib/outbox/store.ts'
import type { OutboxRecord } from '#lib/outbox/types.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { resolveTimeRef } from '#shared/nbfs/timeRef.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'

const NOW = '2025-03-15 14:00'
const FIRST_EDIT = 'Thanks, Jane. The Atlas pilot can start with the smaller group.'
const FIRST_DIRECTION = 'Make the opening warmer and keep the pilot scope unchanged.'
const FIRST_RESULT = 'Thanks for checking, Jane! Let’s start the Atlas pilot with the smaller group.'
const SECOND_EDIT = 'Thanks for checking, Jane! Start the Atlas pilot with the smaller group, please.'
const SECOND_DIRECTION = 'Remove please and keep the warm opening.'
const SECOND_RESULT = 'Thanks for checking, Jane! Start the Atlas pilot with the smaller group.'
const RECONNECT_EDIT = 'Please start the Atlas pilot with the smaller group.'
const RECONNECT_DIRECTION = 'Remove please.'
const RECONNECT_RESULT = 'Start the Atlas pilot with the smaller group.'
const MODEL_ERROR = 'The reply writer is temporarily unavailable. Try again.'

function gate() {
  let release!: () => void
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  return { wait, release }
}

test(
  {
    name: 'Outbox revision saves working text and recovers across reloads, writer failure, and lost acknowledgement',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-revision-browser-'))
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
        'Should we start the Atlas pilot with the smaller group?',
      ).toMarkdown(),
    )
    const conversation = (await sources.conversation(ref))!
    const item = await store.put(
      {
        id: hash(conversation.key).slice(0, 32),
        created: NOW,
        updated: NOW,
        status: 'needs_review',
        conversation,
        title: 'Reply about the Atlas pilot',
        situation: 'Jane asked which group should start the pilot.',
        reasoning: 'The owner has chosen the smaller group.',
        questions: [],
        originalDraft: 'Start the pilot with the smaller group.',
        draft: 'Start the pilot with the smaller group.',
        edited: false,
        stale: false,
        reviews: [],
        native: null,
        placementError: null,
      },
      null,
    )
    const gates = [gate(), gate(), gate(), gate(), gate()]
    const submissions: { draft: string; instruction: string }[] = []
    let nativeWrites = 0
    const review = new OutboxReview(
      store,
      sources,
      async () => {
        nativeWrites++
        return { id: 'native-draft', url: 'https://example.com/draft' }
      },
      () => NOW,
      undefined,
      async ({ draft, instruction }) => {
        const index = submissions.length
        submissions.push({ draft, instruction })
        await gates[index].wait
        if (index === 1) throw new Error(MODEL_ERROR)
        return {
          action: 'draft',
          title: item.title,
          situation: item.situation,
          reasoning: 'The reply follows the owner’s instruction.',
          questions: [],
          draft: index === 0 ? FIRST_RESULT : index === 3 ? RECONNECT_RESULT : SECOND_RESULT,
        }
      },
    )
    let composition: OutboxRecord['composition']
    const runs: Promise<void>[] = []
    const decorate = (record: OutboxRecord): OutboxRecord => ({ ...record, composition })
    const app = createTestHttpApp([path.join(root, 'time'), path.join(root, 'outbox')], {
      chat: {
        createSession: async () => {
          throw new Error('No chat fixture')
        },
        timeDir: path.join(root, 'time'),
      },
      outbox: {
        report: async () => ({
          items: (await store.list()).map(decorate),
          preferences: await store.preferences(),
          automation: { name: 'outbox', status: 'paused' },
          lastScan: null,
        }),
        setup: async () => ({}),
        scan: async () => ({ outcome: 'nothing' }),
        get: async (id) => {
          const record = await store.get(id)
          return record ? decorate(record) : null
        },
        save: (id, revision, draft) => review.save(id, revision, draft),
        compose: async (id, revision, draft, instruction, changes) => {
          const saved = await review.prepareCompose(id, revision, draft, instruction)
          const job: NonNullable<OutboxRecord['composition']> = {
            id: `revision-${runs.length + 1}`,
            status: 'running',
            revision: saved.revision,
            submittedRevision: revision,
          }
          composition = job
          // Keep synthetic execution alive independently of the page that submitted it.
          runs.push(
            review.composePrepared(id, saved.revision, instruction, changes).then(
              () => {
                job.status = 'complete'
              },
              (error: Error) => {
                job.status = 'failed'
                job.error = error.message
              },
            ),
          )
          return decorate(saved)
        },
        approve: (id, revision, draft, changes) => review.approve(id, revision, draft, changes),
        dismiss: (id, revision) => review.dismiss(id, revision),
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
      const statuses: number[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('response', (response) => {
        if (response.url().endsWith('/compose')) statuses.push(response.status())
      })
      await page.goto(`http://127.0.0.1:${address.port}/outbox?item=${item.id}`)
      const draft = page.getByLabel('Reply draft', { exact: true })
      const direction = page.getByLabel('Direction for Sky', { exact: true })
      const compose = page.locator('.sky-outbox-compose')
      await compose.getByText('Instructions for Sky', { exact: true }).waitFor()
      await draft.fill(FIRST_EDIT)
      await direction.fill(FIRST_DIRECTION)
      const firstAccepted = page.waitForResponse((response) => response.url().endsWith('/compose'))
      await page.getByRole('button', { name: 'Revise with Sky', exact: true }).click()
      await firstAccepted
      const submitted = (await store.get(item.id))!
      assert({
        given: 'manual draft edits and revision instructions submitted while the writer is still running',
        should: 'persist both fields before returning acceptance',
        actual: [submitted.draft, submitted.replyDirections?.at(-1)?.text, composition?.status],
        expected: [FIRST_EDIT, FIRST_DIRECTION, 'running'],
      })
      await page.reload()
      await page.getByRole('button', { name: 'Sky is writing…', exact: true }).waitFor()
      assert({
        given: 'a page reload while Sky is revising the saved draft',
        should: 'recover the working text and instruction while the same job continues',
        actual: [await draft.inputValue(), await direction.inputValue(), runs.length],
        expected: [FIRST_EDIT, FIRST_DIRECTION, 1],
      })
      gates[0].release()
      await compose.getByText('Revised draft saved.', { exact: true }).waitFor()
      const completed = (await store.get(item.id))!
      assert({
        given: 'a revision completing after its submitting page reloads',
        should: 'show the persisted result in the editor without an extra save',
        actual: [await draft.inputValue(), completed.draft],
        expected: [FIRST_RESULT, FIRST_RESULT],
      })

      await draft.fill(SECOND_EDIT)
      await direction.fill(SECOND_DIRECTION)
      const secondAccepted = page.waitForResponse((response) => response.url().endsWith('/compose'))
      await page.getByRole('button', { name: 'Revise with Sky', exact: true }).click()
      await secondAccepted
      gates[1].release()
      await compose.getByRole('alert').filter({ hasText: MODEL_ERROR }).waitFor()
      const failed = (await store.get(item.id))!
      assert({
        given: 'a writer failure after the owner submits another edited draft',
        should: 'show the error beside the revision button and retain the owner’s saved work',
        actual: [failed.draft, failed.replyDirections?.at(-1)?.text, await direction.inputValue()],
        expected: [SECOND_EDIT, SECOND_DIRECTION, SECOND_DIRECTION],
      })
      await page.reload()
      await compose.getByRole('alert').filter({ hasText: MODEL_ERROR }).waitFor()
      assert({
        given: 'a reload after failed revision',
        should: 'restore the saved input and instruction for a retry',
        actual: [await draft.inputValue(), await direction.inputValue()],
        expected: [SECOND_EDIT, SECOND_DIRECTION],
      })
      const retryAccepted = page.waitForResponse((response) => response.url().endsWith('/compose'))
      await page.getByRole('button', { name: 'Revise with Sky', exact: true }).click()
      await retryAccepted
      gates[2].release()
      await compose.getByText('Revised draft saved.', { exact: true }).waitFor()
      const retried = (await store.get(item.id))!
      assert({
        given: 'a retry of a failed revision without changing the restored fields',
        should: 'use the saved revision, persist the generated draft, and never place a native draft',
        actual: [statuses, submissions, await draft.inputValue(), retried.draft, nativeWrites, errors],
        expected: [
          [202, 202, 202],
          [
            { draft: FIRST_EDIT, instruction: FIRST_DIRECTION },
            { draft: SECOND_EDIT, instruction: SECOND_DIRECTION },
            { draft: SECOND_EDIT, instruction: SECOND_DIRECTION },
          ],
          SECOND_RESULT,
          SECOND_RESULT,
          0,
          [],
        ],
      })

      let loseAcknowledgement = true
      let offline = false
      let lostAcknowledgementStatus: number | undefined
      const unavailableReads = new Set<string>()
      const readsFailed = gate()
      await page.route('**/outbox/_api/**', async (route) => {
        const pathname = new URL(route.request().url()).pathname
        if (loseAcknowledgement && pathname.endsWith('/compose')) {
          loseAcknowledgement = false
          offline = true
          const response = await route.fetch()
          lostAcknowledgementStatus = response.status()
          await route.abort('connectionreset')
          return
        }
        if (offline && route.request().method() === 'GET') {
          unavailableReads.add(pathname)
          if (unavailableReads.has('/outbox/_api/status') && unavailableReads.has(`/outbox/_api/item/${item.id}`))
            readsFailed.release()
          await route.abort('connectionrefused')
          return
        }
        await route.continue()
      })
      await draft.fill(RECONNECT_EDIT)
      await direction.fill(RECONNECT_DIRECTION)
      await page.getByRole('button', { name: 'Revise with Sky', exact: true }).click()
      await readsFailed.wait
      const unacknowledged = (await store.get(item.id))!
      assert({
        given: 'a lost compose acknowledgement followed by unavailable item and status reads',
        should: 'have saved the submitted text and launched exactly one revision before the connection failed',
        actual: [
          lostAcknowledgementStatus,
          unacknowledged.draft,
          unacknowledged.replyDirections?.at(-1)?.text,
          composition?.status,
          runs.length,
        ],
        expected: [202, RECONNECT_EDIT, RECONNECT_DIRECTION, 'running', 4],
      })
      const reconnectedStatus = page.waitForResponse(
        (response) => response.url().endsWith('/outbox/_api/status') && response.ok(),
      )
      offline = false
      await reconnectedStatus
      await page.getByRole('button', { name: 'Sky is writing…', exact: true }).waitFor()
      assert({
        given: 'network recovery while the unacknowledged revision is still running',
        should: 'reconnect the original editor without a page reload or duplicate submission',
        actual: [await draft.inputValue(), await direction.inputValue(), runs.length],
        expected: [RECONNECT_EDIT, RECONNECT_DIRECTION, 4],
      })
      gates[3].release()
      await page.waitForFunction(
        (expected) =>
          (document.querySelector('textarea[aria-label="Reply draft"]') as HTMLTextAreaElement)?.value === expected,
        RECONNECT_RESULT,
      )
      await compose.getByText('Revised draft saved.', { exact: true }).waitFor()
      const reconnected = (await store.get(item.id))!
      assert({
        given: 'completion of a revision whose POST acknowledgement never reached the browser',
        should: 'adopt the saved result in the original editor and enable another revision',
        actual: [
          await draft.inputValue(),
          reconnected.draft,
          await page.getByRole('button', { name: 'Revise with Sky', exact: true }).isEnabled(),
        ],
        expected: [RECONNECT_RESULT, RECONNECT_RESULT, true],
      })
      await direction.fill('Add a warm thank-you to Jane at the start.')
      const afterReconnectAccepted = page.waitForResponse((response) => response.url().endsWith('/compose'))
      await page.getByRole('button', { name: 'Revise with Sky', exact: true }).click()
      const afterReconnectResponse = await afterReconnectAccepted
      gates[4].release()
      await compose.getByText('Revised draft saved.', { exact: true }).waitFor()
      assert({
        given: 'another revision immediately after reconnecting to completed work',
        should: 'submit the recovered revision without a conflict and save the next result',
        actual: [
          afterReconnectResponse.status(),
          submissions.at(-1),
          await draft.inputValue(),
          (await store.get(item.id))?.draft,
          nativeWrites,
          errors,
        ],
        expected: [
          202,
          { draft: RECONNECT_RESULT, instruction: 'Add a warm thank-you to Jane at the start.' },
          SECOND_RESULT,
          SECOND_RESULT,
          0,
          [],
        ],
      })
      const screenshot = env.get('SKY_BROWSER_SCREENSHOT')
      if (screenshot) await page.screenshot({ path: screenshot, fullPage: true })
    } finally {
      for (const pending of gates) pending.release()
      await Promise.allSettled(runs)
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
