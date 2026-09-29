import type { Page } from 'playwright'

interface RequestPolicy {
  origin(): string | undefined
  containsLogin(text: string): boolean
}

/** The native interception stays inside the worker's pipe; it creates no CDP listener or public tool. */
export async function guardBrowserRequests(page: Page, policy: RequestPolicy): Promise<void> {
  const permitted = (address: string, navigation: boolean, body: string) => {
    const url = new URL(address)
    const origin = policy.origin()
    return (
      ['https:', 'http:'].includes(url.protocol) &&
      !policy.containsLogin(url.href) &&
      !(origin && url.origin !== origin && (navigation || policy.containsLogin(body)))
    )
  }
  await page.context().route('**/*', async (route) => {
    const request = route.request()
    if (permitted(request.url(), request.isNavigationRequest(), request.postData() ?? ''))
      await route.fallback().catch(() => {})
    else await route.abort().catch(() => {})
  })
  // Playwright routing deliberately skips requests after an HTTP redirect. Chromium's
  // Fetch interceptor sees every hop, including a 307 that replays a credential POST.
  const cdp = await page.context().newCDPSession(page)
  cdp.on('Fetch.requestPaused', (event) => {
    let allow = false
    try {
      allow = permitted(event.request.url, event.resourceType === 'Document', event.request.postData ?? '')
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
}
