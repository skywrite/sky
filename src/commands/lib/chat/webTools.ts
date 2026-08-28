/**
 * Web search and fetch tools for a chat session (Perplexity Search API).
 * Config-gated: a host offers them only when PERPLEXITY_API_KEY is set.
 */

import { jsonSchema } from 'ai'
import truncate from '#shared/strings/truncate.ts'

interface SearchResult {
  title: string
  url: string
  snippet: string
}

/** Strip HTML tags and collapse whitespace to get readable text. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

const MAX_FETCH_CHARS = 20000

export function createWebTools() {
  return {
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
        'Fetch the full content of a web page by URL. Use this after web_search to read the full text of a promising result.',
      inputSchema: jsonSchema<{ url: string }>({
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch' },
        },
        required: ['url'],
      }),
      execute: async ({ url }: { url: string }): Promise<string> => {
        try {
          const resp = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NotebookBot/1.0)' },
            signal: AbortSignal.timeout(10000),
          })
          if (!resp.ok) return `Error: ${resp.status} ${resp.statusText}`

          const contentType = resp.headers.get('content-type') ?? ''
          const raw = await resp.text()

          const text = contentType.includes('html') ? htmlToText(raw) : raw
          return truncate(text, MAX_FETCH_CHARS, '\n\n[Content truncated...]')
        } catch (err) {
          return `Error fetching URL: ${(err as Error).message}`
        }
      },
    },
  }
}
