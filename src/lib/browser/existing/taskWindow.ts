import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { BrowserContext, Page } from 'playwright'

const CONNECT_PAGE = 'chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html'

interface ExtensionTab {
  id: number
  windowId: number
  groupId: number
}

// These APIs run only in the connection page Sky just opened. They are never
// available to the model or evaluated on a website or pre-existing tab.
interface ExtensionControls {
  debugger: { getTargets(): Promise<{ id: string; tabId?: number }[]> }
  tabs: {
    getCurrent(): Promise<ExtensionTab | undefined>
    get(id: number): Promise<ExtensionTab>
    create(options: { windowId: number; url: string; active: boolean }): Promise<ExtensionTab>
    group(options: { groupId: number; tabIds: number[] }): Promise<number>
    ungroup(ids: number[]): Promise<void>
    update(id: number, options: { active: boolean }): Promise<ExtensionTab>
    remove(id: number | number[]): Promise<void>
  }
}

export function connectionPage(context: BrowserContext): Page {
  const pages = context.pages()
  // The token flow attaches only its new connect page. A manually selected
  // existing tab must never be moved, navigated, or closed by this path.
  if (pages.length !== 1) throw new Error('The background task needs its own extension connection page')
  const page = pages[0]!
  const url = new URL(page.url())
  if (
    url.protocol !== 'chrome-extension:' ||
    url.hostname !== new URL(CONNECT_PAGE).hostname ||
    url.pathname !== '/connect.html'
  )
    throw new Error('Unexpected extension page')
  return page
}

/** The pinned MCP factory exposes no launch arguments for its extension connect page. */
export async function taskWindowLauncher(executablePath: string) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sky-browser-launcher-'))
  const launcher = path.join(dir, 'open-browser')
  try {
    const quoted = `'${executablePath.replaceAll("'", "'\\''")}'`
    await writeFile(launcher, `#!/bin/sh\nexec ${quoted} --new-window "$@"\n`, { mode: 0o700 })
    return { executablePath: launcher, close: () => rm(dir, { recursive: true, force: true }) }
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
}

/** Delete only owned tabs, dissolving their group before Chrome can save it on close. */
export function closeTaskTabs(control: Page, tabIds: number[] = []): Promise<void> {
  return control
    .evaluate(async (tabIds) => {
      const chrome = (globalThis as unknown as { chrome: ExtensionControls }).chrome
      const self = await chrome.tabs.getCurrent()
      const remaining = await Promise.all(
        [...tabIds, ...(self ? [self.id] : [])].map((id) => chrome.tabs.get(id).catch(() => undefined)),
      )
      const ids = remaining.flatMap((tab) => (tab ? [tab.id] : []))
      if (!ids.length) return
      // The script continues after ungrouping detaches its debugger.
      await chrome.tabs.ungroup(ids)
      await chrome.tabs.remove(ids)
    }, tabIds)
    .catch(() => {})
}

export async function backgroundTaskPage(context: BrowserContext, control: Page) {
  await control.waitForFunction(
    async () => {
      const chrome = (globalThis as unknown as { chrome: ExtensionControls }).chrome
      return (await chrome.tabs.getCurrent())!.groupId >= 0
    },
    undefined,
    { timeout: 10000 },
  )
  const owned = await control.evaluate(async () => {
    const chrome = (globalThis as unknown as { chrome: ExtensionControls }).chrome
    const self = (await chrome.tabs.getCurrent())!
    // Creating through the relay defaults to the person's last-focused window.
    // Keep the new tab in our window, and add it to this connection's group so
    // the official extension attaches it without switching window focus.
    const tab = await chrome.tabs.create({ windowId: self.windowId, url: 'about:blank', active: true })
    try {
      await chrome.tabs.group({ groupId: self.groupId, tabIds: [tab.id] })
      const target = (await chrome.debugger.getTargets()).find((target) => target.tabId === tab.id)
      if (!target) throw new Error('Missing task target')
      return { id: tab.id, windowId: self.windowId, targetId: target.id }
    } catch (error) {
      await chrome.tabs.remove(tab.id).catch(() => {})
      throw error
    }
  })
  let page: Page
  try {
    // A person can drag another tab into the group while ours is attaching.
    // Match Chromium's target, never take the first page event from the relay.
    const matches = (candidate: Page) => {
      const internal = candidate as unknown as {
        _connection: { toImpl(page: Page): { delegate: { _targetId: string } } }
      }
      return internal._connection.toImpl(candidate).delegate._targetId === owned.targetId
    }
    page = context.pages().find(matches) ?? (await context.waitForEvent('page', { predicate: matches, timeout: 10000 }))
  } catch (error) {
    await control
      .evaluate(async (id) => {
        const chrome = (globalThis as unknown as { chrome: ExtensionControls }).chrome
        await chrome.tabs.remove(id)
      }, owned.id)
      .catch(() => {})
    throw error
  }
  return {
    page,
    close: () => closeTaskTabs(control, [owned.id]),
    activateTaskTab: () =>
      control.evaluate(async ({ id, windowId }) => {
        const chrome = (globalThis as unknown as { chrome: ExtensionControls }).chrome
        if ((await chrome.tabs.get(id)).windowId !== windowId) throw new Error('The task tab was moved')
        // Tab activation keeps Chromium input responsive without focusing its window.
        await chrome.tabs.update(id, { active: true })
      }, owned),
  }
}
