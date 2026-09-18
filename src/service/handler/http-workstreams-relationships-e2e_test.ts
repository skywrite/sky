import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { chromium, type Locator, type Page } from 'playwright'
import { WorkstreamStore } from '#lib/workstreams/store.ts'
import { ActivitySchema } from '#lib/workstreams/types.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'

const NOW = '2025-03-15 12:00'

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Missing browser fixture control.')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: label, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

async function clickEdge(page: Page, name: RegExp): Promise<void> {
  const point = await page.getByRole('button', { name }).evaluate((element) => {
    const edge = element as SVGPathElement
    const middle = edge.getPointAtLength(edge.getTotalLength() / 2)
    const matrix = edge.getScreenCTM()!
    return {
      x: matrix.a * middle.x + matrix.c * middle.y + matrix.e,
      y: matrix.b * middle.x + matrix.d * middle.y + matrix.f,
    }
  })
  await page.mouse.click(point.x, point.y)
}

test(
  {
    name: 'workstream relationships connect real work through canvas gestures, exact required results, and reviewed Sky proposals',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 90000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-workstreams-relationships-e2e-'))
    const store = new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root, () =>
      NOW.slice(0, 10),
    )
    const umbrella = await store.create(
      { id: 'program', title: 'Research program', outcome: 'Learn what makes the pilot useful.' },
      NOW,
    )
    const provider = await store.create(
      {
        id: 'widget',
        title: 'Widget research',
        outcome: 'Produce an agreed pilot brief.',
        activities: [
          ActivitySchema.parse({ id: 'brief', title: 'Agree the pilot brief', state: 'ready', start: '2025-03-15' }),
        ],
      },
      NOW,
    )
    const source = await store.create(
      {
        id: 'atlas',
        title: 'Atlas pilot',
        outcome: 'Launch a useful pilot.',
        activities: [
          ActivitySchema.parse({ id: 'launch', title: 'Start the pilot', state: 'ready', start: '2025-03-18' }),
        ],
        proposals: [
          {
            id: 'required-brief',
            kind: 'relation',
            title: 'Clarify the brief the pilot needs',
            reason: 'The pilot needs an agreed scope before it can start.',
            relationKind: 'prerequisite',
            targetId: provider.id,
            activityId: 'launch',
            requiredActivityId: 'brief',
          },
        ],
      },
      NOW,
    )
    const unavailable = async (): Promise<never> => {
      throw new Error('The browser fixture has no external executor.')
    }
    const app = createTestHttpApp([path.join(root, 'workstreams'), path.join(root, 'time')], {
      chat: { createSession: unavailable, timeDir: path.join(root, 'time') },
      workstreams: {
        store,
        now: () => NOW,
        today: () => NOW.slice(0, 10),
        setup: unavailable,
        automation: async () => null,
        draft: unavailable,
        run: unavailable,
        planDay: unavailable,
      },
    })
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture server address.')
    const origin = `http://127.0.0.1:${address.port}`
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1900, height: 1100 } })
      page.setDefaultTimeout(10000)
      const errors: string[] = []
      let layoutWrites = 0
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('request', (request) => {
        if (request.method() === 'PUT' && request.url().endsWith('/layout')) layoutWrites++
      })
      await page.goto(`${origin}/workstreams`)
      const card = (id: string) => page.locator(`.sky-workstreams-card[data-workstream="${id}"]`)
      await card(source.id).waitFor()
      const originalCamera = await page.locator('.sky-workstreams-world').getAttribute('style')
      await page.getByRole('button', { name: 'Fit', exact: true }).click()
      await page.waitForFunction(
        (before) => document.querySelector('.sky-workstreams-world')?.getAttribute('style') !== before,
        originalCamera,
      )
      const camera = () => page.locator('.sky-workstreams-world').getAttribute('style')
      const beforeCamera = await camera()
      await card(source.id).hover()
      const from = await center(
        page.getByRole('button', { name: 'Relate Atlas pilot to another workstream', exact: true }),
      )
      const to = await center(card(provider.id))
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await page.mouse.move(to.x, to.y, { steps: 8 })
      await page.mouse.up()
      await page.getByRole('dialog', { name: 'Relate workstreams', exact: true }).waitFor()
      assert({
        given: 'a connector dragged between workstreams',
        should: 'open a relationship editor without moving, selecting, or mutating the work',
        actual: [layoutWrites, await camera(), page.url(), (await store.get(source.id))!.revision],
        expected: [0, beforeCamera, `${origin}/workstreams`, source.revision],
      })
      await choose(page, 'Relationship', 'Contributes to')
      await page
        .getByRole('textbox', { name: 'Why this matters', exact: true })
        .fill('The pilot validates the research findings.')
      await page.getByRole('button', { name: 'Add relationship', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      assert({
        given: 'saving a contribution',
        should: 'preserve its direction and explanation',
        actual: (await store.get(source.id))!.relations,
        expected: [
          { targetId: provider.id, kind: 'contributes', reason: 'The pilot validates the research findings.' },
        ],
      })
      await clickEdge(page, /Inspect relationship: Atlas pilot contributes to Widget research/)
      await page.getByRole('dialog', { name: 'Relationship', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Remove relationship', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      assert({
        given: 'removing an inspected line',
        should: 'remove only that relationship',
        actual: [(await store.get(source.id))!.relations, (await store.get(provider.id))!.revision],
        expected: [[], provider.revision],
      })

      await card(source.id).click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Relate to…', exact: true }).click()
      await choose(page, 'Relationship', 'Needs a result from')
      await choose(page, 'Other workstream', provider.title)
      await choose(page, 'Which activity is waiting?', 'Start the pilot')
      await choose(page, 'Which activity provides the result?', 'Agree the pilot brief')
      await page
        .getByRole('textbox', { name: 'What result is needed?', exact: true })
        .fill('A brief accepted by the pilot team.')
      await page.getByRole('button', { name: 'Add relationship', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      assert({
        given: 'an activity needing a specific result from other work',
        should: 'save an exact activity prerequisite without adding a generic relationship',
        actual: [(await store.get(source.id))!.activities[0]!.requires, (await store.get(source.id))!.relations],
        expected: [
          [{ workstreamId: provider.id, activityId: 'brief', result: 'A brief accepted by the pilot team.' }],
          [],
        ],
      })

      const phone = await browser.newPage({ viewport: { width: 430, height: 900 }, isMobile: true, hasTouch: true })
      phone.setDefaultTimeout(10000)
      phone.on('pageerror', (error) => errors.push(error.message))
      await phone.goto(`${origin}/workstreams`)
      await phone.locator(`.sky-workstreams-card[data-workstream="${source.id}"]`).waitFor()
      await phone.getByRole('button', { name: `Workstream menu for ${source.title}`, exact: true }).click()
      await phone.getByRole('button', { name: 'Relate to…', exact: true }).click()
      await phone.getByRole('dialog', { name: 'Relate workstreams', exact: true }).waitFor()
      assert({
        given: 'touching the workstream menu on a phone',
        should: 'open the relationship editor as a bottom sheet',
        actual: await phone.locator('.mantine-Drawer-content').count(),
        expected: 1,
      })
      await choose(phone, 'Relationship', 'Part of')
      await choose(phone, 'Other workstream', umbrella.title)
      await phone.getByRole('button', { name: 'Add relationship', exact: true }).click()
      await phone.getByRole('dialog').waitFor({ state: 'hidden' })
      assert({
        given: 'choosing a larger workstream on mobile',
        should: 'save the parent without losing the exact prerequisite',
        actual: [(await store.get(source.id))!.parentId, (await store.get(source.id))!.activities[0]!.requires.length],
        expected: [umbrella.id, 1],
      })
      await phone.close()

      await page.goto(`${origin}/workstreams/${source.id}`)
      await page.locator('.sky-workstream-detail').waitFor()
      const beforeFit = await camera()
      await page.getByRole('button', { name: 'Fit', exact: true }).click()
      await page.waitForFunction(
        (before) => document.querySelector('.sky-workstreams-world')?.getAttribute('style') !== before,
        beforeFit,
      )
      await clickEdge(page, /Review Sky suggestion: Atlas pilot needs a result from Widget research/)
      await page.getByRole('dialog', { name: 'Review relationship', exact: true }).waitFor()
      assert({
        given: 'a typed Sky suggestion drawn on the canvas',
        should: 'retain its exact activities while requiring an explicit missing result before Apply',
        actual: [
          await page.getByRole('combobox', { name: 'Relationship', exact: true }).inputValue(),
          await page.getByRole('combobox', { name: 'Which activity is waiting?', exact: true }).inputValue(),
          await page.getByRole('combobox', { name: 'Which activity provides the result?', exact: true }).inputValue(),
          await page.getByRole('textbox', { name: 'What result is needed?', exact: true }).inputValue(),
          await page.getByRole('button', { name: 'Apply relationship', exact: true }).isDisabled(),
        ],
        expected: ['Needs a result from', 'Start the pilot', 'Agree the pilot brief', '', true],
      })
      await page
        .getByRole('textbox', { name: 'What result is needed?', exact: true })
        .fill('A brief accepted by the pilot team and research lead.')
      await page.getByRole('button', { name: 'Apply relationship', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      const accepted = (await store.get(source.id))!
      assert({
        given: 'applying an edited Sky relationship proposal',
        should: 'atomically save the reviewed relationship and remove its proposal, retaining other work',
        actual: [
          accepted.relations,
          accepted.proposals,
          accepted.parentId,
          accepted.activities[0]!.requires,
          layoutWrites,
          errors,
        ],
        expected: [
          [],
          [],
          umbrella.id,
          [
            {
              workstreamId: provider.id,
              activityId: 'brief',
              result: 'A brief accepted by the pilot team and research lead.',
            },
          ],
          0,
          [],
        ],
      })
    } finally {
      await browser?.close()
      server.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)
