import type { DownloadedPage } from './pageReader.ts'
import { readWebBody } from './readBody.ts'
import { fetchPublicPage, safeWebUrl } from './safeWebFetch.ts'

export type PageFetch = (url: string, init?: RequestInit) => Promise<Response>

export async function downloadWebPage(
  requested: string,
  signal: AbortSignal,
  fetcher: PageFetch = fetchPublicPage,
): Promise<DownloadedPage> {
  let url = safeWebUrl(requested).href
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetcher(url, { method: 'GET', redirect: 'manual', signal })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      const location = response.headers.get('location')
      if (!location || redirects === 3)
        throw new Error('The page returned too many redirects or no redirect destination.')
      url = safeWebUrl(new URL(location, url).href).href
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`The page returned HTTP ${response.status} ${response.statusText}. Its content was not read.`)
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? 'text/plain'
    const encoding = response.headers.get('content-encoding')?.toLowerCase()
    if (!/^(text\/|application\/(json|xhtml\+xml|xml))/.test(contentType) || (encoding && encoding !== 'identity')) {
      await response.body?.cancel()
      throw new Error('The page did not return supported uncompressed text or HTML. Its content was not read.')
    }
    const body = await readWebBody(response, undefined, signal)
    return { url, contentType, ...body }
  }
  throw new Error('The page could not be retrieved.')
}
