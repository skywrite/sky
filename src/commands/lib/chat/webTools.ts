/**
 * Web search and fetch tools for a chat session (Perplexity Search API).
 * Public page/color reads require no search key; hosts gate only web_search.
 */

import { jsonSchema } from 'ai'
import { downloadWebPage, type PageFetch } from '../web/downloadPage.ts'
import { readWebColors } from '../web/pageColors.ts'
import { WebPageError } from '../web/pageContent.ts'
import { createWebPageReader, type WebPageRequest } from '../web/pageReader.ts'

interface SearchResult {
  title: string
  url: string
  snippet: string
}

export function createWebTools(options: { pageFetcher?: PageFetch } = {}) {
  const readPage = createWebPageReader((url, signal) => downloadWebPage(url, signal, options.pageFetcher))
  return {
    web_colors: {
      description:
        'Read exact color declarations, gradients and their source selectors from a public website and its linked CSS. Use this when an image request references a website’s colors or palette. Returns source evidence; these are static CSS declarations, not computed browser colors or inferred official brand values. Prefer this direct lookup before browser_task for public website color references.',
      inputSchema: jsonSchema<{ url: string }>({
        type: 'object',
        properties: { url: { type: 'string', description: 'The public website whose colors should guide the image' } },
        required: ['url'],
      }),
      execute: async ({ url }: { url: string }, execution?: { abortSignal?: AbortSignal }) => {
        const signal = AbortSignal.any([
          AbortSignal.timeout(15_000),
          ...(execution?.abortSignal ? [execution.abortSignal] : []),
        ])
        try {
          return await readWebColors(url, signal, options.pageFetcher)
        } catch (error) {
          execution?.abortSignal?.throwIfAborted()
          return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
        }
      },
    },
    web_search: {
      description:
        'Search the web for current information. Use this when the user asks about recent events, news, facts you are unsure about, or anything that requires up-to-date information beyond the notebook context.',
      inputSchema: jsonSchema<{ query: string }>({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      }),
      execute: async ({ query }: { query: string }): Promise<SearchResult[]> => {
        const apiKey = globalThis.process?.env?.PERPLEXITY_API_KEY
        if (!apiKey) return []

        const resp = await fetch('https://api.perplexity.ai/search', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query, max_results: 5 }),
        })

        if (!resp.ok) return []

        const data = await resp.json()
        const results: SearchResult[] = (data.results ?? []).map(
          (r: { title?: string; url?: string; snippet?: string }) => ({
            title: r.title ?? '',
            url: r.url ?? '',
            snippet: r.snippet ?? '',
          }),
        )
        return results
      },
    },
    web_fetch: {
      description:
        'Read a public web page as structured Markdown. The complete response is downloaded without a page-size cutoff. Long pages return an excerpt and a next object; pass next back to web_fetch to continue from the cached page until the requested material is read. URL fragments select HTML sections, and sections lists available anchors. Offsets address UTF-8 bytes of the selected Markdown text. Do not retry the beginning, guess paths, or use a proxy to work around excerpt boundaries. Report failed reads and missing sections honestly.',
      inputSchema: jsonSchema<WebPageRequest>({
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to read, optionally including an HTML section fragment' },
          offsetBytes: {
            type: 'integer',
            minimum: 0,
            description: 'Use nextOffsetBytes from the preceding result to continue',
          },
          snapshot: { type: 'string', description: 'Use the snapshot from the preceding result when continuing' },
        },
        required: ['url'],
      }),
      execute: async (request: WebPageRequest, execution?: { abortSignal?: AbortSignal }) => {
        const signal = AbortSignal.any([
          AbortSignal.timeout(10_000),
          ...(execution?.abortSignal ? [execution.abortSignal] : []),
        ])
        try {
          return await readPage(request, 20_000, signal)
        } catch (err) {
          execution?.abortSignal?.throwIfAborted()
          return {
            ok: false as const,
            code: err instanceof WebPageError ? err.code : signal.aborted ? 'timeout' : 'fetch_failed',
            error: err instanceof Error ? err.message : String(err),
            ...(err instanceof WebPageError && err.sections ? { sections: err.sections } : {}),
          }
        }
      },
    },
  }
}
