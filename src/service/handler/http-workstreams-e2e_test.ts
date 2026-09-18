import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { chromium } from 'playwright'
import { OutboxReview } from '#lib/outbox/review.ts'
import { SavedMessages } from '#lib/outbox/sources.ts'
import { OutboxStore } from '#lib/outbox/store.ts'
import type { WorkstreamReview } from '#lib/workstreams/ai.ts'
import type { CaptureRequest } from '#lib/workstreams/captureTypes.ts'
import { planWorkstreamDay } from '#lib/workstreams/day.ts'
import { createWorkstreamOutbox } from '#lib/workstreams/outbox.ts'
import { runWorkstream } from '#lib/workstreams/runner.ts'
import { WorkstreamStore } from '#lib/workstreams/store.ts'
import type { WorkstreamRecord } from '#lib/workstreams/types.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'

const NOW = '2025-03-15 12:00'

test(
  {
    name: 'workstreams main app carries an objective through a decision, real local work, Today and Outbox',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 90000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-workstreams-e2e-'))
    const store = new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root, () =>
      NOW.slice(0, 10),
    )
    const outbox = new OutboxStore(path.join(root, 'outbox'), path.join(root, 'outbox-state'))
    const sources = new SavedMessages(root, { Slack: [], Email: [] })
    const communications = createWorkstreamOutbox({ workstreams: store, store: outbox, sources, now: () => NOW })
    const reviewer = new OutboxReview(
      outbox,
      sources,
      async () => {
        throw new Error('This fixture has no external destination.')
      },
      () => NOW,
      undefined,
      communications.currentContext,
    )
    let calls = 0
    const captureRequests: CaptureRequest[] = []
    let initialActivityCount: number | undefined
    const run = async (id: string, request?: string) =>
      runWorkstream({
        store,
        id,
        now: NOW,
        request,
        prepareCommunication: communications.prepare,
        propose: async () => {
          calls++
          const item = (await store.get(id))!
          if (calls === 1) initialActivityCount = item.activities.length
          const update = item.activities.find((activity) => activity.title === 'Prepare partner update')!
          const result: WorkstreamReview = {
            summary:
              calls === 1
                ? 'Prepared a scope outline. The scope decision needs you.'
                : 'Prepared an update reflecting the recorded decision.',
            understanding: 'The pilot needs an agreed scope.',
            outcomeSuggestion: '',
            unknowns: [],
            activities:
              calls === 1
                ? [
                    {
                      title: 'Prepare partner update',
                      description: 'Prepare communication after the scope decision.',
                      executor: 'sky',
                    },
                  ]
                : [],
            decisions:
              calls === 1
                ? [
                    {
                      question: 'Choose pilot scope',
                      context: 'Choose the first group.',
                      recommendation: 'Start small.',
                    },
                  ]
                : [],
            relationships: [],
            suggestions: [],
            subworkstreams: [],
            artifact:
              calls === 1
                ? {
                    title: 'Pilot scope outline',
                    body: '# Pilot scope\n\nStart with a small invited group. The owner must choose the final scope.',
                    // Capture starts without activities; this outline belongs to the whole workstream.
                    activityId: '',
                  }
                : null,
            communication:
              calls === 1
                ? null
                : {
                    activityId: update.id,
                    title: 'Confirm pilot scope',
                    draft: 'We have chosen a small invited pilot. Please review the scope.',
                    medium: 'Email',
                    destination: 'jane@example.com',
                    sourceRef: '',
                  },
            waitingFor: 'Owner review.',
            nextCheckMinutes: 1440,
          }
          return result
        },
      })
    const app = createTestHttpApp(
      [path.join(root, 'workstreams'), path.join(root, 'time'), path.join(root, 'outbox')],
      {
        chat: {
          createSession: async () => {
            throw new Error('No chat fixture')
          },
          timeDir: path.join(root, 'time'),
        },
        workstreams: {
          store,
          now: () => NOW,
          today: () => NOW.slice(0, 10),
          setup: async () => ({}),
          automation: async () => null,
          draft: async () => {
            throw new Error('The capture UI must not request a full workstream draft.')
          },
          capture: async (request) => {
            captureRequests.push(request)
            return {
              title: 'Atlas pilot',
              outcome: request.intent,
              suggestedOutcome: 'Agree a useful pilot scope.',
              understanding: 'A small pilot will establish the approach.',
              horizon: 'few-weeks',
              horizonLabel: 'A few weeks',
              question: null,
              sources: [],
              contextLimited: false,
            }
          },
          run,
          communications: communications.list,
          planDay: (id, activityId, day, revision) =>
            planWorkstreamDay(
              { store, timeDir: path.join(root, 'time'), now: () => NOW },
              id,
              activityId,
              day,
              revision,
            ),
        },
        outbox: {
          report: async () => ({
            items: await outbox.list(),
            done: [],
            preferences: await outbox.preferences(),
            automation: null,
            lastScan: null,
          }),
          setup: async () => ({}),
          scan: async () => ({ outcome: 'nothing' }),
          save: (id, revision, draft) => reviewer.save(id, revision, draft),
          approve: (id, revision, draft, changes) => reviewer.approve(id, revision, draft, changes),
          dismiss: (id, revision) => reviewer.dismiss(id, revision),
          preferences: (text, revision) => outbox.savePreferences(text, revision),
          reportSent: communications.reportSent,
        },
      },
    )
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server address')
    const origin = `http://127.0.0.1:${address.port}`
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
      await page.addInitScript(() => {
        localStorage.setItem('sky-workstreams-view', 'map')
        localStorage.setItem('sky-workstreams-camera-map', JSON.stringify({ x: -12000, y: 9000, zoom: 8 }))
      })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`${origin}/workstreams`)
      const intention = 'Get the Atlas pilot going over the next few weeks.'
      await page.getByRole('textbox', { name: 'What do you want to get done?', exact: true }).fill(intention)
      await page.getByRole('textbox', { name: 'What do you want to get done?', exact: true }).press('Enter')
      await page.getByRole('button', { name: 'Start workstream', exact: true }).waitFor()
      assert({
        given: 'an intention whose timing and starting point are already understood',
        should: 'show a compact starting point and wait for explicit creation without a planning form',
        actual: [
          captureRequests,
          (await store.list()).length,
          calls,
          await page.getByLabel('Your intention', { exact: true }).count(),
          await page.getByLabel('Let Sky check in and prepare next steps', { exact: true }).isChecked(),
        ],
        expected: [[{ intent: intention, answers: [] }], 0, 0, 0, true],
      })
      await page.getByRole('button', { name: 'Start workstream', exact: true }).click()
      await page.locator('.sky-workstream-detail').waitFor()
      await page.getByText('Pilot scope outline', { exact: true }).waitFor()
      const item = (await store.list())[0]!
      await page.waitForFunction(
        (id) => {
          const canvas = document.querySelector('.sky-workstreams-canvas')
          const card = document.querySelector(`.sky-workstreams-card[data-workstream="${id}"]`)
          if (!canvas || !card) return false
          const viewport = canvas.getBoundingClientRect()
          const rect = card.getBoundingClientRect()
          const center = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          return (
            rect.width > 0 &&
            rect.left >= viewport.left &&
            rect.right <= viewport.right &&
            rect.top >= viewport.top &&
            rect.bottom <= viewport.bottom &&
            !!center &&
            card.contains(center)
          )
        },
        item.id,
        { timeout: 2000 },
      )
      assert({
        given: 'an intention shaped and created through the main app',
        should:
          'start with the accepted outcome, then persist activities and an actual artifact from the first Sky run',
        actual: [
          item.title,
          item.outcome,
          item.notes,
          initialActivityCount,
          item.activities.length,
          item.artifacts.length,
          calls,
        ],
        expected: [intention, intention, 'Timing: A few weeks', 0, 2, 1, 1],
      })
      assert({
        given: 'a workstream opened from the canvas',
        should: 'start with its short brief and keep the complete work and details secondary',
        actual: [
          await page.getByRole('tab', { name: 'Brief', exact: true }).getAttribute('aria-selected'),
          await page.getByRole('heading', { name: 'What success looks like', exact: true }).isVisible(),
          await page.getByRole('heading', { name: 'Actions & follow-through', exact: true }).count(),
          await page.getByRole('heading', { name: 'People, timing & details', exact: true }).count(),
          await page
            .getByRole('textbox', { name: 'What changed, or what would you like to move forward?', exact: true })
            .count(),
        ],
        expected: ['true', true, 0, 0, 1],
      })

      const decision = item.activities.find((activity) => activity.kind === 'decision')!
      const row = page.locator(`#activity-${decision.id}`)
      await row.getByRole('button', { name: 'Review decision', exact: true }).click()
      await row.getByRole('button', { name: 'Today', exact: true }).click()
      await page.getByRole('button', { name: `Complete ${decision.title}`, exact: true }).click()
      await page.getByLabel('What did you decide?').fill('Use a small invited group.')
      await page.getByRole('button', { name: 'Save decision', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      let current = (await store.get(item.id))!
      assert({
        given: 'the same decision planned in Today and resolved from its workstream',
        should: 'record one canonical decision and update the day snapshot',
        actual: [
          current.activities.find((activity) => activity.id === decision.id)!.result,
          current.activities.find((activity) => activity.id === decision.id)!.participation[0]!.state,
        ],
        expected: ['Use a small invited group.', 'done'],
      })

      const update = current.activities.find((activity) => activity.title === 'Prepare partner update')!
      await page.getByRole('tab', { name: 'Work', exact: false }).click()
      await page
        .locator(`#activity-${update.id}`)
        .getByRole('button', { name: 'Accept next step', exact: true })
        .click()
      await page.waitForFunction(
        async ({ id, activityId }) => {
          const result = await fetch(`/workstreams/_api/${id}`).then((response) => response.json())
          return result.workstream.activities.some(
            (activity: { id: string; state: string }) => activity.id === activityId && activity.state === 'ready',
          )
        },
        { id: item.id, activityId: update.id },
      )
      current = (await store.get(item.id))!
      assert({
        given: 'a next step proposed by the first assist-mode review',
        should: 'require human acceptance before Sky can prepare the partner communication',
        actual: [update.state, current.activities.find((activity) => activity.id === update.id)!.state, calls],
        expected: ['proposed', 'ready', 1],
      })
      await page.getByRole('tab', { name: 'Brief', exact: true }).click()

      await page.getByRole('button', { name: 'Close workstream', exact: true }).click()
      const card = page.locator(`[data-workstream="${item.id}"]`).first()
      const box = (await card.boundingBox())!
      await page.mouse.move(box.x + 100, box.y + 50)
      await page.mouse.down()
      await page.mouse.move(box.x + 160, box.y + 100, { steps: 8 })
      await page.mouse.up()
      await page.waitForFunction(async (id) => {
        const result = await fetch('/workstreams/_api/status').then((response) => response.json())
        return Boolean(result.layout[id])
      }, item.id)
      const afterMove = (await store.get(item.id))!
      assert({
        given: 'a workstream card dragged on Map',
        should: 'preserve the work revision',
        actual: afterMove.revision,
        expected: current.revision,
      })
      await page.getByText('Timeline', { exact: true }).click()
      await page.locator('.sky-workstreams-week').first().waitFor()
      await page.getByText('Map', { exact: true }).click()
      await page.locator(`[data-workstream="${item.id}"]`).first().click()
      const note = 'The invited group scope is agreed. Prepare the partner update using that decision.'
      const contextRequests: string[] = []
      await page.route('**/workstreams/_api/*/context', async (route) => {
        const payload = route.request().postDataJSON() as { operationId: string }
        contextRequests.push(payload.operationId)
        if (contextRequests.length === 1) {
          // Lose the response after the real route saved the note; retry must reuse that operation.
          await route.fetch()
          await route.abort('failed')
        } else await route.continue()
      })
      const composer = page.getByRole('textbox', {
        name: 'What changed, or what would you like to move forward?',
        exact: true,
      })
      await composer.fill(note)
      await page.getByRole('button', { name: 'Send to Sky', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'fetch' }).waitFor()
      await page.getByRole('button', { name: 'Send to Sky', exact: true }).click()
      await page.getByRole('button', { name: 'Open in Outbox ↗', exact: true }).waitFor()
      current = (await store.get(item.id))!
      assert({
        given: 'a note saved before its response was lost, then retried through Send to Sky',
        should: 'save it once, reuse its operation, and ask for one review without granting ongoing responsibility',
        actual: [
          current.notes.split(note).length - 1,
          contextRequests.length,
          contextRequests[0] === contextRequests[1],
          current.sky.mode,
          calls,
        ],
        expected: [1, 2, true, item.sky.mode, 2],
      })
      await page.getByRole('button', { name: 'Open in Outbox ↗', exact: true }).click()
      await page.locator('.sky-outbox-draft').waitFor()
      const queued = (await outbox.list())[0]!
      current = (await store.get(item.id))!
      assert({
        given: 'a later Sky review after the recorded decision',
        should: 'prepare one linked local communication without claiming native placement or sending',
        actual: [
          queued.status,
          queued.conversation.target,
          current.activities.find((activity) => activity.title === 'Prepare partner update')!.outboxId,
          calls,
        ],
        expected: ['needs_review', null, queued.id, 2],
      })
      await page.goto(`${origin}/workstreams/${item.id}`)
      await page.locator('.sky-workstream-detail').waitFor()
      await composer.fill('The next discussion is scheduled; no preparation is needed yet.')
      await page.getByRole('button', { name: 'Save note only', exact: true }).click()
      await page.getByText('Note saved to this workstream.', { exact: true }).waitFor()
      await page.getByRole('tab', { name: 'Work', exact: false }).click()
      await page.getByRole('heading', { name: 'Actions & follow-through', exact: true }).waitFor()
      await page.getByRole('tab', { name: 'Details', exact: true }).click()
      await page.getByRole('heading', { name: 'People, timing & details', exact: true }).waitFor()
      await page.getByText('Working notes', { exact: true }).click()
      await page
        .getByText('Working notes', { exact: true })
        .locator('..')
        .getByText('The next discussion is scheduled; no preparation is needed yet.', { exact: true })
        .waitFor()
      assert({
        given: 'Save note only and the secondary workstream views',
        should: 'preserve the note and access to the complete work without starting another Sky run',
        actual: calls,
        expected: 2,
      })
      await page.getByRole('tab', { name: 'Brief', exact: true }).click()
      await page.screenshot({ path: path.join(tmpdir(), 'sky-workstreams-integrated.png'), fullPage: true })
      assert({
        given: 'the complete app flow and a reload',
        should: 'raise no browser errors and retain the same work',
        actual: [errors, (await store.list()).length],
        expected: [[], 1],
      })
    } finally {
      if (browser) await browser.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
