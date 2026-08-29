import { escapeHtml, normalizeText } from './text.ts'

/**
 * The clipboard into a prose block: HTML sanitized down to the forms markdown can carry,
 * tables flattened, markdown rendered first — then inserted at the selection.
 */

function sanitizeUrl(value: string): string {
  const normalized = value.trim()
  if (!normalized || /^javascript:/i.test(normalized)) {
    return ''
  }

  return normalized
}

function appendSanitizedNode(target: Node, node: Node | null) {
  if (!node) {
    return
  }

  target.appendChild(node)
}

function appendSanitizedChildren(source: Node, target: Node, documentRef: Document) {
  Array.from(source.childNodes).forEach((child) => {
    appendSanitizedNode(target, sanitizePastedNode(child, documentRef))
  })
}

function createMultilineParagraph(documentRef: Document, text: string): HTMLParagraphElement {
  const paragraph = documentRef.createElement('p')
  const lines = normalizeText(text).replace(/\r\n?/g, '\n').split('\n')

  lines.forEach((line, index) => {
    if (index > 0) {
      paragraph.appendChild(documentRef.createElement('br'))
    }
    paragraph.appendChild(documentRef.createTextNode(line))
  })

  return paragraph
}

function createTableFragment(table: HTMLElement, documentRef: Document) {
  const fragment = documentRef.createDocumentFragment()
  const rows = Array.from(table.querySelectorAll('tr'))
    .map((row) =>
      Array.from(row.querySelectorAll('th, td'))
        .map((cell) =>
          normalizeText(cell.textContent || '')
            .replace(/\s+/g, ' ')
            .trim(),
        )
        .filter((cell) => cell.length > 0)
        .join(' / '),
    )
    .filter((rowText) => rowText.length > 0)

  rows.forEach((rowText) => {
    fragment.appendChild(createMultilineParagraph(documentRef, rowText))
  })

  if (fragment.firstChild) {
    return fragment
  }

  const fallback = normalizeText(table.textContent || '').trim()
  if (fallback.length > 0) {
    fragment.appendChild(createMultilineParagraph(documentRef, fallback))
  }
  return fragment
}

function sanitizePastedNode(node: Node, documentRef: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return documentRef.createTextNode(normalizeText(node.textContent || ''))
  }

  if (!(node instanceof HTMLElement)) {
    return null
  }

  const tag = node.tagName.toLowerCase()

  switch (tag) {
    case 'strong':
    case 'b':
    case 'em':
    case 'i':
    case 'u':
    case 'del':
    case 's':
    case 'code':
    case 'p':
    case 'div':
    case 'blockquote':
    case 'ul':
    case 'ol':
    case 'li':
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const element = documentRef.createElement(tag)
      appendSanitizedChildren(node, element, documentRef)
      return element
    }
    case 'a': {
      const href = sanitizeUrl(node.getAttribute('href') || '')
      const element = documentRef.createElement('a')
      if (href) {
        element.setAttribute('href', href)
      }
      appendSanitizedChildren(node, element, documentRef)
      return element
    }
    case 'img': {
      const src = sanitizeUrl(node.getAttribute('src') || '')
      if (!src) {
        return null
      }
      const image = documentRef.createElement('img')
      image.setAttribute('src', src)
      image.setAttribute('alt', node.getAttribute('alt') || '')
      return image
    }
    case 'input': {
      if (node.getAttribute('type') !== 'checkbox') {
        return null
      }

      const checkbox = documentRef.createElement('input')
      checkbox.setAttribute('type', 'checkbox')
      const checked = node.hasAttribute('checked') || node.getAttribute('aria-checked') === 'true'
      if (checked) {
        checkbox.checked = true
        checkbox.setAttribute('checked', '')
      }
      return checkbox
    }
    case 'br':
      return documentRef.createElement('br')
    case 'pre':
      return createMultilineParagraph(documentRef, node.textContent || '')
    case 'table':
      return createTableFragment(node, documentRef)
    case 'hr':
      return createMultilineParagraph(documentRef, '---')
    case 'style':
    case 'script':
    case 'link':
    case 'meta':
    case 'noscript':
    case 'template':
      return null
    default: {
      const fragment = documentRef.createDocumentFragment()
      appendSanitizedChildren(node, fragment, documentRef)
      return fragment
    }
  }
}

export function sanitizePastedHtml(rawHtml: string, documentRef: Document): string {
  const parser = new DOMParser()
  const parsed = parser.parseFromString(rawHtml, 'text/html')
  const container = documentRef.createElement('div')
  appendSanitizedChildren(parsed.body, container, documentRef)
  return container.innerHTML
}

export function plainTextToHtml(text: string): string {
  const normalized = normalizeText(text).replace(/\r\n?/g, '\n').trimEnd()
  if (!normalized) {
    return ''
  }

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => '<p>' + paragraph.split('\n').map(escapeHtml).join('<br>') + '</p>')
    .join('')
}

export function insertHtmlAtSelection(article: HTMLElement, html: string): boolean {
  if (!html) {
    return false
  }

  const documentRef = article.ownerDocument
  article.focus()

  if (typeof documentRef.execCommand === 'function') {
    try {
      if (documentRef.execCommand('insertHTML', false, html)) {
        return true
      }
    } catch (_) {
      // Fall back to a manual Range insert.
    }
  }

  const selection = documentRef.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return false
  }

  const range = selection.getRangeAt(0)
  if (!article.contains(range.commonAncestorContainer)) {
    return false
  }

  range.deleteContents()

  const wrapper = documentRef.createElement('div')
  wrapper.innerHTML = html
  const fragment = documentRef.createDocumentFragment()
  let lastNode: Node | null = null

  while (wrapper.firstChild) {
    lastNode = fragment.appendChild(wrapper.firstChild)
  }

  range.insertNode(fragment)

  if (lastNode) {
    const nextRange = documentRef.createRange()
    nextRange.setStartAfter(lastNode)
    nextRange.collapse(true)
    selection.removeAllRanges()
    selection.addRange(nextRange)
  }

  return true
}
