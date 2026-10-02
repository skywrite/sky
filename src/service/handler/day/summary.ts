import * as path from 'node:path'
import { Marked, type Token } from 'marked'
import { parse as parseHtml } from 'node-html-parser'
import splitYamlMarkdown from '#shared/models/Markdown/util/splitYamlMarkdown.ts'
import { explorerHref } from '../explorer/mod.ts'
import { readMarkdownContent } from '../markdown-preview/content.ts'

export interface SummarySource {
  label: string
  href: string
}

export interface SummaryPassage {
  html: string
  sources: SummarySource[]
}

export interface SummaryMoment extends SummaryPassage {
  title: string
  when: string | null
}

export interface DaySummary {
  /** Notebook-relative path to the saved summary, which remains the complete record. */
  path: string
  version: number
  headline: string | null
  location: string | null
  opening: SummaryPassage
  moments: SummaryMoment[]
  /** Summaries without the recognized opening are still readable as documents. */
  documentHtml: string | null
}

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const CITATION =
  /^(?:slack|email|meeting|chat|recap|journal|day|tracking|github|gdoc|call|video|loom|audio|imessage|notes?|source)(?:\s+\d{1,2}:\d{2})?$/i

/** A source is relative to summary.md, never to the day page's URL. */
function sourceHref(href: string, summaryPath: string): string | null {
  if (/[\u0000-\u0020\\]/.test(href.replaceAll(' ', ''))) return null
  if (/^(?:https?:\/\/|mailto:)/i.test(href)) return href
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) return null
  if (href.startsWith('#')) return `${explorerHref(summaryPath)}${href}`
  if (href.startsWith('/explorer/') || href.startsWith('/docs/')) return href
  const split = href.search(/[?#]/)
  const pathname = split < 0 ? href : href.slice(0, split)
  const suffix = split < 0 ? '' : href.slice(split)
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const resolved = path.posix.normalize(
    decoded.startsWith('/') ? decoded.slice(1) : path.posix.join(path.posix.dirname(summaryPath), decoded),
  )
  if (resolved === '..' || resolved.startsWith('../')) return null
  return /\.md$/i.test(resolved)
    ? `${explorerHref(resolved)}${suffix}`
    : `/docs/_api/file/${resolved.split('/').map(encodeURIComponent).join('/')}?document=${encodeURIComponent(summaryPath)}`
}

const lexer = new Marked()
const textOf = (text: string) => parseHtml(lexer.parseInline(text, { async: false })).textContent.trim()

function section(tokens: Token[], name: string): Token[] | null {
  const start = tokens.findIndex(
    (token) => token.type === 'heading' && token.depth === 2 && textOf(token.text).toLowerCase() === name,
  )
  if (start < 0) return null
  let end = start + 1
  while (end < tokens.length) {
    const next = tokens[end]
    if (next.type === 'heading' && next.depth <= 2) break
    end++
  }
  return tokens.slice(start + 1, end).filter((token) => token.type !== 'hr')
}

/** Pull only the prompt's standalone metadata lines out of the prose. */
function takeLabel(tokens: Token[], label: string): string | null {
  const at = tokens.findIndex((token) => token.type === 'paragraph' && textOf(token.text).startsWith(`${label}:`))
  if (at < 0) return null
  const token = tokens[at]
  const lines = token.raw.trim().split('\n')
  const value = textOf(lines[0])
    .slice(label.length + 1)
    .trim()
  tokens.splice(at, 1, ...lexer.lexer(lines.slice(1).join('\n')))
  return value || null
}

function passage(tokens: Token[], summaryPath: string, collectSources = true): SummaryPassage {
  const sources: SummarySource[] = []
  const markdown = new Marked({
    renderer: {
      // Saved prose is Markdown, never executable HTML or embedded remote media.
      html: ({ text }) => escapeHtml(text),
      image: ({ text }) => escapeHtml(text),
      link({ href, text, tokens: inline }) {
        const label = textOf(text)
        const resolved = sourceHref(href, summaryPath)
        const html = inline ? this.parser.parseInline(inline) : escapeHtml(text)
        if (!resolved) return html
        if (collectSources && CITATION.test(label)) {
          if (!sources.some((source) => source.href === resolved)) sources.push({ label, href: resolved })
          return ''
        }
        return `<a href="${escapeHtml(resolved)}" rel="noreferrer">${html}</a>`
      },
      paragraph({ tokens: inline }) {
        const html = this.parser.parseInline(inline).trim()
        return html ? `<p>${html}</p>\n` : ''
      },
    },
  })
  return { html: markdown.parser(tokens).trim(), sources }
}

/** Read the saved opening structurally; no new prose, inferred moments, or AI call. */
export function parseDaySummary(content: string, summaryPath: string, version = 0): DaySummary {
  const { markdown } = splitYamlMarkdown(content.replaceAll('\r\n', '\n'))
  const tokens = lexer.lexer(markdown.replace(/<!--[\s\S]*?-->/g, '').trim())
  const glance = section(tokens, 'day at a glance')
  const momentTokens = section(tokens, 'meaningful moments') ?? []
  const moments: SummaryMoment[] = []
  for (let i = 0; i < momentTokens.length; i++) {
    const heading = momentTokens[i]
    if (heading.type !== 'heading' || heading.depth !== 3) continue
    let end = i + 1
    while (end < momentTokens.length) {
      const next = momentTokens[end]
      if (next.type === 'heading' && next.depth === 3) break
      end++
    }
    const body = momentTokens.slice(i + 1, end)
    const when = takeLabel(body, 'When')
    moments.push({ title: textOf(heading.text), when, ...passage(body, summaryPath) })
    i = end - 1
  }
  let headline: string | null = null
  if (glance) {
    const at = glance.findIndex((token) => token.type === 'heading' && token.depth === 3)
    const heading = glance[at]
    if (heading?.type === 'heading') {
      headline = textOf(heading.text)
      glance.splice(at, 1)
    }
  }
  const location = glance ? takeLabel(glance, 'Location') : null
  return {
    path: summaryPath,
    version,
    headline,
    location,
    opening: passage(glance ?? [], summaryPath),
    moments,
    documentHtml: glance === null && moments.length === 0 ? passage(tokens, summaryPath, false).html : null,
  }
}

export async function readDaySummary(dayDir: string, notebookRoot: string): Promise<DaySummary | null> {
  const file = path.join(dayDir, 'summary.md')
  try {
    const { content, version } = await readMarkdownContent(file)
    return parseDaySummary(content, path.relative(notebookRoot, file).split(path.sep).join('/'), version)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
