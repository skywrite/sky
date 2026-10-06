import * as path from 'node:path'
import type { Page } from 'playwright'
import type { PageProtocol } from './connection.ts'

const MAX_BYTES = 100 * 1024 * 1024
type SaveDownload = (name: string, bytes: Buffer) => Promise<void>
export interface DownloadResponse {
  requestId: string
  request: { url: string }
  responseStatusCode?: number
  responseHeaders?: { name: string; value: string }[]
  resourceType: string
}

/** Capture the task tab's response, leaving Brave's global download preferences alone. */
export async function captureDownloadResponse(
  protocol: PageProtocol,
  event: DownloadResponse,
  save: SaveDownload,
): Promise<boolean> {
  if (!event.responseStatusCode || event.responseStatusCode < 200 || event.responseStatusCode >= 300) return false
  const header = (name: string) => event.responseHeaders?.find((h) => h.name.toLowerCase() === name)?.value ?? ''
  const disposition = header('content-disposition')
  const type = header('content-type').split(';')[0].trim().toLowerCase()
  if (!/\battachment\b/i.test(disposition) && !(event.resourceType === 'Document' && type === 'application/pdf'))
    return false
  let stream: string | undefined
  try {
    if (Number(header('content-length')) > MAX_BYTES) throw new Error('Download too large')
    const opened = await protocol.send('Fetch.takeResponseBodyAsStream', { requestId: event.requestId })
    stream = opened.stream
    const chunks: Buffer[] = []
    let size = 0
    for (;;) {
      const part = await protocol.send('IO.read', { handle: stream, size: 65536 })
      const bytes = Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8')
      size += bytes.length
      if (size > MAX_BYTES) throw new Error('Download too large')
      chunks.push(bytes)
      if (part.eof) break
    }
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
    let name = disposition
      .match(/filename="([^"]+)"|filename=([^;]+)/i)
      ?.slice(1)
      .find(Boolean)
      ?.trim()
    if (encoded) {
      try {
        name = decodeURIComponent(encoded)
      } catch {
        /* Use the ordinary filename below. */
      }
    }
    name ||=
      path.basename(new URL(event.request.url).pathname) || (type === 'application/pdf' ? 'document.pdf' : 'download')
    if (type === 'application/pdf' && !path.extname(name)) name += '.pdf'
    await save(name, Buffer.concat(chunks))
  } finally {
    if (stream) await protocol.send('IO.close', { handle: stream }).catch(() => {})
    await protocol.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Aborted' }).catch(() => {})
  }
  return true
}

/** Generated PDFs often use a blob/data download link instead of an HTTP attachment. */
export async function captureInlineDownloads(
  page: Page,
  save: SaveDownload,
  failed: () => void,
  track: (work: Promise<void>) => Promise<void>,
): Promise<void> {
  const binding = `skyDownload${crypto.randomUUID().replaceAll('-', '')}`
  await page.exposeBinding(binding, ({ frame }, address: unknown, name: unknown) =>
    track(
      (async () => {
        if (address === null) {
          failed()
          return
        }
        if (typeof address !== 'string' || typeof name !== 'string' || name.length > 1000) return
        if (!address.startsWith('blob:') && !address.startsWith('data:')) return
        try {
          const encoded = await frame.evaluate(
            async ({ address, max }) => {
              const response = await fetch(address)
              const body = await response.blob()
              if (body.size > max) throw new Error('Download too large')
              const bytes = new Uint8Array(await body.arrayBuffer())
              let binary = ''
              for (let offset = 0; offset < bytes.length; offset += 32768)
                binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
              return btoa(binary)
            },
            { address, max: MAX_BYTES },
          )
          await save(name || 'download', Buffer.from(encoded, 'base64'))
        } catch {
          failed()
        }
      })(),
    ),
  )
  await page.addInitScript(
    ({ binding }) => {
      const capture = (anchor: HTMLAnchorElement): boolean => {
        if (!anchor.hasAttribute('download') || !/^(blob:|data:)/.test(anchor.href)) return false
        // Pin a blob URL until the worker has read it; a site's click handler can
        // revoke its original URL immediately after dispatching this event.
        const send = (window as unknown as Record<string, (url: string | null, name: string) => Promise<void>>)[binding]
        void fetch(anchor.href)
          .then((response) => response.blob())
          .then(async (blob) => {
            const pinned = URL.createObjectURL(blob)
            try {
              await send(pinned, anchor.download)
            } finally {
              URL.revokeObjectURL(pinned)
            }
          })
          .catch(() => send(null, anchor.download))
        return true
      }
      const click = HTMLAnchorElement.prototype.click
      HTMLAnchorElement.prototype.click = function () {
        if (!capture(this)) click.call(this)
      }
      document.addEventListener(
        'click',
        (event) => {
          const anchor = event
            .composedPath()
            .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement)
          if (anchor && capture(anchor)) event.preventDefault()
        },
        true,
      )
    },
    { binding },
  )
}
