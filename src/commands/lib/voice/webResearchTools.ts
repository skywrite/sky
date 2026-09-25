import { tool } from 'ai'
import { z } from 'zod'
import { WebPageError } from '../web/pageContent.ts'
import { createWebPageReader, type WebPageRequest } from '../web/pageReader.ts'
import { readWebBody } from '../web/readBody.ts'
import { fetchPublicPage, safeWebUrl } from '../web/safeWebFetch.ts'
import type { ResearchFetch, ResearchTrace } from './researchTools.ts'

export type WebFailure =
  | 'missing_key'
  | 'authentication'
  | 'provider_unavailable'
  | 'invalid_response'
  | 'unsafe_url'
  | 'page_blocked'
  | 'page_unavailable'
  | 'unsupported_content'
  | 'empty_page'
  | 'timeout'
  | 'budget'
  | WebPageError['code']

export interface WebResearchTrace {
  /** Search leads and supplied URLs are not evidence until a page is read. */
  candidates: Set<string>
  attempted: Set<string>
  urls: Set<string>
  errors: Set<WebFailure>
  downloadedBytes: number
}
interface WebToolOptions {
  apiKey?: string
  question: string
  signal: AbortSignal
  trace: ResearchTrace
  webTrace: WebResearchTrace
  fetcher?: ResearchFetch
  pageFetcher?: ResearchFetch
  maxCalls: number
  maxBytes: number
  chunkBytes: number
}

class WebError extends Error {
  constructor(
    readonly code: WebFailure,
    message: string,
  ) {
    super(message)
  }
}

const messages: Record<WebFailure, string> = {
  missing_key: 'Web search is not configured: PERPLEXITY_API_KEY is missing.',
  authentication: 'The web search provider rejected its API key or access permissions.',
  provider_unavailable: 'The web search provider is unavailable or rate limited. This is not an empty search.',
  invalid_response: 'The web search provider returned an invalid or oversized response.',
  unsafe_url: 'That page address is not an allowed public HTTP or HTTPS destination.',
  page_blocked: 'The page blocked access or requires authentication; its content was not read.',
  page_unavailable: 'The page could not be retrieved; its content was not read.',
  unsupported_content: 'This page is not readable text or HTML; its content was not read.',
  empty_page: 'The page returned no readable text. It may require JavaScript; no source evidence was established.',
  timeout: 'The web request reached its time limit. This is not an empty search.',
  budget: 'The web research budget is exhausted; report only the evidence already read.',
  section_not_found: 'The requested HTML section was not found; read the base URL or choose an available anchor.',
  invalid_offset: 'The excerpt offset is invalid; use the continuation returned by the preceding read.',
  cache_miss: 'The page snapshot is no longer cached; restart the read from the beginning.',
  snapshot_changed: 'The page snapshot changed; do not combine offsets from different snapshots.',
}

export function webFailureMessage(errors: Set<WebFailure>): string {
  return [...errors].map((code) => messages[code]).join(' ')
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function publicUrl(value: string): string {
  try {
    return safeWebUrl(value).href
  } catch {
    throw new WebError('unsafe_url', messages.unsafe_url)
  }
}

/** Voice-local retrieval: complete page downloads, bounded excerpts, and verified evidence. */
export function createVoiceWebTools(options: WebToolOptions) {
  const { trace, webTrace, signal } = options
  const fetcher = options.fetcher ?? fetch
  const pageFetcher = options.pageFetcher ?? options.fetcher ?? fetchPublicPage
  const knownUrls = webTrace.candidates
  for (const match of options.question.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    try {
      knownUrls.add(publicUrl(match[0].replace(/[),.;!?]+$/, '')))
    } catch {
      // The original question may contain local URLs; they never become readable.
    }
  }

  const body = (response: Response, maxBytes: number | undefined, requestSignal: AbortSignal) =>
    readWebBody(response, maxBytes, requestSignal, (bytes) => {
      webTrace.downloadedBytes += bytes
    })

  const readPage = createWebPageReader(async (requested, requestSignal) => {
    let url = publicUrl(requested)
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await pageFetcher(url, { method: 'GET', redirect: 'manual', signal: requestSignal })
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel()
        const location = response.headers.get('location')
        if (!location || redirects === 3) throw new WebError('page_unavailable', messages.page_unavailable)
        url = publicUrl(new URL(location, url).href)
        continue
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new WebError(
          [401, 403, 429].includes(response.status) ? 'page_blocked' : 'page_unavailable',
          'Page failed',
        )
      }
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
      const encoding = response.headers.get('content-encoding')?.toLowerCase()
      if (!/^(text\/|application\/(json|xhtml\+xml))/.test(contentType) || (encoding && encoding !== 'identity')) {
        await response.body?.cancel()
        throw new WebError('unsupported_content', messages.unsupported_content)
      }
      const raw = await body(response, undefined, requestSignal)
      knownUrls.add(url)
      return { url, contentType, ...raw }
    }
    throw new WebError('page_unavailable', messages.page_unavailable)
  })

  const run = async <T>(kind: 'search' | 'page', work: (requestSignal: AbortSignal) => Promise<T>) => {
    signal.throwIfAborted()
    const deadline = AbortSignal.timeout(kind === 'search' ? 8000 : 10_000)
    try {
      if (++trace.calls > options.maxCalls) throw new WebError('budget', messages.budget)
      return await work(AbortSignal.any([signal, deadline]))
    } catch (error) {
      signal.throwIfAborted()
      const code: WebFailure =
        error instanceof WebError || error instanceof WebPageError
          ? error.code
          : deadline.aborted
            ? 'timeout'
            : object(error) && error.code === 'unsafe_url'
              ? 'unsafe_url'
              : kind === 'search'
                ? 'provider_unavailable'
                : 'page_unavailable'
      trace.failures++
      webTrace.errors.add(code)
      return {
        ok: false as const,
        code,
        error: messages[code],
        ...(error instanceof WebPageError && error.sections ? { sections: error.sections } : {}),
      }
    }
  }

  return {
    web_search: tool({
      description:
        'Search public web information through Perplexity. Use public terms from the user question; never send private notebook-only names, details, or passages without explicit user authorization. Results are leads: read promising URLs with read_web_page before relying on them. Failures are not empty searches.',
      inputSchema: z.object({ query: z.string().trim().min(1).max(400) }),
      execute: ({ query }) =>
        run('search', async (requestSignal) => {
          if (!options.apiKey?.trim()) throw new WebError('missing_key', messages.missing_key)
          const response = await fetcher('https://api.perplexity.ai/search', {
            method: 'POST',
            headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, max_results: 5, max_tokens: 4000, max_tokens_per_page: 1000 }),
            redirect: 'error',
            signal: requestSignal,
          })
          if (!response.ok) {
            await response.body?.cancel()
            throw new WebError(
              response.status === 401 || response.status === 403 ? 'authentication' : 'provider_unavailable',
              'Search failed',
            )
          }
          const raw = await body(response, 128_000, requestSignal)
          let payload: unknown
          try {
            if (raw.truncated) throw new Error('Oversized')
            payload = JSON.parse(raw.text)
          } catch {
            throw new WebError('invalid_response', messages.invalid_response)
          }
          if (!object(payload) || !Array.isArray(payload.results))
            throw new WebError('invalid_response', messages.invalid_response)
          const results = payload.results.slice(0, 5).map((entry) => {
            if (
              !object(entry) ||
              typeof entry.url !== 'string' ||
              typeof entry.title !== 'string' ||
              typeof entry.snippet !== 'string'
            )
              throw new WebError('invalid_response', messages.invalid_response)
            const url = publicUrl(entry.url)
            knownUrls.add(url)
            return {
              url,
              title: entry.title.slice(0, 200),
              snippet: entry.snippet.slice(0, 1200),
              date: typeof entry.date === 'string' ? entry.date.slice(0, 30) : undefined,
              lastUpdated: typeof entry.last_updated === 'string' ? entry.last_updated.slice(0, 30) : undefined,
            }
          })
          trace.searches++
          return {
            ok: true,
            results,
            empty: results.length === 0,
            note: 'At most five ranked results. Snippets are excerpts; read pages to establish evidence. An empty search is not proof of absence.',
          }
        }),
    }),
    read_web_page: tool({
      description:
        'Read a public text or HTML page from a web_search result or URL supplied in the user question. The complete response is downloaded without a page-size cutoff. Pass the returned next object back to this tool to continue cached Markdown excerpts within the research reading budget. URL fragments select sections; sections lists available anchors. Offsets address UTF-8 bytes of the selected text, not HTML. Excerpt boundaries do not require alternative URLs or proxies. Do not claim unread content was read.',
      inputSchema: z.object({
        url: z.string().min(1).max(2000),
        offsetBytes: z.number().int().min(0).optional(),
        snapshot: z.string().optional(),
      }),
      execute: ({ url: requested, offsetBytes = 0, snapshot }: WebPageRequest) =>
        run('page', async (requestSignal) => {
          const url = publicUrl(requested)
          if (!knownUrls.has(url)) throw new WebError('unsafe_url', messages.unsafe_url)
          webTrace.attempted.add(url)
          const allowance = Math.min(options.chunkBytes, options.maxBytes - trace.bytes)
          if (allowance <= 0) throw new WebError('budget', messages.budget)
          trace.bytes += allowance
          let evidenceBytes = 0
          try {
            const result = await readPage({ url: requested, offsetBytes, snapshot }, allowance, requestSignal)
            if (/^(?:#*\s*)?(just a moment|access denied|attention required|checking your browser)/i.test(result.text))
              throw new WebError('page_blocked', messages.page_blocked)
            evidenceBytes = result.returnedBytes
            webTrace.urls.add(publicUrl(result.url))
            return result
          } finally {
            trace.bytes -= allowance - evidenceBytes
          }
        }),
    }),
  }
}
