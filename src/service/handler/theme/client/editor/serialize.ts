import { normalizeText } from './text.ts'
import type { EditableBlock } from './types.ts'

/**
 * The edited DOM back to markdown: inline forms, headings, lists with their nesting and
 * checkboxes, quotes, rules — and the normalizing that keeps a save from rewriting more of
 * the file than the block.
 */

function escapeMarkdownText(text: string): string {
  const tick = String.fromCharCode(96)
  return normalizeText(text)
    .replace(/\\/g, '\\\\')
    .replace(new RegExp(tick, 'g'), '\\' + tick)
    .replace(/([*_{}\[\]])/g, '\\$1')
}

function serializeCodeText(text: string): string {
  const normalized = normalizeText(text)
  const tick = String.fromCharCode(96)
  const marker = normalized.includes(tick) ? tick + tick : tick
  return marker + normalized + marker
}

function serializeInlineNodes(nodes: ArrayLike<Node> | Iterable<Node>): string {
  let output = ''

  Array.from(nodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      output += escapeMarkdownText(node.textContent || '')
      return
    }

    if (!(node instanceof HTMLElement)) {
      return
    }

    const tag = node.tagName.toLowerCase()

    switch (tag) {
      case 'strong':
      case 'b':
        output += '**' + serializeInlineNodes(node.childNodes) + '**'
        return
      case 'em':
      case 'i':
        output += '*' + serializeInlineNodes(node.childNodes) + '*'
        return
      case 'del':
      case 's':
        output += '~~' + serializeInlineNodes(node.childNodes) + '~~'
        return
      case 'u':
        output += '<u>' + serializeInlineNodes(node.childNodes) + '</u>'
        return
      case 'code':
        output += serializeCodeText(node.textContent || '')
        return
      case 'a': {
        const href = node.getAttribute('href') || ''
        output += '[' + serializeInlineNodes(node.childNodes) + '](' + href.replace(/\)/g, '\\)') + ')'
        return
      }
      case 'img': {
        const src = node.getAttribute('src') || ''
        const alt = node.getAttribute('alt') || ''
        output += '![' + escapeMarkdownText(alt) + '](' + src.replace(/\)/g, '\\)') + ')'
        return
      }
      case 'br':
        output += '\n'
        return
      case 'input':
        return
      default:
        output += serializeInlineNodes(node.childNodes)
    }
  })

  return output
}

function isWhitespaceNode(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim().length === 0
}

function serializeBlockElement(element: HTMLElement, depth: number): string {
  const tag = element.tagName.toLowerCase()

  switch (tag) {
    case 'p':
      return serializeInlineNodes(element.childNodes).trimEnd()
    case 'div':
      return serializeInlineNodes(element.childNodes).trimEnd()
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return '#'.repeat(Number(tag.slice(1))) + ' ' + serializeInlineNodes(element.childNodes).trimEnd()
    case 'blockquote':
      return serializeBlockquote(element, depth)
    case 'ul':
    case 'ol':
      return serializeList(element, depth)
    case 'hr':
      return '---'
    default:
      return serializeInlineNodes(element.childNodes).trimEnd()
  }
}

function serializeBlockChildren(container: Node, depth: number): string {
  const parts: string[] = []
  const directNodes = Array.from(container.childNodes).filter((node) => !isWhitespaceNode(node))

  directNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeSerializedMarkdown(escapeMarkdownText(node.textContent || '')).trim()
      if (text.length > 0) {
        parts.push(text)
      }
      return
    }

    if (!(node instanceof HTMLElement)) {
      return
    }

    const serialized = normalizeSerializedMarkdown(serializeBlockElement(node, depth))
    if (serialized.trim().length === 0) {
      return
    }
    parts.push(serialized)
  })

  return parts.join('\n\n')
}

function serializeBlockquote(blockquote: HTMLElement, depth: number): string {
  const inner = serializeBlockChildren(blockquote, depth).trimEnd()
  if (inner.length === 0) {
    return '>'
  }

  return inner
    .split('\n')
    .map((line) => (line.length > 0 ? '> ' + line : '>'))
    .join('\n')
}

function serializeListItem(li: HTMLElement, ordered: boolean, index: number, depth: number): string {
  const indent = '  '.repeat(depth)
  const checkbox = li.querySelector<HTMLInputElement>(':scope > input[type="checkbox"]')
  const checkboxPrefix = checkbox ? (checkbox.checked ? '[x] ' : '[ ] ') : ''

  const inlineNodes: Node[] = []
  const nestedLists: HTMLElement[] = []

  Array.from(li.childNodes).forEach((node) => {
    if (node instanceof HTMLElement && (node.tagName === 'UL' || node.tagName === 'OL')) {
      nestedLists.push(node)
      return
    }

    if (node instanceof HTMLElement && node.tagName === 'INPUT' && node.getAttribute('type') === 'checkbox') {
      return
    }

    inlineNodes.push(node)
  })

  const marker = ordered ? String(index + 1) + '. ' : '- '
  const lineBody = serializeInlineNodes(inlineNodes).trim()
  const lines = [indent + marker + checkboxPrefix + lineBody]

  nestedLists.forEach((list) => {
    const nestedMarkdown = serializeList(list, depth + 1)
    if (nestedMarkdown.length > 0) {
      lines.push(nestedMarkdown)
    }
  })

  return lines.join('\n')
}

function serializeList(listElement: HTMLElement, depth: number): string {
  const ordered = listElement.tagName === 'OL'
  return Array.from(listElement.children)
    .filter((node): node is HTMLElement => node instanceof HTMLElement && node.tagName === 'LI')
    .map((li, index) => serializeListItem(li, ordered, index, depth))
    .join('\n')
}

function normalizeSerializedMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      if (/^[ \t]+$/.test(line)) {
        return ''
      }
      return line.replace(/[ \t]+$/g, '')
    })
    .join('\n')
}

export function serializeVisualBlock(block: EditableBlock, previewArticle: HTMLElement): string {
  const markdown = normalizeSerializedMarkdown(serializeBlockChildren(previewArticle, 0)).trimEnd()
  return markdown.length > 0 ? markdown + '\n' : '\n'
}

export function normalizeVisualSaveRaw(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(/\n[ \t]+\n/g, '\n\n')
}

export function normalizeVisualSaveSuffix(suffix: string): string {
  return suffix.replace(/^[^\S\n]+\n/, '')
}
