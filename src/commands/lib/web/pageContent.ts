import { NodeHtmlMarkdown } from 'node-html-markdown'
import { parse, type HTMLElement } from 'node-html-parser'

const HEADINGS = 'h1, h2, h3, h4, h5, h6'
const markdown = new NodeHtmlMarkdown({ bulletMarker: '-', maxConsecutiveNewlines: 2 })

export interface WebSection {
  id: string
  title: string
}

export class WebPageError extends Error {
  constructor(
    readonly code: 'section_not_found' | 'invalid_offset' | 'cache_miss' | 'snapshot_changed' | 'empty_page',
    message: string,
    readonly sections?: WebSection[],
  ) {
    super(message)
  }
}

function clean(html: string, url: string) {
  const root = parse(html)
  const title = root.querySelector('title')?.text.trim()
  let base = url
  try {
    base = new URL(root.querySelector('base[href]')?.getAttribute('href') ?? url, url).href
  } catch {
    // A malformed base element does not make the document unreadable.
  }
  for (const node of root.querySelectorAll('script, style, noscript, svg, template, head')) node.remove()
  for (const node of root.querySelectorAll('a[href], img[src]')) {
    const attribute = node.tagName === 'A' ? 'href' : 'src'
    try {
      const destination = new URL(node.getAttribute(attribute)!, base)
      if (['http:', 'https:', 'mailto:', 'tel:'].includes(destination.protocol))
        node.setAttribute(attribute, destination.href)
      else node.removeAttribute(attribute)
    } catch {
      node.removeAttribute(attribute)
    }
  }
  return { root, title, base }
}

function sectionHtml(raw: string, root: HTMLElement, target: HTMLElement): string {
  let heading = target.closest(HEADINGS)
  // Older pages put an empty named anchor immediately before the heading.
  if (!heading && !target.text.trim()) {
    const next = root.querySelectorAll(HEADINGS).find((node) => node.range[0] >= target.range[1])
    if (
      next &&
      !raw
        .slice(target.range[1], next.range[0])
        .replace(/<[^>]*>/g, '')
        .trim()
    )
      heading = next
  }
  if (!heading) return target.outerHTML
  const level = Number(heading.tagName[1])
  const next = root
    .querySelectorAll(HEADINGS)
    .find((node) => node.range[0] > heading.range[0] && Number(node.tagName[1]) <= level)
  // Source ranges preserve all nested paragraphs, lists, and subsections until
  // the next peer heading, including when it lives in a different wrapper.
  return raw.slice(heading.range[0], next?.range[0] ?? raw.length)
}

export function extractWebPage(raw: string, contentType: string, url: string, section?: string) {
  if (!contentType.toLowerCase().includes('html')) {
    if (section)
      throw new WebPageError(
        'section_not_found',
        'This response has no HTML anchors. Read the URL without its fragment.',
      )
    return { text: raw.trim(), title: undefined, sections: [] as WebSection[] }
  }
  const { root, title, base } = clean(raw, url)
  const anchors = root.querySelectorAll('[id], a[name]')
  const sections = anchors.map((node) => ({
    id: node.getAttribute('id') || node.getAttribute('name')!,
    title: (node.querySelector(HEADINGS)?.text ?? node.text).replace(/\s+/g, ' ').trim().slice(0, 160),
  }))
  let html = root.innerHTML
  if (section) {
    const target = anchors.find((node) => node.getAttribute('id') === section || node.getAttribute('name') === section)
    if (!target)
      throw new WebPageError(
        'section_not_found',
        `No HTML anchor matches #${section}. Choose an available section or read the URL without its fragment.`,
        sections.slice(0, 100),
      )
    html = clean(sectionHtml(raw, root, target), base).root.innerHTML
  }
  return { text: markdown.translate(html).trim(), title, sections }
}
