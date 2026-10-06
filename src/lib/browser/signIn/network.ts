import type { Page } from 'playwright'
import { sameLoginWebsite } from '#lib/credentials/login.ts'
import type { PageProtocol } from '../existing/connection.ts'
import type { DownloadResponse } from '../existing/downloads.ts'

interface RequestPolicy {
  origin(): string | undefined
  /** Once file bytes enter a page, every request and redirect stays on the upload origin. */
  uploadOrigin?(): string | undefined
  containsLogin(text: string): boolean
  containsCredential?(text: string): boolean
  /** A scripted login may POST directly to a same-website API covered by its freshly read item. */
  allowCredentialApi?(origin: string): boolean
  /** Ordinary tasks may follow HTTPS GET redirects; credential delivery remains origin-bound. */
  allowSafeNavigation?: boolean
  blockedNavigation?(origin: string): void
  authorizeNavigation?(origin: string): Promise<boolean>
  nativeActive?(): boolean
  rememberResponseParameters?(url: string, body: string): void
  unguardedPopup?(url: string): void
  /** Extension sessions already own a tab debugger; they cannot open another browser-level session. */
  protocol?(page: Page): Promise<PageProtocol>
  captureResponse?(protocol: PageProtocol, event: DownloadResponse): Promise<boolean>
}

/** Request policy stays inside the task worker; interception is never a model tool. */
export async function guardBrowserRequests(page: Page, policy: RequestPolicy): Promise<(page: Page) => Promise<void>> {
  const guarded = new WeakSet<Page>()
  const permitted = async (
    address: string,
    navigation: boolean,
    body: string,
    source: Page,
    method: string,
    request: { type: string; headers: Record<string, string>; redirected: boolean },
  ) => {
    const url = new URL(address)
    const origin = policy.origin()
    const uploadOrigin = policy.uploadOrigin?.()
    if (uploadOrigin && url.origin !== uploadOrigin) return false
    if (!['https:', 'http:'].includes(url.protocol)) return false
    if (url.username || url.password) return false
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
    if (origin && url.origin !== origin) {
      if (policy.containsLogin(body)) {
        const sourceOrigin = Object.entries(request.headers).find(([name]) => name.toLowerCase() === 'origin')?.[1]
        if (
          navigation ||
          method !== 'POST' ||
          request.redirected ||
          !['xhr', 'fetch'].includes(request.type.toLowerCase()) ||
          sourceOrigin !== origin ||
          !sameLoginWebsite(origin, url.origin) ||
          !policy.allowCredentialApi?.(url.origin)
        )
          return false
      }
      if (
        navigation &&
        (!policy.allowSafeNavigation || url.protocol !== 'https:' || !['GET', 'HEAD'].includes(method) || body)
      )
        return false
    }
    if (origin && navigation) policy.rememberResponseParameters?.(url.href, body)
    return true
  }
  if (!policy.protocol)
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
        if (
          await permitted(
            request.url(),
            request.isNavigationRequest(),
            request.postData() ?? '',
            source,
            request.method(),
            {
              type: request.resourceType(),
              headers: request.headers(),
              redirected: request.redirectedFrom() !== null,
            },
          )
        )
          await route.fallback().catch(() => {})
        else {
          if (request.isNavigationRequest() && request.frame() === source.mainFrame())
            policy.blockedNavigation?.(new URL(request.url()).origin)
          await route.abort().catch(() => {})
        }
      } catch {
        await route.abort().catch(() => {})
      }
    })
  // Playwright routing deliberately skips requests after an HTTP redirect. Chromium's
  // Fetch interceptor sees every hop, including a 307 that replays a credential POST.
  const attach = async (source: Page) => {
    if (guarded.has(source)) return
    const cdp = policy.protocol ? await policy.protocol(source) : await source.context().newCDPSession(source)
    const frameId = policy.blockedNavigation ? (await cdp.send('Page.getFrameTree')).frameTree.frame.id : undefined
    const requests = new Set<string>()
    cdp.on('Network.loadingFinished', (event) => requests.delete(event.requestId))
    cdp.on('Network.loadingFailed', (event) => requests.delete(event.requestId))
    cdp.on('Fetch.requestPaused', async (event) => {
      if (event.responseStatusCode !== undefined || event.responseErrorReason !== undefined) {
        try {
          if (!(await policy.captureResponse?.(cdp, event)))
            await cdp.send('Fetch.continueResponse', { requestId: event.requestId })
        } catch {
          await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Aborted' }).catch(() => {})
        }
        return
      }
      // Some Chromium/Playwright combinations omit redirectedRequestId. The
      // Network request ID remains the same across a redirect chain.
      const redirected = !!event.redirectedRequestId || (!!event.networkId && requests.has(event.networkId))
      if (event.networkId) requests.add(event.networkId)
      let allow = false
      try {
        allow = await permitted(
          event.request.url,
          event.resourceType === 'Document',
          event.request.postData ?? '',
          source,
          event.request.method,
          {
            type: event.resourceType,
            headers: event.request.headers,
            redirected,
          },
        )
      } catch {
        /* A malformed destination is denied. */
      }
      if (!allow && event.resourceType === 'Document' && event.frameId === frameId)
        policy.blockedNavigation?.(new URL(event.request.url).origin)
      const action = allow
        ? cdp.send('Fetch.continueRequest', {
            requestId: event.requestId,
            ...(policy.captureResponse ? { interceptResponse: true } : {}),
          })
        : cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' })
      // Navigation can cancel a paused request before Chromium receives this reply.
      // Failed continuation leaves the request paused or already cancelled.
      void action.catch(() => {})
    })
    if (policy.protocol) await cdp.send('Network.setBypassServiceWorker', { bypass: true })
    await cdp.send('Network.enable')
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
    guarded.add(source)
  }
  await attach(page)
  return attach
}
