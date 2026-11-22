import type { BrowserContext, Page } from 'playwright'
import { signInGoogleBrowserSession } from '#lib/google/browserSignIn.ts'
import { assert, test } from '#test'

function mockSignInPage(initialUrl: string) {
  let currentUrl = initialUrl
  let closed = false
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const page = {
    url: () => currentUrl,
    isClosed: () => closed,
    goto: async (next: string) => {
      currentUrl = next
      return null
    },
    on: (event: string, fn: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(fn)
    },
    off: (event: string, fn: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(fn)
    },
    setUrl: (next: string) => {
      currentUrl = next
    },
    closeTab: () => {
      closed = true
      for (const fn of listeners.get('close') ?? []) fn()
    },
  }
  return page as unknown as Page & { setUrl: (url: string) => void; closeTab: () => void }
}

test('signInGoogleBrowserSession on connected Brave ignores pre-existing personal tabs and disconnects only owned tabs on cancel', async () => {
  const personalDriveTab = mockSignInPage('https://drive.google.com/drive/my-drive')
  const ownedTab = mockSignInPage('about:blank')
  let contextClosed = false
  let sessionClosed = false

  const context = {
    pages: () => [personalDriveTab, ownedTab],
    on: () => {},
    off: () => {},
    close: async () => {
      contextClosed = true
    },
  } as unknown as BrowserContext

  const controller = new AbortController()
  const opened = Promise.withResolvers<void>()
  let settled = false
  const run = signInGoogleBrowserSession(
    {
      context,
      page: ownedTab,
      existing: true,
      close: async () => {
        sessionClosed = true
        ownedTab.closeTab()
      },
    },
    {
      signal: controller.signal,
      onOpened: () => opened.resolve(),
    },
  ).then(
    () => 'signed-in',
    () => 'cancelled',
  )
  void run.finally(() => {
    settled = true
  })

  await opened.promise
  await new Promise((resolve) => setTimeout(resolve, 50))

  assert({
    given: 'connected Brave already has a personal tab open on drive.google.com while the owned tab is on ServiceLogin',
    should: 'keep waiting on the owned sign-in tab instead of treating the personal tab as completion',
    expected: { settled: false, ownedOnLogin: ownedTab.url().startsWith('https://accounts.google.com/ServiceLogin') },
    actual: { settled, ownedOnLogin: ownedTab.url().startsWith('https://accounts.google.com/ServiceLogin') },
  })

  controller.abort()
  const outcome = await run

  assert({
    given: 'cancellation of sign-in on connected Brave',
    should: 'disconnect only the owned session without calling context.close() on the personal browser',
    expected: { outcome: 'cancelled', sessionClosed: true, contextClosed: false },
    actual: { outcome, sessionClosed, contextClosed },
  })
})
