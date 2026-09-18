import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { chromium, type Locator, type Page } from 'playwright'
import { WorkstreamStore } from '#lib/workstreams/store.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'

const NOW = '2025-03-15 12:00'

async function onScreen(control: Locator): Promise<boolean> {
  return control.evaluate(async (element) => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement)
      await Promise.all(ancestor.getAnimations().map((animation) => animation.finished.catch(() => {})))
    const box = element.getBoundingClientRect()
    return (
      box.width > 0 &&
      box.height > 0 &&
      box.left >= 0 &&
      box.top >= 0 &&
      box.right <= window.innerWidth &&
      box.bottom <= window.innerHeight
    )
  })
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    },
  )
}

test(
  {
    name: 'deleted work can be hidden, restored, or permanently deleted on desktop and phone',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 90000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-workstreams-deleted-e2e-'))
    const store = new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root, () =>
      NOW.slice(0, 10),
    )
    const first = await store.create({ id: 'widget', title: 'Widget launch' }, NOW)
    const second = await store.create({ id: 'atlas', title: 'Atlas pilot' }, NOW)
    const active = await store.create({ id: 'research', title: 'Pilot research' }, NOW)
    await store.delete(first.id, first.revision, '2025-03-15 12:01')
    const originalReceipt = await store.delete(second.id, second.revision, '2025-03-15 12:02')
    const unavailable = async (): Promise<never> => {
      throw new Error('This browser fixture has no model or external executor.')
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
    let currentPage: Page | undefined
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
      currentPage = page
      page.setDefaultTimeout(10000)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`${origin}/workstreams`)
      const notice = page.locator('.sky-workstreams-delete-notice')
      await notice.getByRole('button', { name: `Undo delete ${second.title}`, exact: true }).waitFor()
      assert({
        given: 'multiple previously deleted workstreams',
        should: 'show only one compact notice and retain both recoverable records',
        actual: [await notice.count(), (await store.report()).deleted.length],
        expected: [1, 2],
      })
      await page.getByRole('button', { name: 'Hide deletion notices', exact: true }).click()
      await notice.waitFor({ state: 'hidden' })
      await page.reload()
      const deletedButton = page.getByRole('button', { name: 'View deleted work', exact: true })
      await deletedButton.waitFor()
      assert({
        given: 'Hide followed by a full page reload',
        should: 'keep deletion notices dismissed without discarding either recovery record',
        actual: [await notice.count(), (await store.report()).deleted.length, await deletedButton.textContent()],
        expected: [0, 2, 'Deleted work (2)'],
      })
      await deletedButton.focus()
      await page.keyboard.press('Enter')
      const manager = page.getByRole('dialog', { name: 'Deleted work', exact: true })
      await manager.waitFor()
      await manager.getByRole('button', { name: `Undo delete ${second.title}`, exact: true }).click()
      await page.locator(`.sky-workstreams-card[data-workstream="${second.id}"]`).waitFor()
      const restored = (await store.get(second.id))!
      assert({
        given: 'a hidden deletion opened through Deleted work and restored',
        should: 'recover that exact workstream while retaining the other deleted record',
        actual: [restored.id, (await store.report()).deleted.map((receipt) => receipt.id)],
        expected: [second.id, [first.id]],
      })
      const newReceipt = await store.delete(restored.id, restored.revision, '2025-03-15 12:03')
      await page.reload()
      await notice.getByRole('button', { name: `Undo delete ${second.title}`, exact: true }).waitFor()
      assert({
        given: 'the same identity restored and then deleted again',
        should: 'show the new deletion event even though its earlier notice was hidden',
        actual: [newReceipt.revision !== originalReceipt.revision, await notice.count()],
        expected: [true, 1],
      })
      await deletedButton.click()
      await manager.getByRole('button', { name: `Delete permanently ${second.title}`, exact: true }).click()
      const confirmation = page.getByRole('dialog', { name: `Delete “${second.title}” permanently?`, exact: true })
      await confirmation.waitFor()
      await manager.waitFor({ state: 'hidden' })
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
      await confirmation.waitFor({ state: 'hidden' })
      await page.reload()
      await deletedButton.waitFor()
      assert({
        given: 'a permanent deletion confirmation canceled and the page reloaded',
        should: 'retain the recoverable workstream file and both deletion records',
        actual: [await exists(path.join(root, second.path)), (await store.report()).deleted.length],
        expected: [true, 2],
      })
      const purgePath = `**/workstreams/_api/${second.id}/purge`
      const failure = 'The workstream could not be permanently deleted. Try again.'
      await page.route(purgePath, async (route) => {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ message: failure }),
        })
      })
      await deletedButton.click()
      await manager.getByRole('button', { name: `Delete permanently ${second.title}`, exact: true }).click()
      await confirmation.getByRole('button', { name: 'Delete permanently', exact: true }).click()
      await confirmation.getByText(failure, { exact: true }).waitFor()
      assert({
        given: 'a permanent deletion rejected by the server',
        should: 'show the error and preserve both recovery records',
        actual: [await exists(path.join(root, second.path)), (await store.report()).deleted.length],
        expected: [true, 2],
      })
      await page.unroute(purgePath)
      await page.reload()
      await deletedButton.click()
      await manager.getByRole('button', { name: `Delete permanently ${second.title}`, exact: true }).click()
      await confirmation.waitFor()
      await onScreen(confirmation.getByRole('button', { name: 'Delete permanently', exact: true }))
      await page.screenshot({ path: path.join(tmpdir(), 'sky-workstreams-deleted-desktop.png') })
      const purged = page.waitForResponse(
        (response) => response.url().endsWith(`/${second.id}/purge`) && response.request().method() === 'POST',
      )
      await confirmation.getByRole('button', { name: 'Delete permanently', exact: true }).focus()
      await page.keyboard.press('Enter')
      const purgeResponse = await purged
      await page.waitForURL(`${origin}/workstreams`)
      assert({
        given: 'permanent deletion confirmed with the keyboard',
        should: 'delete only the selected workstream file and its recovery record, then return to the canvas',
        actual: [
          purgeResponse.status(),
          await exists(path.join(root, second.path)),
          (await store.report()).deleted.map((receipt) => receipt.id),
          (await store.list()).map((work) => work.id),
        ],
        expected: [200, false, [first.id], [active.id]],
      })
      await page.reload()
      await deletedButton.waitFor()
      assert({
        given: 'the completed permanent deletion followed by a reload',
        should: 'retain only the other hidden recovery record and keep the canvas clear of notices',
        actual: [await notice.count(), await deletedButton.textContent()],
        expected: [0, 'Deleted work (1)'],
      })

      const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
      currentPage = mobile
      mobile.setDefaultTimeout(10000)
      mobile.on('pageerror', (error) => errors.push(error.message))
      await mobile.goto(`${origin}/workstreams`)
      const mobileNotice = mobile.locator('.sky-workstreams-delete-notice')
      await mobileNotice.waitFor()
      const hide = mobile.getByRole('button', { name: 'Hide deletion notices', exact: true })
      assert({
        given: 'a deletion notice on a phone',
        should: 'keep its Hide and Undo controls within the viewport',
        actual: [
          await onScreen(hide),
          await onScreen(mobileNotice.getByRole('button', { name: `Undo delete ${first.title}`, exact: true })),
        ],
        expected: [true, true],
      })
      await hide.tap()
      await mobileNotice.waitFor({ state: 'hidden' })
      await mobile.reload()
      const mobileDeleted = mobile.getByRole('button', { name: 'View deleted work', exact: true })
      await mobileDeleted.waitFor()
      assert({
        given: 'a phone notice hidden before reloading',
        should: 'retain the dismissal and an accessible Deleted work control',
        actual: [await mobileNotice.count(), await onScreen(mobileDeleted)],
        expected: [0, true],
      })
      await mobileDeleted.tap()
      const mobileManager = mobile.getByRole('dialog', { name: 'Deleted work', exact: true })
      await mobileManager.waitFor()
      const mobilePurge = mobileManager.getByRole('button', {
        name: `Delete permanently ${first.title}`,
        exact: true,
      })
      assert({
        given: 'Deleted work opened with a tap on a phone',
        should: 'present a bottom sheet with its recovery and permanent deletion actions on screen',
        actual: [
          await mobile.locator('.mantine-Drawer-content').count(),
          await onScreen(mobileManager.getByRole('button', { name: `Undo delete ${first.title}`, exact: true })),
          await onScreen(mobilePurge),
        ],
        expected: [1, true, true],
      })
      await mobile.screenshot({ path: path.join(tmpdir(), 'sky-workstreams-deleted-mobile.png') })
      await mobilePurge.tap()
      const mobileConfirmation = mobile.getByRole('dialog', {
        name: `Delete “${first.title}” permanently?`,
        exact: true,
      })
      await mobileConfirmation.waitFor()
      await mobileManager.waitFor({ state: 'hidden' })
      const confirm = mobileConfirmation.getByRole('button', { name: 'Delete permanently', exact: true })
      const cancel = mobileConfirmation.getByRole('button', { name: 'Cancel', exact: true })
      assert({
        given: 'a permanent deletion confirmation on a phone',
        should: 'keep both choices visible and reachable without horizontal scrolling',
        actual: [await onScreen(confirm), await onScreen(cancel)],
        expected: [true, true],
      })
      await cancel.tap()
      await mobileConfirmation.waitFor({ state: 'hidden' })
      await mobile.reload()
      await mobileDeleted.tap()
      await mobilePurge.tap()
      const mobilePurged = mobile.waitForResponse(
        (response) => response.url().endsWith(`/${first.id}/purge`) && response.request().method() === 'POST',
      )
      await confirm.tap()
      assert({
        given: 'permanent deletion confirmed by touch',
        should: 'remove the last deleted record and its file while leaving active work intact',
        actual: [
          (await mobilePurged).status(),
          await exists(path.join(root, first.path)),
          (await store.report()).deleted.length,
          (await store.list()).map((work) => work.id),
        ],
        expected: [200, false, 0, [active.id]],
      })
      await mobile.reload()
      await mobile.locator(`.sky-workstreams-card[data-workstream="${active.id}"]`).waitFor()
      assert({
        given: 'desktop and phone recovery management completed without external execution',
        should: 'leave no deleted-work controls or notices and produce no browser errors',
        actual: [await mobileDeleted.count(), await mobileNotice.count(), errors],
        expected: [0, 0, []],
      })
    } catch (error) {
      if (currentPage) {
        await currentPage
          .screenshot({ path: path.join(tmpdir(), 'sky-workstreams-deleted-failure.png') })
          .catch(() => {})
        const diagnostic = await currentPage
          .evaluate(() => ({
            dialogs: [...document.querySelectorAll('[role="dialog"]')].map((element) => element.outerHTML),
            text: document.body.innerText.slice(-5000),
          }))
          .catch(() => null)
        throw new Error(`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(diagnostic)}`)
      }
      throw error
    } finally {
      if (browser) await browser.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
