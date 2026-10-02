import type { Page } from 'playwright'

interface RequestPolicy {
  origin(): string | undefined
  containsLogin(text: string): boolean
  containsCredential?(text: string): boolean
  authorizeNavigation?(origin: string): Promise<boolean>
  nativeActive?(): boolean
  rememberResponseParameters?(url: string, body: string): void
  unguardedPopup?(url: string): void
}

/** The native interception stays inside the worker's pipe; it creates no CDP listener or public tool. */
export async function guardBrowserRequests(page: Page, policy: RequestPolicy): Promise<(page: Page) => Promise<void>> {
  const guarded = new WeakSet<Page>()
  const permitted = async (address: string, navigation: boolean, body: string, source: Page) => {
    const url = new URL(address)
    const origin = policy.origin()
    if (!['https:', 'http:'].includes(url.protocol)) return false
    if (policy.nativeActive?.()) {
      if (url.protocol !== 'https:') return false
      const secret = policy.containsCredential ?? policy.containsLogin
      if (secret(url.href)) return false
      // Even approved providers may not receive another origin's password/code in a replayed POST.
      if (secret(body) && url.origin !== new URL(source.url()).origin) return false
      if (navigation && !(await policy.authorizeNavigation?.(url.origin))) return false
      policy.rememberResponseParameters?.(url.href, body)
      return true
    }
    if (policy.containsLogin(url.href)) return false
    return !(origin && url.origin !== origin && (navigation || policy.containsLogin(body)))
  }
  await page.context().route('**/*', async (route) => {
    const request = route.request()
    let source: Page | undefined
    try {
      source = request.frame().page()
    } catch {
      /* A popup's first request has no Page yet. */
    }
    if (!source || !guarded.has(source)) {
      // Abort before the first hop. The session may reopen one GET only after attaching its CDP guard.
      if (policy.nativeActive?.() && request.isNavigationRequest() && request.method() === 'GET')
        policy.unguardedPopup?.(request.url())
      await route.abort().catch(() => {})
      return
    }
    try {
      if (await permitted(request.url(), request.isNavigationRequest(), request.postData() ?? '', source))
        await route.fallback().catch(() => {})
      else await route.abort().catch(() => {})
    } catch {
      await route.abort().catch(() => {})
    }
  })
  // Playwright routing deliberately skips requests after an HTTP redirect. Chromium's
  // Fetch interceptor sees every hop, including a 307 that replays a credential POST.
  const attach = async (source: Page) => {
    if (guarded.has(source)) return
    const cdp = await source.context().newCDPSession(source)
    cdp.on('Fetch.requestPaused', async (event) => {
      let allow = false
      try {
        allow = await permitted(
          event.request.url,
          event.resourceType === 'Document',
          event.request.postData ?? '',
          source,
        )
      } catch {
        /* A malformed destination is denied. */
      }
      const action = allow
        ? cdp.send('Fetch.continueRequest', { requestId: event.requestId })
        : cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' })
      // Navigation can cancel a paused request before Chromium receives this reply.
      // Failed continuation leaves the request paused or already cancelled.
      void action.catch(() => {})
    })
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
    guarded.add(source)
  }
  await attach(page)
  return attach
}
