import http from 'node:http'
import type { AddressInfo } from 'node:net'

const CALLBACK_PATH = '/oauth/callback'

const RESPONSE_HTML = `<!doctype html><title>Sky</title>
<body style="font-family: system-ui; display: flex; justify-content: center; margin-top: 20vh;">
  <p>Authorized — you can close this tab and return to Sky.</p>`

export interface LoopbackServer {
  redirectUri: string
  /** Resolves with the authorization code once Google redirects back. */
  waitForCode(options?: { timeoutMs?: number }): Promise<string>
  close(): void
}

/**
 * One-shot loopback receiver for the OAuth redirect (installed-app flow).
 * Binds 127.0.0.1 on an ephemeral port — Google permits any loopback port
 * for desktop clients, so nothing has to be pre-registered.
 */
export function startLoopback(expectedState: string): Promise<LoopbackServer> {
  let settle: { resolve: (code: string) => void; reject: (err: Error) => void } | undefined
  const codePromise = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject }
  })
  // A settled promise ignores later calls, so stray repeat callbacks are harmless.

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(RESPONSE_HTML)

    const error = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (error) settle?.reject(new Error(`Authorization failed: ${error}`))
    else if (state !== expectedState) settle?.reject(new Error('Authorization failed: state mismatch'))
    else if (!code) settle?.reject(new Error('Authorization failed: no code in callback'))
    else settle?.resolve(code)
  })

  return new Promise((resolveServer, rejectServer) => {
    server.once('error', rejectServer)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolveServer({
        redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
        waitForCode({ timeoutMs = 5 * 60 * 1000 } = {}) {
          const timeout = setTimeout(() => {
            settle?.reject(
              new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the browser callback`),
            )
          }, timeoutMs)
          return codePromise.finally(() => clearTimeout(timeout))
        },
        close() {
          server.close()
        },
      })
    })
  })
}
