import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { chromium } from 'playwright'
import { hash } from '#lib/outbox/files.ts'
import { SavedMessages } from '#lib/outbox/sources.ts'
import { OutboxStore } from '#lib/outbox/store.ts'
import { createReportDelivery, type ReportDeliveryRecord } from '#lib/workstreams/delivery.ts'
import { createWorkstreamOutbox } from '#lib/workstreams/outbox.ts'
import { runWorkstream } from '#lib/workstreams/runner.ts'
import { WorkstreamStore } from '#lib/workstreams/store.ts'
import { ReportingSchema, WorkstreamSchema } from '#lib/workstreams/types.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'
import { outboxHref } from './theme/client/outboxRoutes.ts'

const NOW = '2025-03-15 12:00'
const FEEDBACK = 'Jane Doe confirms that the focused pilot is ready.'

test(
  {
    name: 'workstreams main app delegates work, delivers Slack reports, and keeps email reports in review',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 90000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-workstreams-agentic-e2e-'))
    const store = new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root, () =>
      NOW.slice(0, 10),
    )
    const outboxStore = new OutboxStore(path.join(root, 'outbox'), path.join(root, 'outbox-state'))
    const outbox = createWorkstreamOutbox({
      workstreams: store,
      store: outboxStore,
      sources: new SavedMessages(root, { Slack: [], Email: [] }),
      now: () => NOW,
    })
    const sent: ReportDeliveryRecord[] = []
    let clock = NOW
    let reports = 0
    const delivery = createReportDelivery({
      store,
      outbox,
      outboxStore,
      now: () => clock,
      transport: {
        send: async (record, authorize) => {
          await authorize()
          sent.push(record)
          return {
            id: 'slack1',
            medium: 'slack',
            url: 'https://atlas.slack.com/archives/C12345678/p1800000000123456',
          }
        },
      },
    })
    await writeFile(path.join(root, 'feedback.md'), FEEDBACK)
    let item = await store.create(
      WorkstreamSchema.parse({
        id: 'atlas',
        title: 'Launch the Atlas pilot',
        outcome: 'An agreed pilot scope supported by customer evidence.',
        created: NOW,
        updated: NOW,
        activities: [
          { id: 'scope', title: 'Prepare the pilot scope', executor: 'sky', state: 'ready' },
          { id: 'approval', title: 'Choose the pilot approach', kind: 'decision', state: 'ready' },
        ],
        sources: [
          { id: 'feedback', path: 'feedback.md', label: 'Pilot feedback', sensitive: false, stakeholderIds: ['jane'] },
        ],
        stakeholders: [{ id: 'jane', name: 'Jane Doe', role: 'Pilot lead' }],
        reporting: [
          {
            id: 'board',
            audience: 'Advisors',
            medium: 'slack',
            cadenceDays: 7,
            permittedSourceIds: ['feedback'],
            artifacts: ['Presentation', 'Loom'],
            allowSensitive: false,
          },
        ],
        proposals: [
          {
            id: 'coordination',
            kind: 'coordination',
            title: 'People and timing',
            reason: 'Details from the intention.',
            coordination: {
              stakeholders: [
                { name: 'Jane Doe', role: 'Pilot lead', basis: 'stated', reason: 'Named as the pilot lead.' },
              ],
              timeline: { due: '2025-04-01', basis: 'stated', reason: 'The requested pilot deadline.' },
            },
          },
        ],
      }),
      NOW,
    )
    const unavailable = async (): Promise<never> => {
      throw new Error('This action is outside the fixture.')
    }
    const app = createTestHttpApp(
      [path.join(root, 'workstreams'), path.join(root, 'time'), path.join(root, 'outbox')],
      {
        chat: { createSession: unavailable, timeDir: path.join(root, 'time') },
        workstreams: {
          store,
          now: () => clock,
          today: () => NOW.slice(0, 10),
          setup: async () => ({}),
          automation: async () => null,
          draft: unavailable,
          run: (id, request, trigger, reportingId) =>
            runWorkstream({
              store,
              id,
              request,
              trigger,
              reportingId,
              now: clock,
              reportDelivery: delivery,
              propose: unavailable,
              report: async (context) => {
                reports++
                const policy = ReportingSchema.parse(context.reporting)
                const ready =
                  policy.medium === 'email' || policy.attachments?.some((attachment) => attachment.name === 'Loom')
                return {
                  title: 'Atlas pilot update',
                  body:
                    policy.medium === 'email'
                      ? 'The pilot is ready for your review.'
                      : ready
                        ? 'The complete pilot update includes its recording and presentation.'
                        : 'The pilot update still needs its recording.',
                  missingInputs: ready ? [] : ['Record the Loom and provide its link.'],
                }
              },
            }),
          planDay: unavailable,
          reportDelivery: delivery,
        },
      },
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
      const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const modal = () => page.getByRole('dialog')
      await page.goto(`http://127.0.0.1:${address.port}/workstreams/${item.id}`)
      await page.getByRole('tab', { name: /^Work/ }).click()
      await page.locator('.sky-workstream-coordination').getByText('By 2025-04-01').waitFor()
      await page.getByRole('button', { name: 'Apply suggestion', exact: true }).click()
      await page.locator('.sky-workstream-coordination').waitFor({ state: 'hidden' })
      assert({
        given: 'a concrete coordination proposal accepted from the main app',
        should: 'apply its deadline through the real controller without inventing execution authority',
        actual: [(await store.get(item.id))!.due, (await store.getGrant(item.id)).mode],
        expected: ['2025-04-01', 'off'],
      })
      await page.getByRole('button', { name: 'Choose the pilot approach', exact: true }).click()
      await page.getByRole('button', { name: 'Who decides', exact: true }).click()
      await page.getByRole('combobox', { name: 'Decision responsibility', exact: true }).click()
      await page.getByRole('option', { name: 'Sky may decide within the boundaries below', exact: true }).click()
      await page
        .getByLabel('Context and boundaries', { exact: true })
        .fill('Choose the focused pilot only when its lead confirms readiness.')
      await page.getByRole('button', { name: '＋ Choice', exact: true }).click()
      await page.getByLabel('Choice', { exact: true }).fill('Proceed with the focused pilot')
      await page.getByRole('button', { name: '＋ Assumption', exact: true }).click()
      await page.getByLabel('Assumption', { exact: true }).fill('The pilot lead is ready.')
      await modal().getByLabel('Pilot feedback', { exact: true }).first().check()
      await page.getByRole('combobox', { name: 'What do we know?', exact: true }).click()
      await page.getByRole('option', { name: 'I confirm this assumption', exact: true }).click()
      await page.getByLabel('Required for this decision', { exact: true }).check()
      await modal().getByLabel('Pilot feedback', { exact: true }).last().check()
      await modal().getByLabel('Jane Doe', { exact: true }).check()
      await page.getByLabel('Minimum confidence (%)', { exact: true }).fill('95')
      await page.screenshot({ path: path.join(tmpdir(), 'sky-workstreams-decision-authority.png') })
      await page.getByRole('button', { name: 'Delegate this decision', exact: true }).click()
      await page.getByRole('heading', { name: 'Decisions Sky is handling', exact: true }).waitFor()
      item = (await store.get(item.id))!
      const permission = await store.getGrant(item.id)
      const assumption = item.activities.find((activity) => activity.id === 'approval')!.decisionAssumptions![0]!
      assert({
        given: 'a decision delegated through the real main-app route',
        should:
          'bind exact title, stakeholder input, confidence, and server-observed assumption evidence without enabling ongoing automation',
        actual: [
          permission.decisionPolicies.approval.mode,
          permission.decisionPolicies.approval.activityTitle,
          permission.decisionPolicies.approval.requiredStakeholderIds,
          permission.decisionPolicies.approval.minConfidence,
          assumption.status,
          assumption.sourceVersions.feedback,
          item.sky.mode,
        ],
        expected: ['delegate', 'Choose the pilot approach', ['jane'], 0.95, 'confirmed', hash(FEEDBACK), 'off'],
      })

      await page.getByRole('button', { name: 'Prepare the pilot scope', exact: true }).click()
      await page.getByRole('button', { name: 'Define done', exact: true }).click()
      await page.getByRole('combobox', { name: 'Completion responsibility', exact: true }).click()
      await page
        .getByRole('option', { name: 'Verify the agreed deliverable and mark it complete', exact: true })
        .click()
      await page
        .getByLabel('What must the deliverable accomplish?', { exact: true })
        .fill('Summarize pilot constraints and cite the supplied feedback.')
      await modal().getByLabel('Pilot feedback', { exact: true }).check()
      await page.getByRole('button', { name: 'Delegate completion', exact: true }).click()
      await page.getByRole('button', { name: 'Completion rule', exact: true }).waitFor()
      const completion = await store.getGrant(item.id)
      assert({
        given: 'an exact deliverable completion rule saved in the app',
        should: 'persist the scoped rule while preserving existing decision authority',
        actual: [
          completion.actionPolicies.scope.activityTitle,
          completion.actionPolicies.scope.requiredSourceIds,
          completion.decisionPolicies.approval.mode,
        ],
        expected: ['Prepare the pilot scope', ['feedback'], 'delegate'],
      })

      await page.locator('.sky-workstream-detail').getByText('Details', { exact: true }).click()
      await page.getByRole('button', { name: 'Edit reporting', exact: true }).click()
      await page.getByLabel('Include this workstream · Sensitive', { exact: true }).check()
      assert({
        given: 'the full workstream selected as report context',
        should: 'leave sensitive audience permission unchanged until explicitly set',
        actual: await page.getByLabel('This audience may receive sensitive information', { exact: true }).isChecked(),
        expected: false,
      })
      await page.getByRole('button', { name: 'Save details', exact: true }).click()
      await modal().waitFor({ state: 'hidden' })
      item = (await store.get(item.id))!
      assert({
        given: 'report source selection saved through the real controller',
        should: 'record the brief as sensitive and keep its audience access separate',
        actual: [
          item.sources.find((source) => source.path === item.path)?.sensitive,
          item.reporting[0].allowSensitive,
          item.reporting[0].permittedSourceIds.length,
        ],
        expected: [true, false, 2],
      })
      await page.getByRole('button', { name: 'Edit reporting', exact: true }).click()
      await page.getByLabel('This audience may receive sensitive information', { exact: true }).check()
      await page.getByRole('button', { name: 'Save details', exact: true }).click()
      await modal().waitFor({ state: 'hidden' })

      await page.getByRole('button', { name: 'Set up delivery', exact: true }).click()
      await page.getByRole('combobox', { name: 'How should this update reach them?', exact: true }).click()
      await page
        .getByRole('option', { name: 'Sky sends the recurring report to this destination', exact: true })
        .click()
      await page
        .getByLabel('Slack channel or conversation link', { exact: true })
        .fill('https://atlas.slack.com/archives/C12345678')
      await page.screenshot({ path: path.join(tmpdir(), 'sky-workstreams-report-authority.png') })
      await page.getByRole('button', { name: 'Authorize recurring delivery', exact: true }).click()
      await modal().waitFor({ state: 'hidden' })
      const reportGrant = await delivery.grant(item.id, 'board')
      assert({
        given: 'explicit recurring delivery configuration through the app',
        should: 'save the exact external account and audience without sending anything during configuration',
        actual: [reportGrant.mode, reportGrant.target, reportGrant.scopeCurrent, sent.length],
        expected: ['send', { medium: 'slack', workspace: 'https://atlas.slack.com/', channelId: 'C12345678' }, true, 0],
      })

      await page.getByRole('button', { name: 'Prepare fresh report', exact: true }).click()
      await page.getByRole('button', { name: 'Review & send', exact: true }).waitFor()
      const incomplete = (await delivery.list(item.id)).deliveries[0]!
      const originalCadence = (await store.get(item.id))!.reporting[0].nextDueAt
      assert({
        given: 'a freshly prepared report with missing factual input and a recording',
        should: 'retain its blockers for review',
        actual: [
          reports,
          incomplete.status,
          incomplete.blockers.some((blocker) => blocker.includes('Loom')),
          sent.length,
        ],
        expected: [1, 'review', true, 0],
      })
      await page.getByRole('button', { name: 'Review & send', exact: true }).click()
      await page.getByRole('button', { name: 'Approve & send this report', exact: true }).click()
      assert({
        given: 'an incomplete report with required artifact links still missing',
        should: 'remain unsent',
        actual: sent.length,
        expected: 0,
      })
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Edit reporting', exact: true }).click()
      await page.getByLabel('Presentation link', { exact: true }).fill('https://example.com/pilot-presentation')
      await page.getByLabel('Loom link', { exact: true }).fill('https://example.com/pilot-recording')
      await page.getByRole('button', { name: 'Save details', exact: true }).click()
      await modal().waitFor({ state: 'hidden' })
      clock = '2025-03-15 12:01'
      const freshResponse = page.waitForResponse(
        (response) => response.url().endsWith('/reporting/board/prepare') && response.request().method() === 'POST',
      )
      await page.getByRole('button', { name: 'Prepare fresh report', exact: true }).click()
      const freshRun = await (await freshResponse).json()
      assert({
        given: 'the explicit regeneration endpoint',
        should: 'finish the fresh audience report',
        actual: freshRun.status,
        expected: 'completed',
      })
      const refreshedDeliveries = (await delivery.list(item.id)).deliveries
      const prepared = refreshedDeliveries.find((record) => record.id !== incomplete.id)!
      assert({
        given: 'persistent artifact links followed by an explicit fresh audience report',
        should: 'regenerate from those inputs and retain the existing reporting cadence',
        actual: [
          reports,
          prepared.blockers.some((blocker) => blocker.includes('Loom')),
          prepared.attachments.length,
          (await store.get(item.id))!.reporting[0].nextDueAt,
        ],
        expected: [2, false, 2, originalCadence],
      })
      const queued = (await outboxStore.get(prepared.outboxId!))!
      await outboxStore.put(
        { ...queued, draft: 'The pilot is ready for your scope decision. This is the reviewed wording.', edited: true },
        queued.revision,
      )
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await page.getByRole('button', { name: 'Review & send', exact: true }).click()
      await modal()
        .getByText('The pilot is ready for your scope decision. This is the reviewed wording.', { exact: true })
        .waitFor()
      await page.getByRole('button', { name: 'Approve & send this report', exact: true }).click()
      await modal().waitFor({ state: 'hidden' })
      await page.getByText('Sent · provider receipt recorded', { exact: true }).waitFor()
      const delivered = (await delivery.get(item.id, prepared.id))!
      assert({
        given: 'the complete regenerated report explicitly approved in the main app',
        should:
          'send exactly the current Outbox wording and persistent artifact links through the real controller and record the provider receipt',
        actual: [sent.length, sent[0]?.body, sent[0]?.attachments, delivered.status, delivered.receipt?.id],
        expected: [
          1,
          'The pilot is ready for your scope decision. This is the reviewed wording.',
          [
            { name: 'Presentation', url: 'https://example.com/pilot-presentation' },
            { name: 'Loom', url: 'https://example.com/pilot-recording' },
          ],
          'sent',
          'slack1',
        ],
      })
      await page.screenshot({ path: path.join(tmpdir(), 'sky-workstreams-agentic-integrated.png'), fullPage: true })
      for (const title of ['Choose the pilot approach', 'Prepare the pilot scope']) {
        await page.getByRole('button', { name: 'Browse work', exact: true }).click()
        await modal().getByRole('button', { name: title, exact: true }).click()
        await page.waitForFunction((expected) => document.activeElement?.textContent === expected, title)
        await page.waitForTimeout(250)
        assert({
          given: 'keyboard browsing to an activity in an already open workstream',
          should: 'update the query target and focus its actual row after the navigation dialog closes',
          actual: await page.evaluate(() => [
            document.activeElement?.textContent,
            new URLSearchParams(window.location.search).get('activity'),
          ]),
          expected: [title, title === 'Choose the pilot approach' ? 'approval' : 'scope'],
        })
      }

      const emailItem = await store.create(
        WorkstreamSchema.parse({
          id: 'email-review',
          title: 'Prepare the Atlas pilot email',
          outcome: 'A pilot update ready for Jane to review.',
          created: NOW,
          updated: clock,
          sources: [{ id: 'feedback', path: 'feedback.md', label: 'Pilot feedback', sensitive: false }],
          reporting: [
            {
              id: 'advisors-email',
              audience: 'Advisors',
              medium: 'email',
              cadenceDays: 7,
              permittedSourceIds: ['feedback'],
              artifacts: [],
            },
          ],
        }),
        clock,
      )
      await page.goto(`http://127.0.0.1:${address.port}/workstreams/${emailItem.id}`)
      await page.locator('.sky-workstream-detail').getByText('Details', { exact: true }).click()
      await page.getByRole('button', { name: 'Review settings', exact: true }).click()
      assert({
        given: 'email reporting settings in the main app',
        should: 'offer account and recipient review settings without automatic delivery controls',
        actual: [
          await modal()
            .getByText('Email reports are prepared for your review in Outbox. Sky does not send email.', {
              exact: true,
            })
            .isVisible(),
          await modal().getByRole('combobox', { name: 'How should this update reach them?', exact: true }).count(),
          await modal().getByRole('button', { name: 'Authorize recurring delivery', exact: true }).count(),
          await modal().getByLabel('Maximum deliveries per day', { exact: true }).count(),
        ],
        expected: [true, 0, 0, 0],
      })
      await modal().getByLabel('From account', { exact: true }).fill('jane@example.com')
      await modal().getByLabel('To', { exact: true }).fill('advisors@example.com')
      await modal().getByRole('button', { name: 'Save review preference', exact: true }).click()
      await modal().waitFor({ state: 'hidden' })
      const emailGrant = await delivery.grant(emailItem.id, 'advisors-email')
      assert({
        given: 'email review preferences saved through the real controller',
        should: 'retain the exact account and recipient in review mode without sending email',
        actual: [emailGrant.mode, emailGrant.target, sent.length],
        expected: ['review', { medium: 'email', account: 'jane@example.com', to: ['advisors@example.com'] }, 1],
      })
      await page.getByRole('button', { name: 'Prepare fresh report', exact: true }).click()
      await page.getByRole('button', { name: 'Review report', exact: true }).waitFor()
      const emailReport = (await delivery.list(emailItem.id)).deliveries[0]!
      assert({
        given: 'a complete email report with its account and recipient configured',
        should: 'prepare it in Outbox for review and expose no send action or recurring-send authorization',
        actual: [
          emailReport.status,
          Boolean(emailReport.outboxId),
          await page.getByRole('button', { name: 'Review & send', exact: true }).count(),
          await page.getByText('Recurring delivery authorized', { exact: true }).count(),
          sent.map((record) => record.target?.medium),
        ],
        expected: ['review', true, 0, 0, ['slack']],
      })
      await page.getByRole('button', { name: 'Review report', exact: true }).click()
      await modal().getByText('The pilot is ready for your review.', { exact: true }).waitFor()
      assert({
        given: 'the prepared email report opened for review',
        should: 'provide Outbox access without an approval-to-send button',
        actual: [
          await modal().getByRole('button', { name: 'Approve & send this report', exact: true }).count(),
          await modal().getByRole('button', { name: 'Open in Outbox ↗', exact: true }).isVisible(),
        ],
        expected: [0, true],
      })
      await modal().getByRole('button', { name: 'Open in Outbox ↗', exact: true }).click()
      // The item's own page. This fixture mounts no Outbox API, so the page itself is checked in the workstreams flow test.
      await page.waitForURL(`**${outboxHref(emailReport.outboxId!)}`)
      assert({
        given: 'the complete integrated delegation and delivery flow',
        should: 'raise no browser errors',
        actual: errors,
        expected: [],
      })
    } finally {
      if (browser) await browser.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
