/**
 * Ranges, selection and node surgery on the block being edited — no editor state, no
 * markdown; the pieces the commands are built from.
 */

export function getSelectionRangeWithin(article: Element): Range | null {
  const selection = article.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return null
  }

  const range = selection.getRangeAt(0)
  if (!article.contains(range.startContainer) || !article.contains(range.endContainer)) {
    return null
  }

  return range
}

export function getClosestElementWithin(within: Element, node: Node, selector: string): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement
  if (!element) {
    return null
  }

  const closest = element.closest(selector)
  if (!(closest instanceof HTMLElement) || !within.contains(closest)) {
    return null
  }

  return closest
}

export function isRangeAtStart(container: Element, range: Range): boolean {
  const prefixRange = container.ownerDocument.createRange()
  prefixRange.selectNodeContents(container)
  prefixRange.setEnd(range.startContainer, range.startOffset)
  return prefixRange.toString().length === 0
}

export function isRangeAtEnd(container: Element, range: Range): boolean {
  const suffixRange = container.ownerDocument.createRange()
  suffixRange.selectNodeContents(container)
  suffixRange.setStart(range.endContainer, range.endOffset)
  return suffixRange.toString().length === 0
}

export function isRangeEquivalentToElementContents(range: Range, element: Element): boolean {
  const elementRange = element.ownerDocument.createRange()
  elementRange.selectNodeContents(element)
  return (
    range.compareBoundaryPoints(Range.START_TO_START, elementRange) === 0 &&
    range.compareBoundaryPoints(Range.END_TO_END, elementRange) === 0
  )
}

export function hasMeaningfulChildNodes(fragment: Node) {
  return Array.from(fragment.childNodes).some((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || '').length > 0
    }

    return node instanceof HTMLElement
  })
}

export function clearNode(element: Node) {
  while (element.firstChild) {
    element.removeChild(element.firstChild)
  }
}

export function createPlaceholder(doc: Document): HTMLBRElement {
  return doc.createElement('br')
}

export function setElementFromFragment(element: HTMLElement, fragment: DocumentFragment) {
  clearNode(element)
  if (hasMeaningfulChildNodes(fragment)) {
    element.appendChild(fragment)
    return
  }

  element.appendChild(createPlaceholder(element.ownerDocument))
}

export function removePlaceholderIfNeeded(element: Element) {
  if (element.childNodes.length !== 1) {
    return
  }

  const firstChild = element.firstChild
  if (firstChild instanceof HTMLElement && firstChild.tagName === 'BR') {
    element.removeChild(firstChild)
  }
}

export function placeCaretAtElementStart(element: Element) {
  const selection = element.ownerDocument.getSelection()
  if (!selection) return

  const range = element.ownerDocument.createRange()
  range.selectNodeContents(element)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

export function placeCaretAtElementEnd(element: Element) {
  const selection = element.ownerDocument.getSelection()
  if (!selection) return

  const range = element.ownerDocument.createRange()
  range.selectNodeContents(element)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

export function splitElementAtRange(element: HTMLElement, range: Range, nextTagName: string): HTMLElement {
  const doc = element.ownerDocument
  const beforeRange = doc.createRange()
  beforeRange.selectNodeContents(element)
  beforeRange.setEnd(range.startContainer, range.startOffset)

  const afterRange = doc.createRange()
  afterRange.selectNodeContents(element)
  afterRange.setStart(range.endContainer, range.endOffset)

  const beforeFragment = beforeRange.cloneContents()
  const afterFragment = afterRange.cloneContents()

  setElementFromFragment(element, beforeFragment)

  const nextElement = doc.createElement(nextTagName)
  setElementFromFragment(nextElement, afterFragment)

  element.parentNode?.insertBefore(nextElement, element.nextSibling)
  placeCaretAtElementStart(nextElement)

  return nextElement
}

export function replaceElementTag(element: Element, tagName: string): HTMLElement {
  const replacement = element.ownerDocument.createElement(tagName)
  while (element.firstChild) {
    replacement.appendChild(element.firstChild)
  }
  element.replaceWith(replacement)
  return replacement
}

export function getLeadingBlockElement(article: Element): HTMLElement | null {
  return Array.from(article.children).find((node): node is HTMLElement => node instanceof HTMLElement) ?? null
}

export function getPreviousElementSibling(element: Node): HTMLElement | null {
  let candidate = element.previousSibling
  while (candidate) {
    if (candidate instanceof HTMLElement) {
      return candidate
    }
    candidate = candidate.previousSibling
  }
  return null
}

export function unwrapInlineElement(element: Element): boolean {
  const parent = element.parentNode
  if (!parent) {
    return false
  }

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element)
  }

  element.remove()
  return true
}

export function createEmptyParagraph(documentRef: Document): HTMLParagraphElement {
  const paragraph = documentRef.createElement('p')
  paragraph.appendChild(createPlaceholder(documentRef))
  return paragraph
}

export function replaceArticleContent(article: HTMLElement, rootElement: HTMLElement) {
  clearNode(article)
  article.appendChild(rootElement)
}
