import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { MockLanguageModelV4 } from 'ai/test'
import { chromium } from 'playwright'
import { readScanProgress } from '#lib/outbox/progress.ts'
import { OutboxReview } from '#lib/outbox/review.ts'
import { scanOutbox } from '#lib/outbox/scan.ts'
import { SavedMessages } from '#lib/outbox/sources.ts'
import { OutboxStore } from '#lib/outbox/store.ts'
import { createReplyComposer, createTriage } from '#lib/outbox/triage.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { resolveTimeRef } from '#shared/nbfs/timeRef.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTestScanExecution } from '../../test/scanExecution.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'
import { createScanJob } from './outbox/scanJob.ts'

const TODAY = '2025-03-15'
const NOW = `${TODAY} 14:00`

test(
  {
    name: 'Outbox prepares routine drafts and turns a selected decision into an editable reply before native handoff',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-drafting-browser-'))
    const store = new OutboxStore(path.join(root, 'outbox'), path.join(root, 'state'))
    const sources = new SavedMessages(root, { Slack: [], Email: [] })
    for (const [name, body, suffix] of [
      ['Choice', 'Which pilot scope should we choose?', '0100'],
      ['Routine', 'Can you clarify your feedback? The first-run instructions are the only open point.', '0200'],
    ]) {
      const file = path.join(root, resolveTimeRef(`${TODAY}/actions/messages/slack_${name}.md`))
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(
        file,
        new Document(
          {
            from: 'Jane Doe',
            to: 'Alex Example',
            medium: 'Slack',
            link: `https://atlas.slack.com/archives/C012ABCDEF/p170000000000${suffix}`,
          },
          body,
        ).toMarkdown(),
      )
    }
    const directions: { instruction: string; draft: string }[] = []
    const model = new MockLanguageModelV4({
      doGenerate: async ({ prompt }) => {
        const user = prompt.find((message) => message.role === 'user')!
        const input = JSON.parse(
          user.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join(''),
        )
        const composing = Boolean(input.ownerInstruction)
        if (composing) directions.push({ instruction: input.ownerInstruction, draft: input.currentDraft })
        const choice = !composing && input.conversation.sources[0].body.includes('scope')
        const reply = {
          action: choice ? 'decision' : 'draft',
          title: choice || composing ? 'Choose the pilot scope' : 'Clarify the feedback',
          situation:
            choice || composing
              ? 'Jane has two pilot scopes ready. The smaller scope validates the first-run flow sooner; the wider scope includes reporting.'
              : 'Jane asked which part of the update needs clarification.',
          explanation: choice ? 'The scope choice changes the next step.' : 'The reply follows the owner’s direction.',
          questions: choice ? ['Which pilot scope should we use?'] : [],
          recommendation: choice ? 'Start with the smaller pilot to validate the flow before expanding.' : '',
          replyOptions: choice
            ? [
                {
                  label: 'Choose the smaller pilot',
                  instruction: 'Choose the smaller pilot and explain that we can expand after validating it.',
                },
                { label: 'Keep the broader scope', instruction: 'Choose the broader pilot scope including reporting.' },
              ]
            : [],
          draft: choice
            ? ''
            : composing
              ? directions.length === 1
                ? 'Let’s start with the smaller pilot and expand after we validate the flow.'
                : 'Start small; expand after validation.'
              : 'I meant the first-run instructions. The rest looks good to me.',
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(reply) }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
          warnings: [],
        }
      },
    })
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
      createReplyComposer('I am Alex Example.', () => ({ model })),
    )
    const job = createScanJob(
      createTestScanExecution(
        async () =>
          scanOutbox({
            store,
            sources,
            today: TODAY,
            now: NOW,
            propose: createTriage('I am Alex Example.', () => ({ model })),
          }),
        () => readScanProgress(store),
      ),
      () => readScanProgress(store),
    )
    const app = createTestHttpApp([path.join(root, 'time'), path.join(root, 'outbox')], {
      chat: {
        createSession: async () => {
          throw new Error('No chat fixture')
        },
        timeDir: path.join(root, 'time'),
      },
      outbox: {
        report: async () => ({
          items: (await store.list()).filter((item) => item.status !== 'dismissed'),
          preferences: await store.preferences(),
          automation: { name: 'outbox', status: 'paused' },
          lastScan: null,
          check: await job.status(),
        }),
        scan: () => job.start(),
        setup: async () => ({}),
        save: (id, revision, draft) => review.save(id, revision, draft),
        compose: (id, revision, draft, instruction, changes) =>
          review.compose(id, revision, draft, instruction, changes),
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
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${address.port}/outbox`)
      await page.getByRole('button', { name: 'Check now', exact: true }).click()
      await page.getByText('I meant the first-run instructions. The rest looks good to me.', { exact: true }).waitFor()
      await page.getByRole('button').filter({ hasText: 'Choose the pilot scope' }).click()
      await page.getByRole('button', { name: 'Choose the smaller pilot', exact: true }).click()
      await page.getByLabel('Reply draft', { exact: true }).waitFor()
      const firstDraft = await page.getByLabel('Reply draft', { exact: true }).inputValue()
      await page.getByLabel('Reply draft', { exact: true }).fill('My unsaved wording about the smaller pilot.')
      await page.getByRole('button', { name: 'Shorter', exact: true }).click()
      await page.waitForFunction(
        () =>
          (document.querySelector('textarea[aria-label="Reply draft"]') as HTMLTextAreaElement)?.value ===
          'Start small; expand after validation.',
      )
      const screenshot = env.get('SKY_BROWSER_SCREENSHOT')
      if (screenshot) await page.screenshot({ path: screenshot, fullPage: true })
      assert({
        given: 'Check now, a selected response option, and an unsaved edit shortened with Sky',
        should: 'prepare useful text entirely in review before any native handoff',
        actual: [firstDraft, directions[0].instruction, directions[1].draft, nativeWrites, errors],
        expected: [
          'Let’s start with the smaller pilot and expand after we validate the flow.',
          'Choose the smaller pilot and explain that we can expand after validating it.',
          'My unsaved wording about the smaller pilot.',
          0,
          [],
        ],
      })
      await page.getByRole('button', { name: 'Approve draft in Slack', exact: true }).click()
      await page
        .getByText('Your draft is waiting in the app. You review and press Send there.', { exact: true })
        .waitFor()
      const approved = (await store.list()).find((item) => item.status === 'ready')!
      assert({
        given: 'explicit approval after reviewing the generated text',
        should: 'place exactly that text once',
        actual: [nativeWrites, approved.draft, approved.reviews[0].final],
        expected: [1, 'Start small; expand after validation.', 'Start small; expand after validation.'],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
