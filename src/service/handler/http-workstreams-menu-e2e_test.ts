import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { chromium, type Page } from 'playwright'
import { WorkstreamStore } from '#lib/workstreams/store.ts'
import { ActivitySchema, SkySchema } from '#lib/workstreams/types.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'

const NOW = '2025-03-15 12:00'

async function camera(page: Page): Promise<string | null> {
  return page.locator('.sky-workstreams-world').getAttribute('style')
}

test(
  {
    name: 'workstream menus delete the exact target and Undo restores its work without restarting Sky',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 90000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-workstreams-menu-e2e-'))
    const store = new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root, () =>
      NOW.slice(0, 10),
    )
    let target = await store.create(
      {
        id: 'widget',
        title: 'Widget launch',
        outcome: 'Prepare an agreed launch plan.',
        activities: [
          ActivitySchema.parse({
            id: 'brief',
            title: 'Prepare launch brief',
            state: 'ready',
            executor: 'sky',
            start: '2025-03-15',
            end: '2025-03-18',
          }),
        ],
      },
      NOW,
    )
    target = await store.configureSky(target.id, SkySchema.parse({ mode: 'drive' }), target.revision)
    const anchor = await store.create(
      {
        id: 'atlas',
        title: 'Atlas pilot',
        outcome: 'Learn from the pilot.',
        relations: [{ targetId: target.id, kind: 'related', reason: 'The pilot informs the launch.' }],
      },
      NOW,
    )
    const child = await store.create(
      {
        id: 'z-research',
        title: 'Pilot research',
        outcome: 'Collect the pilot findings.',
        parentId: target.id,
      },
      NOW,
    )
    let setupCalls = 0
    const unavailable = async (): Promise<never> => {
      throw new Error('This fixture has no model or external executor.')
    }
    const app = createTestHttpApp([path.join(root, 'workstreams'), path.join(root, 'time')], {
      chat: { createSession: unavailable, timeDir: path.join(root, 'time') },
      workstreams: {
        store,
        now: () => NOW,
        today: () => NOW.slice(0, 10),
        setup: async () => {
          setupCalls++
          return {}
        },
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
    let desktop: Page | undefined
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1900, height: 1100 } })
      desktop = page
      page.setDefaultTimeout(10000)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`${origin}/workstreams/${anchor.id}`)
      await page.locator('.sky-workstream-detail').waitFor()
      const card = page.locator(`.sky-workstreams-card[data-workstream="${target.id}"]`)
      await card.waitFor()
      const before = { url: page.url(), camera: await camera(page), revision: (await store.get(target.id))!.revision }
      await card.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Delete workstream', exact: true }).waitFor()
      await page.screenshot({ path: path.join(tmpdir(), 'sky-workstreams-menu-desktop.png') })
      assert({
        given: 'a right-click on a different workstream while the pilot is selected',
        should: 'open the target menu without selecting, dragging, or changing its work',
        actual: [page.url(), await camera(page), (await store.get(target.id))!.revision],
        expected: [before.url, before.camera, before.revision],
      })
      const blankCanvas = (await page.locator('.sky-workstreams-canvas').boundingBox())!
      const blankPoint = { x: blankCanvas.x + 24, y: Math.min(blankCanvas.y + blankCanvas.height - 110, 900) }
      assert({
        given: 'the outside-click regression target',
        should: 'hit visible blank canvas rather than another control or a point below the viewport',
        actual: await page.evaluate(({ x, y }) => {
          const hit = document.elementFromPoint(x, y)
          return Boolean(hit?.closest('.sky-workstreams-canvas') && !hit.closest('[data-workstream], button'))
        }, blankPoint),
        expected: true,
      })
      await page.mouse.click(blankPoint.x, blankPoint.y)
      await page.getByRole('menu').waitFor({ state: 'hidden' })
      assert({
        given: 'a left-click on blank canvas outside the open context menu',
        should: 'dismiss the menu without selecting, moving, or changing work',
        actual: [page.url(), await camera(page), (await store.get(target.id))!.revision],
        expected: [before.url, before.camera, before.revision],
      })
      await card.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Delete workstream', exact: true }).waitFor()
      const filterInput = page.getByRole('textbox', { name: 'Find a workstream', exact: true })
      await filterInput.click()
      await page.getByRole('menu').waitFor({ state: 'hidden' })
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      )
      assert({
        given: 'an outside click on the workstream filter',
        should: 'dismiss the menu and leave keyboard focus in the clicked input',
        actual: await filterInput.evaluate((input) => input === document.activeElement),
        expected: true,
      })
      const outsideDismissed: boolean[] = []
      for (const activation of ['click-only', 'interrupted-pointer'] as const) {
        await card.click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Delete workstream', exact: true }).waitFor()
        await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem')
        if (activation === 'click-only') await filterInput.evaluate((input) => (input as HTMLInputElement).click())
        else {
          await page.locator('.sky-workstreams-canvas').evaluate((canvas) => {
            canvas.addEventListener('pointerdown', (event) => event.stopPropagation(), { once: true })
          })
          await page.mouse.click(blankPoint.x, blankPoint.y)
        }
        await page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
        )
        const dismissed = (await page.getByRole('menu').count()) === 0
        outsideDismissed.push(dismissed)
        if (!dismissed) {
          await page.getByRole('menuitem', { name: 'Open workstream', exact: true }).focus()
          await page.keyboard.press('Escape')
          await page.getByRole('menu').waitFor({ state: 'hidden' })
        }
      }
      assert({
        given: 'outside click activation without a pointer event and outside pointer input whose bubbling is stopped',
        should: 'dismiss either menu without changing selected work or the camera',
        actual: [outsideDismissed, page.url(), await camera(page), (await store.get(target.id))!.revision],
        expected: [[true, true], before.url, before.camera, before.revision],
      })
      const detailHeader = page.locator('.sky-workstream-detail-header')
      for (const [surface, button] of [
        [card.getByRole('button', { name: `Workstream menu for ${target.title}`, exact: true }), 'left'],
        [detailHeader, 'right'],
        [detailHeader.getByRole('button', { name: `Workstream menu for ${anchor.title}`, exact: true }), 'left'],
      ] as const) {
        await surface.click({ button })
        await page.getByRole('menu').waitFor()
        await page.mouse.click(blankPoint.x, blankPoint.y)
        await page.getByRole('menu').waitFor({ state: 'hidden' })
        assert({
          given: 'a Map ellipsis or detail-header menu dismissed on blank canvas',
          should: 'retain the selected detail, camera, and work revision',
          actual: [page.url(), await camera(page), (await store.get(target.id))!.revision],
          expected: [before.url, before.camera, before.revision],
        })
      }
      await card.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Delete workstream', exact: true }).waitFor()
      await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem')
      await page.keyboard.press('Escape')
      await page.getByRole('menu').waitFor({ state: 'hidden' })
      await page.waitForFunction(
        (id) =>
          document.activeElement?.matches(`.sky-workstreams-card[data-workstream="${id}"] .sky-workstreams-card-open`),
        target.id,
      )
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'Delete workstream', exact: true }).waitFor()
      await page.keyboard.press('Escape')
      await page.waitForFunction(
        (id) =>
          document.activeElement?.matches(`.sky-workstreams-card[data-workstream="${id}"] .sky-workstreams-card-open`),
        target.id,
      )
      await card.dispatchEvent('contextmenu', { clientX: 1898, clientY: 1098, button: 2 })
      await page.getByRole('menu').waitFor()
      await page.waitForFunction(() => {
        const box = document.querySelector('[role="menu"]')?.getBoundingClientRect()
        return (
          box &&
          box.width > 200 &&
          box.left >= 0 &&
          box.top >= 0 &&
          box.right <= window.innerWidth &&
          box.bottom <= window.innerHeight
        )
      })
      const edgeMenu = (await page.getByRole('menu').boundingBox())!
      assert({
        given: 'a context menu requested at the lower-right viewport edge',
        should: 'keep its complete actions on screen',
        actual:
          edgeMenu.x >= 0 &&
          edgeMenu.y >= 0 &&
          edgeMenu.x + edgeMenu.width <= 1900 &&
          edgeMenu.y + edgeMenu.height <= 1100,
        expected: true,
      })
      await page.keyboard.press('Escape')
      await card.click({ button: 'right' })
      const deletion = page.waitForResponse(
        (response) => response.url().endsWith(`/${target.id}/delete`) && response.request().method() === 'POST',
      )
      await page.getByRole('menuitem', { name: 'Delete workstream', exact: true }).click()
      assert({
        given: 'Delete chosen from the nonselected workstream menu',
        should: 'use the exact target delete route',
        actual: (await deletion).status(),
        expected: 200,
      })
      await card.waitFor({ state: 'hidden' })
      assert({
        given: 'one workstream deleted from Map',
        should: 'remove only that work while retaining its neighbor, child, and current selection',
        actual: [
          (await store.get(target.id)) === null,
          (await store.get(anchor.id))?.relations,
          (await store.get(child.id))?.parentId,
          page.url(),
        ],
        expected: [true, anchor.relations, target.id, before.url],
      })
      await page.reload()
      await page.getByRole('button', { name: `Undo delete ${target.title}`, exact: true }).waitFor()
      assert({
        given: 'a page reload after deletion',
        should: 'keep the target deleted and retain the Undo affordance',
        actual: [(await store.get(target.id)) === null, await card.count()],
        expected: [true, 0],
      })
      await page.getByRole('button', { name: `Undo delete ${target.title}`, exact: true }).click()
      await card.waitFor()
      const restored = (await store.get(target.id))!
      assert({
        given: 'Undo after reload',
        should: 'restore the same work and relationships while requiring a new decision to resume ongoing Sky help',
        actual: [
          restored.id,
          restored.title,
          restored.activities.map((activity) => activity.id),
          (await store.getGrant(target.id)).mode,
          (await store.get(anchor.id))?.relations,
          (await store.get(child.id))?.parentId,
          setupCalls,
        ],
        expected: [target.id, target.title, ['brief'], 'off', anchor.relations, target.id, 0],
      })

      await card.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Delete workstream', exact: true }).waitFor()
      const updated = await store.put(
        { ...restored, notes: 'A new human note must survive stale deletion.' },
        restored.revision,
      )
      const staleResponse = page.waitForResponse(
        (response) => response.url().endsWith(`/${target.id}/delete`) && response.request().method() === 'POST',
      )
      await page.getByRole('menuitem', { name: 'Delete workstream', exact: true }).click()
      const stale = await staleResponse
      assert({
        given: 'a menu opened before a new human edit, then its Delete action chosen',
        should: 'refuse the stale delete and preserve that edit',
        actual: [stale.status(), (await store.get(target.id))?.revision, (await store.get(target.id))?.notes],
        expected: [409, updated.revision, updated.notes],
      })
      await page.getByRole('button', { name: 'Dismiss error', exact: true }).click()

      await page.getByRole('button', { name: 'Close workstream', exact: true }).click()
      await page.getByText('Timeline', { exact: true }).click()
      const lane = page.locator(`.sky-workstreams-lane-label[data-workstream="${target.id}"]`)
      await lane.waitFor()
      const timelineStage = (await page.locator('.sky-workstreams-canvas').boundingBox())!
      const timelineBlank = { x: timelineStage.x + timelineStage.width - 24, y: timelineStage.y + 24 }
      assert({
        given: 'the Timeline outside-click target',
        should: 'hit the canvas outside a workstream or control',
        actual: await page.evaluate(({ x, y }) => {
          const hit = document.elementFromPoint(x, y)
          return Boolean(hit?.closest('.sky-workstreams-canvas') && !hit.closest('[data-workstream], button'))
        }, timelineBlank),
        expected: true,
      })
      for (const surface of [
        lane,
        page.locator(`.sky-workstreams-clip[data-workstream="${target.id}"][data-activity="brief"]`),
      ]) {
        const timelineCamera = await camera(page)
        await surface.click({ button: 'right' })
        await page.getByRole('menu', { name: `Workstream menu for ${target.title}`, exact: true }).waitFor()
        assert({
          given: 'a workstream lane or activity clip context menu',
          should: 'leave timeline placement and navigation unchanged',
          actual: [await camera(page), page.url()],
          expected: [timelineCamera, `${origin}/workstreams`],
        })
        await page.keyboard.press('Escape')
        if (await surface.getAttribute('data-activity'))
          await page.waitForFunction(() =>
            document.activeElement?.matches('.sky-workstreams-clip[data-activity="brief"]'),
          )
        await surface.click({ button: 'right' })
        await page.getByRole('menu').waitFor()
        await page.mouse.click(timelineBlank.x, timelineBlank.y)
        await page.getByRole('menu').waitFor({ state: 'hidden' })
        assert({
          given: 'a lane or activity menu dismissed by clicking outside on Timeline',
          should: 'retain navigation, camera, and the work revision',
          actual: [page.url(), await camera(page), (await store.get(target.id))!.revision],
          expected: [`${origin}/workstreams`, timelineCamera, updated.revision],
        })
      }
      await lane.getByRole('button', { name: `Workstream menu for ${target.title}`, exact: true }).click()
      await page.getByRole('menu').waitFor()
      const ellipsisCamera = await camera(page)
      await page.mouse.click(timelineBlank.x, timelineBlank.y)
      await page.getByRole('menu').waitFor({ state: 'hidden' })
      assert({
        given: 'a Timeline ellipsis menu dismissed by clicking outside',
        should: 'retain navigation, camera, and the work revision',
        actual: [page.url(), await camera(page), (await store.get(target.id))!.revision],
        expected: [`${origin}/workstreams`, ellipsisCamera, updated.revision],
      })

      const stageBox = (await page.locator('.sky-workstreams-canvas').boundingBox())!
      const targetLane = (await page.locator(`.sky-workstreams-lane[data-workstream="${target.id}"]`).boundingBox())!
      const emptyCamera = await camera(page)
      await page.mouse.click(stageBox.x + stageBox.width - 24, targetLane.y + 30, { button: 'right' })
      await page.getByRole('menu', { name: `Workstream menu for ${target.title}`, exact: true }).waitFor()
      assert({
        given: 'a right-click in the empty horizontal space of a timeline lane',
        should: 'find the lane owner without moving the camera',
        actual: await camera(page),
        expected: emptyCamera,
      })
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: 'Browse work', exact: true }).click()
      const browse = page.getByRole('dialog', { name: 'Browse workstreams', exact: true })
      await browse.getByRole('button', { name: `Workstream menu for ${target.title}`, exact: true }).click()
      await browse.waitFor({ state: 'hidden' })
      await page.getByRole('menuitem', { name: 'Delete workstream', exact: true }).waitFor()
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => document.activeElement?.matches('.sky-workstreams-canvas'))
      assert({
        given: 'a workstream menu opened from Browse and then dismissed',
        should: 'close the Browse dialog and return keyboard focus to the canvas',
        actual: await page.getByRole('dialog').count(),
        expected: 0,
      })

      const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
      desktop = mobile
      mobile.setDefaultTimeout(10000)
      mobile.on('pageerror', (error) => errors.push(error.message))
      await mobile.goto(`${origin}/workstreams`)
      const more = mobile.getByRole('button', { name: `Workstream menu for ${anchor.title}`, exact: true })
      await more.waitFor()
      const touchTarget = (await more.boundingBox())!
      assert({
        given: 'the visible workstream actions button on a phone',
        should: 'provide a real forty-four-pixel touch target',
        actual: touchTarget.width >= 44 && touchTarget.height >= 44,
        expected: true,
      })
      await more.tap()
      const sheet = mobile.getByRole('dialog')
      await sheet.waitFor()
      const mobileBefore = {
        url: mobile.url(),
        camera: await camera(mobile),
        revision: (await store.get(anchor.id))!.revision,
      }
      await mobile.locator('.mantine-Drawer-overlay').tap({ position: { x: 20, y: 20 } })
      await sheet.waitFor({ state: 'hidden' })
      assert({
        given: 'a tap on the dimmed area outside the mobile actions sheet',
        should: 'dismiss the sheet without changing the work or camera',
        actual: [mobile.url(), await camera(mobile), (await store.get(anchor.id))!.revision],
        expected: [mobileBefore.url, mobileBefore.camera, mobileBefore.revision],
      })
      await more.tap()
      await sheet.waitFor()
      await sheet.locator('.mantine-Drawer-close').tap()
      await sheet.waitFor({ state: 'hidden' })
      await mobile.waitForFunction(
        (label) => document.activeElement?.getAttribute('aria-label') === label,
        `Workstream menu for ${anchor.title}`,
      )
      assert({
        given: 'the reopened phone sheet dismissed with its close button',
        should: 'return focus to its ellipsis with no work changes',
        actual: [(await store.get(anchor.id))!.revision, mobile.url()],
        expected: [mobileBefore.revision, mobileBefore.url],
      })
      await more.tap()
      await sheet.waitFor()
      await mobile.screenshot({ path: path.join(tmpdir(), 'sky-workstreams-menu-mobile-sheet.png') })
      await sheet.getByRole('button', { name: 'Delete workstream', exact: true }).tap()
      await mobile.getByRole('button', { name: `Undo delete ${anchor.title}`, exact: true }).waitFor()
      assert({
        given: 'Delete in the phone actions sheet',
        should: 'delete the tapped workstream and retain the others',
        actual: [
          (await store.get(anchor.id)) === null,
          (await store.get(target.id))?.id,
          (await store.get(child.id))?.id,
        ],
        expected: [true, target.id, child.id],
      })
      await mobile.getByRole('button', { name: `Undo delete ${anchor.title}`, exact: true }).tap()
      await mobile.locator('.sky-workstream-detail').waitFor()
      await mobile.screenshot({ path: path.join(tmpdir(), 'sky-workstreams-menu-mobile.png') })
      assert({
        given: 'desktop and phone deletion, keyboard menus, and Undo',
        should: 'restore all work without browser errors or automatic execution',
        actual: [(await store.list()).map((work) => work.id).sort(), errors, setupCalls],
        expected: [['atlas', 'widget', 'z-research'], [], 0],
      })
    } catch (error) {
      if (desktop) {
        await desktop.screenshot({ path: path.join(tmpdir(), 'sky-workstreams-menu-failure.png') }).catch(() => {})
        const diagnostic = await desktop
          .evaluate(() => ({
            menus: [...document.querySelectorAll('[role="menu"], [role="dialog"]')].map((node) => node.outerHTML),
            anchors: [...document.querySelectorAll('.sky-workstream-menu-anchor')].map((node) => ({
              html: node.outerHTML,
              rect: node.getBoundingClientRect().toJSON(),
              position: getComputedStyle(node).position,
              display: getComputedStyle(node).display,
            })),
            viewport: { width: window.innerWidth, height: window.innerHeight },
            errors: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent),
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
