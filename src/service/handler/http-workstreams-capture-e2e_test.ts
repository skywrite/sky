import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { chromium, type Locator, type Page } from 'playwright'
import type { CaptureRequest, CaptureResponse } from '#lib/workstreams/captureTypes.ts'
import { WorkstreamStore } from '#lib/workstreams/store.ts'
import type { WorkstreamRecord, WorkstreamReport } from '#lib/workstreams/types.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'

const INTENTION = 'Bring 12 customers into the Atlas pilot.'
const SUGGESTION = 'Launch the Atlas pilot with twelve invited customers.'
const QUESTION = 'Is the vendor approval still holding up invitations?'
const CONTEXT = 'The pilot scope is agreed. Customer invitations are the next step.'
const NOW = '2025-03-15 12:00'

async function visibleCanvasItem(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (target) => {
      const canvas = document.querySelector('.sky-workstreams-canvas')
      const card = document.querySelector(target)
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
    selector,
    { timeout: 2000 },
  )
}

interface CaptureCall {
  input: CaptureRequest
  resolve: (response: CaptureResponse) => void
  reject: (error: Error) => void
}

function response(input: CaptureRequest, changes: Partial<CaptureResponse> = {}): CaptureResponse {
  return {
    title: 'Atlas pilot',
    outcome: input.intent,
    suggestedOutcome: SUGGESTION,
    understanding: CONTEXT,
    horizon: input.horizon ?? 'few-months',
    horizonLabel: input.horizon === 'few-weeks' ? 'A few weeks' : 'A few months',
    question: null,
    sources: [{ id: 'synthetic-notes', path: 'time/pilot-notes.md', label: 'Pilot notes' }],
    contextLimited: false,
    ...changes,
  }
}

test(
  {
    name: 'overview recovers existing work from distant saved cameras and leaves later navigation alone',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 90000,
  },
  async () => {
    const f = await fixture()
    const id = 'existing-atlas-pilot'
    const card = `.sky-workstreams-card[data-workstream="${id}"]`
    try {
      await f.store.create({ id, title: 'Atlas pilot', outcome: 'Bring twelve customers into the pilot.' }, NOW)
      await writeFile(path.join(f.store.stateDir, 'layout.json'), JSON.stringify({ [id]: { x: -840, y: -480 } }))
      await f.page.evaluate(() => {
        localStorage.setItem('sky-workstreams-view', 'map')
        localStorage.setItem('sky-workstreams-camera-map', JSON.stringify({ x: -12000, y: 9000, zoom: 1 }))
        localStorage.setItem('sky-workstreams-camera-timeline', JSON.stringify({ x: 14000, y: -16000, zoom: 1 }))
      })
      await f.page.reload()
      await f.page.locator(card).waitFor()
      await visibleCanvasItem(f.page, card)
      assert({
        given:
          'an overview reload at 100% with a distant saved camera and an existing card at negative world coordinates',
        should: 'show the complete card with a real hit target without selecting it or opening details',
        actual: [
          new URL(f.page.url()).pathname,
          await f.page.locator(card).getAttribute('data-selected'),
          await f.page.locator('.sky-workstream-detail').count(),
        ],
        expected: ['/workstreams', 'false', 0],
      })
      const shots = env.get('SKY_WORKSTREAM_CAPTURE_SCREENSHOTS')
      if (shots)
        await f.page.screenshot({ path: path.join(shots, 'overview-negative-map.png'), animations: 'disabled' })

      const world = f.page.locator('.sky-workstreams-world')
      const pan = async (x: number, y: number) => {
        const previous = await world.getAttribute('style')
        const canvas = await f.page.locator('.sky-workstreams-canvas').boundingBox()
        if (!canvas) throw new Error('Missing canvas')
        await f.page.mouse.move(canvas.x + canvas.width / 4, canvas.y + canvas.height * 0.75)
        await f.page.mouse.wheel(x, y)
        await f.page.waitForFunction(
          (before) => document.querySelector('.sky-workstreams-world')?.getAttribute('style') !== before,
          previous,
        )
      }
      await f.page.locator(card).locator('.sky-workstreams-card-open').click()
      await f.page.locator('.sky-workstream-detail').waitFor()
      await pan(12000, -9000)
      await f.page.getByRole('button', { name: 'Close workstream', exact: true }).click()
      await visibleCanvasItem(f.page, card)
      assert({
        given: 'the camera moved away while details were open',
        should: 'recover the unselected overview when details close',
        actual: [new URL(f.page.url()).pathname, await f.page.locator(card).getAttribute('data-selected')],
        expected: ['/workstreams', 'false'],
      })

      await f.page.getByText('Timeline', { exact: true }).click()
      const lane = `.sky-workstreams-lane-label[data-workstream="${id}"]`
      await visibleCanvasItem(f.page, lane)
      assert({
        given: 'switching to Timeline with its own offscreen saved camera',
        should: 'show a complete, clickable lane label without opening details',
        actual: [
          await f.page.locator(lane).getAttribute('data-selected'),
          await f.page.locator('.sky-workstream-detail').count(),
        ],
        expected: ['false', 0],
      })
      if (shots)
        await f.page.screenshot({ path: path.join(shots, 'overview-recovered-timeline.png'), animations: 'disabled' })
      await f.page.evaluate(() => {
        localStorage.setItem('sky-workstreams-camera-map', JSON.stringify({ x: 16000, y: -12000, zoom: 1 }))
      })
      await f.page.getByText('Map', { exact: true }).click()
      await visibleCanvasItem(f.page, card)

      await pan(12000, -9000)
      const panned = await world.getAttribute('style')
      await f.page.getByRole('button', { name: 'Zoom in (+)', exact: true }).click()
      await f.page.waitForFunction(
        (previous) => document.querySelector('.sky-workstreams-world')?.getAttribute('style') !== previous,
        panned,
      )
      const userCamera = await world.getAttribute('style')
      const [refreshed] = await Promise.all([
        f.page.waitForResponse(
          (result) => result.url().endsWith('/workstreams/_api/status') && result.status() === 200,
        ),
        f.page.evaluate(() => window.dispatchEvent(new Event('focus'))),
      ])
      await refreshed.finished()
      await f.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert({
        given: 'manual pan away and zoom on the recovered overview followed by the polling refresh path',
        should: 'preserve the owner’s camera without repeatedly recentering or starting a capture',
        actual: [await world.getAttribute('style'), f.calls.length, f.errors],
        expected: [userCamera, 0, []],
      })
    } finally {
      await f.cleanup()
    }
  },
)

const timing: Partial<CaptureResponse> = {
  horizon: null,
  horizonLabel: 'Timing not set',
  question: { field: 'timing', prompt: 'Roughly when do you want this done?', choices: [] },
}
const clarification: Partial<CaptureResponse> = {
  question: { field: 'situation', prompt: QUESTION, choices: [] },
}

async function eventually(check: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out: ${message}`)
}

async function fixture(mobile = false, theme: 'light' | 'dark' = 'light') {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-capture-wizard-'))
  const store = new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root, () =>
    NOW.slice(0, 10),
  )
  const calls: CaptureCall[] = []
  const app = createTestHttpApp([path.join(root, 'workstreams'), path.join(root, 'time')], {
    chat: {
      timeDir: path.join(root, 'time'),
      createSession: async () => {
        throw new Error('The capture fixture never starts a chat.')
      },
    },
    workstreams: {
      store,
      now: () => NOW,
      today: () => NOW.slice(0, 10),
      setup: async () => ({}),
      automation: async () => null,
      capture: (input) => new Promise((resolve, reject) => calls.push({ input, resolve, reject })),
      draft: async () => {
        throw new Error('Capture must not request a full workstream draft.')
      },
      run: async () => {
        throw new Error('This fixture creates human-led work only.')
      },
      planDay: async () => {
        throw new Error('The capture fixture never changes a day.')
      },
    },
  })
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  const browser = await chromium.launch({
    headless: true,
    executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
  })
  const page = await browser.newPage({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    isMobile: mobile,
    hasTouch: mobile,
  })
  page.setDefaultTimeout(10_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/settings/_api/settings', (route) => route.fulfill({ json: { theme, textSize: 'normal' } }))
  await page.goto(`http://127.0.0.1:${address.port}/workstreams`)
  if (theme === 'dark')
    await page.waitForFunction(() => document.documentElement.getAttribute('data-mantine-color-scheme') === 'dark')
  const dialog = page.getByRole('dialog')
  const intention = () => dialog.getByRole('textbox', { name: 'What do you want to get done?', exact: true })
  const submit = async (text: string) => {
    const count = calls.length
    const box = page.getByRole('textbox', { name: 'What do you want to get done?', exact: true })
    await box.fill(text)
    if (mobile) await page.getByRole('button', { name: 'Send', exact: true }).click()
    else await box.press('Enter')
    await eventually(() => calls.length === count + 1, 'capture started')
  }
  const answer = async (index: number, changes: Partial<CaptureResponse> = {}) => {
    await eventually(() => calls.length > index, `capture call ${index}`)
    calls[index]!.resolve(response(calls[index]!.input, changes))
  }
  const screenshot = async (name: string) => {
    const directory = env.get('SKY_WORKSTREAM_CAPTURE_SCREENSHOTS')
    if (!directory) return
    await page.waitForFunction(() => {
      const element = document.querySelector('.mantine-Modal-content')
      return element && Number(getComputedStyle(element).opacity) >= 0.999
    })
    await page.screenshot({ path: path.join(directory, name), animations: 'disabled' })
  }
  return {
    root,
    store,
    page,
    dialog,
    intention,
    calls,
    errors,
    submit,
    answer,
    screenshot,
    cleanup: async () => {
      for (const call of calls) call.resolve(response(call.input))
      await browser.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    },
  }
}

/** Real touch input exercises the browser's pointer/touch dispatch and scrolling, rather than calling React handlers. */
async function swipe(page: Page, target: Locator, dx: number, dy = 0): Promise<void> {
  await target.scrollIntoViewIfNeeded()
  const rect = await target.boundingBox()
  if (!rect) throw new Error('Missing swipe target')
  const x = rect.x + (dx < 0 ? 0.8 : 0.2) * rect.width
  const y = rect.y + rect.height / 2
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let step = 1; step <= 6; step++)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (dx * step) / 6, y: y + (dy * step) / 6 }],
      })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await session.detach()
  }
}

test(
  {
    name: 'capture wizard restores visited steps, invalidates edited branches and adopts wording only by choice',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 90000,
  },
  async () => {
    const f = await fixture()
    const nav = f.dialog.getByRole('navigation', { name: 'Workstream setup steps' })
    const back = f.dialog.getByRole('button', { name: 'Back', exact: true })
    const next = f.dialog.getByRole('button', { name: 'Continue', exact: true })
    const ready = f.dialog.getByRole('button', { name: 'Start workstream', exact: true })
    const question = f.dialog.getByRole('textbox', { name: QUESTION, exact: true })
    try {
      await f.submit(INTENTION)
      await f.answer(0, timing)
      await f.dialog.getByRole('button', { name: 'A few months', exact: true }).waitFor()
      await back.click()
      assert({
        given: 'the first timing question and a step back',
        should: 'restore the original intention as editable text',
        actual: await f.intention().inputValue(),
        expected: INTENTION,
      })
      await next.click()
      await f.dialog.getByRole('button', { name: 'A few months', exact: true }).waitFor()
      assert({
        given: 'unchanged forward navigation to a visited question',
        should: 'restore the result without another model request',
        actual: f.calls.length,
        expected: 1,
      })
      await f.dialog.getByRole('button', { name: 'A few months', exact: true }).click()
      assert({
        given: 'a timing option selected before Continue',
        should: 'mark the choice without submitting or creating work',
        actual: [
          await f.dialog.getByRole('button', { name: 'A few months', exact: true }).getAttribute('aria-pressed'),
          f.calls.length,
          (await f.store.list()).length,
        ],
        expected: ['true', 1, 0],
      })
      await next.click()
      await f.answer(1, clarification)
      await question.fill('The vendor approved the scope.')
      await question.press('Enter')
      await f.answer(2)
      await ready.waitFor()
      assert({
        given: 'a complete starting point with context and alternative wording from Sky',
        should: 'keep the original outcome and leave both context and suggested wording secondary',
        actual: [
          await f.dialog.locator('.sky-workstream-capture-outcome').textContent(),
          await f.dialog.getByText(CONTEXT, { exact: true }).isVisible(),
          await f.dialog.getByText(SUGGESTION, { exact: true }).isVisible(),
          (await f.store.list()).length,
        ],
        expected: [INTENTION, false, false, 0],
      })
      await f.dialog.getByText('Context Sky found', { exact: true }).click()
      await f.dialog.getByText(CONTEXT, { exact: true }).waitFor()
      await f.dialog.getByText('Context Sky found', { exact: true }).click()
      await back.click()
      assert({
        given: 'Back from review to the answered question',
        should: 'restore the exact answer draft',
        actual: await question.inputValue(),
        expected: 'The vendor approved the scope.',
      })
      await next.click()
      await ready.waitFor()
      assert({
        given: 'an unchanged answer revisited and continued',
        should: 'reuse the review instead of asking Sky again',
        actual: f.calls.length,
        expected: 3,
      })

      await nav.getByRole('button', { name: 'Timing', exact: true }).click()
      await f.dialog.getByRole('button', { name: 'This week', exact: true }).click()
      await next.click()
      await f.dialog.getByRole('button', { name: 'Add to this week', exact: true }).waitFor()
      assert({
        given: 'timing changed to this week after reaching a workstream review',
        should: 'replace the old creation action without saving anything',
        actual: [await ready.count(), f.calls.length, (await f.store.list()).length],
        expected: [0, 3, 0],
      })
      await nav.getByRole('button', { name: 'Timing', exact: true }).click()
      await f.dialog.getByRole('button', { name: 'A few weeks', exact: true }).click()
      await next.click()
      await eventually(() => f.calls.length === 4, 'changed timing triggers a fresh request')
      assert({
        given: 'another timing change while the new result is pending',
        should: 'invalidate both previous final actions',
        actual: [await ready.count(), await f.dialog.getByRole('button', { name: 'Add to this week' }).count()],
        expected: [0, 0],
      })
      await f.answer(3, clarification)
      await question.waitFor()
      assert({
        given: 'the same useful question after the timing change',
        should: 'retain its answer as an editable draft',
        actual: await question.inputValue(),
        expected: 'The vendor approved the scope.',
      })
      await next.click()
      await f.answer(4)
      await ready.waitFor()
      await nav.getByRole('button', { name: 'Context', exact: true }).click()
      await question.fill('The vendor approved the revised scope.')
      await next.click()
      await eventually(() => f.calls.length === 6, 'changed answer triggers a fresh request')
      assert({
        given: 'an edited prior answer',
        should: 'send the new answer and hide the obsolete review while Sky responds',
        actual: [f.calls[5]!.input.answers.at(-1)?.answer, await ready.count()],
        expected: ['The vendor approved the revised scope.', 0],
      })
      await f.answer(5)
      await ready.waitFor()
      await nav.getByRole('button', { name: 'Intention', exact: true }).click()
      const changed = 'Bring 24 customers into the Atlas pilot.'
      await f.intention().fill(changed)
      await next.click()
      await eventually(() => f.calls.length === 7, 'changed intention triggers a fresh request')
      assert({
        given: 'a revised original intention',
        should: 'request a new understanding before allowing creation',
        actual: [f.calls[6]!.input.intent, await ready.count(), (await f.store.list()).length],
        expected: [changed, 0, 0],
      })
      await f.answer(6)
      await ready.waitFor()
      await f.dialog.getByRole('button', { name: 'Sharpen wording', exact: true }).click()
      const outcome = f.dialog.getByRole('textbox', { name: 'Outcome', exact: true })
      assert({
        given: 'a changed intention and Sky’s proposed alternative',
        should: 'keep the current owner wording until the suggestion is explicitly selected',
        actual: await outcome.inputValue(),
        expected: changed,
      })
      await f.dialog.getByRole('button', { name: 'Use suggested wording', exact: true }).click()
      assert({
        given: 'explicit selection of Sky’s wording',
        should: 'put that suggestion into the editable outcome',
        actual: await outcome.inputValue(),
        expected: SUGGESTION,
      })
      await f.dialog.getByRole('button', { name: 'Done editing', exact: true }).click()
      await f.dialog.getByRole('checkbox', { name: 'Let Sky check in and prepare next steps', exact: true }).uncheck()
      await f.screenshot('wizard-review-desktop.png')
      await ready.click()
      await f.dialog.waitFor({ state: 'hidden' })
      const items = await f.store.list()
      assert({
        given: 'the final explicit Start click after revisiting and editing several steps',
        should: 'create one workstream with the accepted wording and no browser errors',
        actual: [items.length, items[0]?.outcome, items[0]?.sky.mode, f.errors],
        expected: [1, SUGGESTION, 'off', []],
      })
    } finally {
      await f.cleanup()
    }
  },
)

test(
  {
    name: 'capture wizard ignores stale reads and retries failed reads and saves without changing the current intention',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 90000,
  },
  async () => {
    const f = await fixture()
    const ready = f.dialog.getByRole('button', { name: 'Start workstream', exact: true })
    try {
      await f.submit('First Atlas intention.')
      await f.dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await f.dialog.waitFor({ state: 'hidden' })
      const newer = 'The newer Atlas intention.'
      await f.submit(newer)
      await f.answer(1)
      await ready.waitFor()
      await f.answer(0, { outcome: 'Obsolete response.', understanding: 'Obsolete context.' })
      await f.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert({
        given: 'a canceled request finishing after a newer flow is ready',
        should: 'keep the newer intention and ignore the stale result',
        actual: [
          await f.dialog.locator('.sky-workstream-capture-outcome').textContent(),
          await f.dialog.getByText('Obsolete context.', { exact: true }).count(),
        ],
        expected: [newer, 0],
      })
      await f.dialog
        .getByRole('navigation', { name: 'Workstream setup steps' })
        .getByRole('button', { name: 'Intention', exact: true })
        .click()
      const edited = 'The edited Atlas intention.'
      await f.intention().fill(edited)
      await f.dialog.getByRole('button', { name: 'Continue', exact: true }).click()
      await eventually(() => f.calls.length === 3, 'edited intention review')
      f.calls[2]!.reject(new Error('Synthetic context failure.'))
      await f.dialog.getByRole('alert').waitFor()
      await f.dialog.getByRole('button', { name: 'Try again', exact: true }).click()
      await eventually(() => f.calls.length === 4, 'retry')
      assert({
        given: 'an edited intention whose context request fails',
        should: 'retry the same current request without saving or restoring obsolete wording',
        actual: [f.calls[3]!.input, (await f.store.list()).length],
        expected: [f.calls[2]!.input, 0],
      })
      await f.answer(3)
      await ready.waitFor()
      assert({
        given: 'a successful retry',
        should: 'show the edited intention and leave creation explicit',
        actual: [await f.dialog.locator('.sky-workstream-capture-outcome').textContent(), f.errors],
        expected: [edited, []],
      })
      await f.dialog.getByRole('checkbox', { name: 'Let Sky check in and prepare next steps', exact: true }).uncheck()
      const payloads: unknown[] = []
      await f.page.route('**/workstreams/_api/create', async (route) => {
        payloads.push(route.request().postDataJSON())
        const saved = await route.fetch()
        if (payloads.length === 1)
          await route.fulfill({ status: 503, json: { message: 'Synthetic response lost after saving.' } })
        else await route.fulfill({ response: saved })
      })
      await ready.click()
      const retrySave = f.dialog.getByRole('button', { name: 'Retry saving', exact: true })
      await retrySave.waitFor()
      assert({
        given: 'a save completed on the server but its response was lost',
        should: 'freeze the pending branch and offer an explicit retry',
        actual: [
          (await f.store.list()).length,
          await f.dialog
            .getByRole('navigation', { name: 'Workstream setup steps' })
            .getByRole('button', { name: 'Intention', exact: true })
            .isDisabled(),
          await f.dialog.getByRole('button', { name: 'Edit outcome', exact: true }).isDisabled(),
        ],
        expected: [1, true, true],
      })
      await retrySave.click()
      await f.dialog.waitFor({ state: 'hidden' })
      assert({
        given: 'retrying the ambiguous save',
        should: 'send the identical payload and request ID and retain exactly one saved workstream',
        actual: [payloads.length, payloads[1], (await f.store.list()).map((item) => item.outcome)],
        expected: [2, payloads[0], [edited]],
      })
    } finally {
      await f.cleanup()
    }
  },
)

test(
  {
    name: 'mobile capture swipes only between visited steps and preserves typing and vertical scrolling',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 90000,
  },
  async () => {
    const f = await fixture(true, 'dark')
    const nav = f.dialog.getByRole('navigation', { name: 'Workstream setup steps' })
    const next = f.dialog.getByRole('button', { name: 'Continue', exact: true })
    const timingHeading = f.dialog.getByRole('heading', { name: 'Roughly when do you want this done?', exact: true })
    const timingText = f.dialog.locator('.sky-workstream-capture-question .sky-workstream-capture-intent')
    const ready = f.dialog.getByRole('button', { name: 'Start workstream', exact: true })
    try {
      const initialBox = f.page.getByRole('textbox', { name: 'What do you want to get done?', exact: true })
      await initialBox.fill(INTENTION)
      await initialBox.press('Enter')
      assert({
        given: 'an intention being typed on a touch device',
        should: 'let Return add a line rather than submit',
        actual: [await initialBox.inputValue(), f.calls.length],
        expected: [INTENTION + '\n', 0],
      })
      await f.submit(INTENTION)
      await f.answer(0, timing)
      await timingHeading.waitFor()
      await swipe(f.page, timingText, -140)
      assert({
        given: 'a left swipe toward a step that has not been reached',
        should: 'stay on timing without submitting a choice or creating work',
        actual: [await timingHeading.isVisible(), f.calls.length, (await f.store.list()).length],
        expected: [true, 1, 0],
      })
      await swipe(f.page, timingText, 140)
      await f.intention().waitFor()
      assert({
        given: 'the original intention reopened by a right swipe',
        should: 'restore its text without another request',
        actual: [await f.intention().inputValue(), f.calls.length],
        expected: [INTENTION, 1],
      })
      await swipe(f.page, f.intention(), -140)
      assert({
        given: 'a horizontal drag beginning inside the text input',
        should: 'leave the current step and text intact',
        actual: [await f.intention().isVisible(), await f.intention().inputValue()],
        expected: [true, INTENTION],
      })
      await next.click()
      await timingHeading.waitFor()
      await f.dialog.getByRole('button', { name: 'A few months', exact: true }).click()
      await next.click()
      await f.answer(1)
      await ready.waitFor()
      const outcome = f.dialog.locator('.sky-workstream-capture-outcome')
      await swipe(f.page, outcome, -140)
      assert({
        given: 'a left swipe on the final review',
        should: 'never substitute for Start workstream',
        actual: [await ready.isVisible(), (await f.store.list()).length],
        expected: [true, 0],
      })
      await swipe(f.page, outcome, 140)
      await timingHeading.waitFor()
      await swipe(f.page, timingText, -140)
      await ready.waitFor()
      await swipe(f.page, outcome, 10, 100)
      assert({
        given: 'visited-step horizontal navigation followed by a mostly vertical gesture',
        should: 'restore the review without another request and keep vertical scrolling on that step',
        actual: [await ready.isVisible(), f.calls.length, (await f.store.list()).length],
        expected: [true, 2, 0],
      })
      await f.dialog.getByRole('button', { name: 'Edit outcome', exact: true }).click()
      const edit = f.dialog.getByRole('textbox', { name: 'Outcome', exact: true })
      await edit.press('Enter')
      await swipe(f.page, edit, 140)
      assert({
        given: 'typing and dragging within the outcome editor',
        should: 'preserve editing and keep the original wording available',
        actual: [
          await edit.isVisible(),
          (await edit.inputValue()).replace('\n', ''),
          (await edit.inputValue()).includes('\n'),
          f.calls.length,
        ],
        expected: [true, INTENTION, true, 2],
      })
      await edit.fill(INTENTION)
      await f.page.setViewportSize({ width: 390, height: 430 })
      await f.dialog.getByRole('button', { name: 'Done editing', exact: true }).scrollIntoViewIfNeeded()
      await f.screenshot('wizard-mobile-keyboard-dark.png')
      await f.dialog.getByRole('button', { name: 'Done editing', exact: true }).click()
      await ready.scrollIntoViewIfNeeded()
      await f.page.setViewportSize({ width: 390, height: 844 })
      await f.screenshot('wizard-review-mobile-dark.png')
      assert({
        given: 'mobile editing, navigation and a reduced keyboard viewport',
        should: 'keep the final action reachable without horizontal overflow, unsolicited saves or browser errors',
        actual: [
          await ready.isVisible(),
          await f.page.evaluate(() => document.documentElement.scrollWidth),
          await nav.getByRole('button', { name: 'Review', exact: true }).isEnabled(),
          (await f.store.list()).length,
          f.errors,
        ],
        expected: [true, 390, true, 0, []],
      })
    } finally {
      await f.cleanup()
    }
  },
)

test(
  {
    name: 'new work joins a manually arranged group without overlapping or moving existing work',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 90000,
  },
  async () => {
    const f = await fixture()
    const arranged = {
      'pilot-scope': { x: 4480, y: -1440, order: 0, color: 'mint' },
      'pilot-launch': { x: 4480, y: -1261, order: 1, color: 'violet' },
      'pilot-followup': { x: 4480, y: -1082, order: 2, color: 'blue' },
    }
    const status = async (): Promise<WorkstreamReport> =>
      (await f.page.request.get(new URL('/workstreams/_api/status', f.page.url()).href)).json()
    try {
      for (const [id, position] of Object.entries(arranged)) {
        await f.store.create({ id, title: id.replaceAll('-', ' '), outcome: 'Advance the Atlas pilot.' }, NOW)
        const moved = await f.page.request.put(new URL('/workstreams/_api/layout', f.page.url()).href, {
          data: { id, ...position },
        })
        if (!moved.ok()) throw new Error('Could not arrange the synthetic workstream group.')
      }
      const before = await status()
      await f.page.evaluate(() => {
        localStorage.setItem('sky-workstreams-view', 'map')
        localStorage.setItem('sky-workstreams-camera-map', JSON.stringify({ x: -4000, y: 1700, zoom: 1 }))
      })
      await f.page.reload()
      await f.page.getByRole('button', { name: '＋ Add', exact: true }).click()
      await f.intention().fill('Prepare the Atlas customer workshop over the next few weeks.')
      await f.dialog.getByRole('button', { name: 'Continue', exact: true }).click()
      await f.answer(0, { horizon: 'few-weeks', horizonLabel: 'A few weeks' })
      await f.dialog.getByRole('checkbox', { name: 'Let Sky check in and prepare next steps', exact: true }).uncheck()
      const creation = f.page.waitForResponse(
        (value) => value.url().endsWith('/workstreams/_api/create') && value.request().method() === 'POST',
      )
      await f.dialog.getByRole('button', { name: 'Start workstream', exact: true }).click()
      const created = (await (await creation).json()) as WorkstreamRecord & {
        position?: WorkstreamReport['layout'][string]
      }
      await f.dialog.waitFor({ state: 'hidden' })
      const card = `.sky-workstreams-card[data-workstream="${created.id}"]`
      await visibleCanvasItem(f.page, card)
      const initial = await status()
      const position = initial.layout[created.id]
      assert({
        given: 'three workstreams manually stacked far from the default canvas origin',
        should: 'persist the new placement before revealing the created card and return that exact placement',
        actual: [Boolean(position), created.position, f.calls.length],
        expected: [true, position, 1],
      })
      if (!position) throw new Error('The newly created workstream has no saved canvas position.')
      const dimensions = await f.page.locator(card).evaluate((element) => ({
        width: (element as HTMLElement).offsetWidth,
        height: (element as HTMLElement).offsetHeight,
      }))
      const gaps = Object.values(arranged).map((old) => {
        const horizontal = Math.max(old.x - position.x - dimensions.width, position.x - old.x - dimensions.width, 0)
        const vertical = Math.max(old.y - position.y - dimensions.height, position.y - old.y - dimensions.height, 0)
        return Math.hypot(horizontal, vertical)
      })
      assert({
        given: 'the real card dimensions and the group’s saved positions',
        should: 'place new work adjacent to the group with separation from every existing card',
        actual: [Math.min(...gaps) <= 100, gaps.every((gap) => gap >= 40)],
        expected: [true, true],
      })
      assert({
        given: 'creation beside an existing arrangement',
        should: 'retain every prior coordinate, color, order, and canonical work revision',
        actual: [
          Object.fromEntries(Object.keys(arranged).map((id) => [id, initial.layout[id]])),
          initial.items.filter((item) => item.id in arranged).map((item) => [item.id, item.revision]),
        ],
        expected: [arranged, before.items.map((item) => [item.id, item.revision])],
      })
      const renderedPosition = await f.page.locator(card).evaluate((element) => ({
        x: Number.parseFloat((element as HTMLElement).style.left),
        y: Number.parseFloat((element as HTMLElement).style.top),
      }))
      const mapColor = await f.page.locator(card).evaluate((element) => getComputedStyle(element).backgroundColor)
      assert({
        given: 'the first render after creation',
        should: 'use the saved group placement immediately and inherit the default blue surface',
        actual: [renderedPosition, await f.page.locator(card).getAttribute('data-color')],
        expected: [{ x: position.x, y: position.y }, 'blue'],
      })

      await f.page.reload()
      await visibleCanvasItem(f.page, card)
      assert({
        given: 'a reload while the new workstream remains selected',
        should: 'restore the identical arrangement instead of recomputing a default grid position',
        actual: (await status()).layout,
        expected: initial.layout,
      })
      await f.page.getByRole('button', { name: 'Close workstream', exact: true }).click()
      await f.page.getByRole('button', { name: 'Fit', exact: true }).click()
      for (const id of [...Object.keys(arranged), created.id])
        await visibleCanvasItem(f.page, `.sky-workstreams-card[data-workstream="${id}"]`)
      const shots = env.get('SKY_WORKSTREAM_CAPTURE_SCREENSHOTS')
      if (shots)
        await f.page.screenshot({ path: path.join(shots, 'created-near-arranged-group.png'), animations: 'disabled' })

      await f.page.getByText('Timeline', { exact: true }).click()
      const lane = `.sky-workstreams-lane-label[data-workstream="${created.id}"]`
      await f.page.getByRole('button', { name: 'Fit', exact: true }).click()
      await visibleCanvasItem(f.page, lane)
      assert({
        given: 'the same new workstream in Timeline',
        should: 'retain the Map card’s default blue background',
        actual: await f.page.locator(lane).evaluate((element) => getComputedStyle(element).backgroundColor),
        expected: mapColor,
      })
      await f.page.getByText('Map', { exact: true }).click()
      await visibleCanvasItem(f.page, card)
      assert({
        given: 'returning to the Map after creation, reload, and Timeline navigation',
        should: 'keep the arrangement and a real card hit target without browser errors or extra model calls',
        actual: [(await status()).layout, f.calls.length, f.errors],
        expected: [initial.layout, 1, []],
      })
    } finally {
      await f.cleanup()
    }
  },
)

test(
  {
    name: 'creating from a filtered canvas reveals the new card and preserves later camera changes across refreshes',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 90000,
  },
  async () => {
    const f = await fixture()
    try {
      await f.store.create(
        {
          id: 'earlier-pilot',
          title: 'Earlier pilot',
          outcome: 'Keep the earlier pilot running.',
          stakeholders: [{ id: 'jane-doe', name: 'Jane Doe', role: 'Owner', contact: '' }],
        },
        NOW,
      )
      await f.page.evaluate(() => {
        localStorage.setItem('sky-workstreams-view', 'map')
        localStorage.setItem('sky-workstreams-camera-map', JSON.stringify({ x: 18000, y: -12000, zoom: 0.1 }))
      })
      await f.page.reload()
      const search = f.page.getByLabel('Find a workstream', { exact: true })
      const person = f.page.getByRole('combobox', { name: 'Filter by stakeholder', exact: true })
      await search.fill('Earlier')
      await person.click()
      await f.page.getByRole('option', { name: 'Jane Doe', exact: true }).click()
      await f.page.getByRole('button', { name: '＋ Add', exact: true }).click()
      const intention = 'Ship a new Atlas milestone over the next few weeks.'
      await f.intention().fill(intention)
      await f.dialog.getByRole('button', { name: 'Continue', exact: true }).click()
      await f.answer(0)
      await f.dialog.getByRole('checkbox', { name: 'Let Sky check in and prepare next steps', exact: true }).uncheck()
      await f.dialog.getByRole('button', { name: 'Start workstream', exact: true }).click()
      await f.dialog.waitFor({ state: 'hidden' })
      await f.page.locator('.sky-workstream-detail').waitFor()
      const created = (await f.store.list()).find((item) => item.id !== 'earlier-pilot')!
      await f.page.waitForFunction(
        (id) => {
          const canvas = document.querySelector('.sky-workstreams-canvas')
          const card = document.querySelector(`.sky-workstreams-card[data-workstream="${id}"]`)
          if (!canvas || !card) return false
          const viewport = canvas.getBoundingClientRect()
          const rect = card.getBoundingClientRect()
          const center = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          return (
            rect.width >= Math.min(240, viewport.width * 0.7) &&
            rect.left >= viewport.left &&
            rect.right <= viewport.right &&
            rect.top >= viewport.top &&
            rect.bottom <= viewport.bottom &&
            !!center &&
            card.contains(center)
          )
        },
        created.id,
        { timeout: 2000 },
      )
      assert({
        given: 'a new workstream created through restrictive filters with a far-away, 10% saved camera',
        should: 'clear the filters and show the complete selected card alongside its open detail immediately',
        actual: [
          await search.inputValue(),
          await person.inputValue(),
          await f.page.locator(`.sky-workstreams-card[data-workstream="${created.id}"]`).getAttribute('data-selected'),
          await f.page.locator('.sky-workstream-detail').isVisible(),
        ],
        expected: ['', '', 'true', true],
      })
      const shots = env.get('SKY_WORKSTREAM_CAPTURE_SCREENSHOTS')
      if (shots)
        await f.page.screenshot({ path: path.join(shots, 'created-card-low-zoom-filters.png'), animations: 'disabled' })

      const world = f.page.locator('.sky-workstreams-world')
      const revealedCamera = await world.getAttribute('style')
      const canvas = await f.page.locator('.sky-workstreams-canvas').boundingBox()
      if (!canvas) throw new Error('Missing canvas')
      await f.page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.75)
      await f.page.mouse.wheel(180, 80)
      await f.page.waitForFunction(
        (previous) => document.querySelector('.sky-workstreams-world')?.getAttribute('style') !== previous,
        revealedCamera,
      )
      const pannedCamera = await world.getAttribute('style')
      await f.page.getByRole('button', { name: 'Zoom in (+)', exact: true }).click()
      await f.page.waitForFunction(
        (previous) => document.querySelector('.sky-workstreams-world')?.getAttribute('style') !== previous,
        pannedCamera,
      )
      const userCamera = await world.getAttribute('style')
      const [refreshed] = await Promise.all([
        f.page.waitForResponse(
          (result) => result.url().endsWith('/workstreams/_api/status') && result.status() === 200,
        ),
        f.page.evaluate(() => window.dispatchEvent(new Event('focus'))),
      ])
      await refreshed.finished()
      await f.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert({
        given: 'manual pan and zoom after the reveal followed by a normal status refresh',
        should: 'leave the camera where the owner put it',
        actual: [await world.getAttribute('style'), f.errors],
        expected: [userCamera, []],
      })
    } finally {
      await f.cleanup()
    }
  },
)
