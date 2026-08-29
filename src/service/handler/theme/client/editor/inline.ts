import {
  getClosestElementWithin,
  getSelectionRangeWithin,
  hasMeaningfulChildNodes,
  isRangeEquivalentToElementContents,
  unwrapInlineElement,
} from './dom.ts'

/**
 * While a prose block is open its markdown shows through: the inline forms get their marks
 * (`**`, `*`, a backtick, `[…](…)`) from CSS keyed on attributes set here, the one under the
 * caret marked as focused. Also Cmd+U, which the browser has no markdown for.
 */

export function clearInlineFocusMarkers(article: Element) {
  article.querySelectorAll('[data-inline-focus="true"]').forEach((node) => {
    if (node instanceof HTMLElement) {
      node.removeAttribute('data-inline-focus')
    }
  })
}

export function setInlineRevealEnabled(article: Element, enabled: boolean) {
  if (enabled) {
    article.setAttribute('data-inline-reveal', 'true')
    return
  }

  article.removeAttribute('data-inline-reveal')
}

function findFocusedInlineElement(article: Element, node: Node): HTMLElement | null {
  let current = node instanceof HTMLElement ? node : node.parentElement
  while (current && current !== article) {
    if (current.matches('strong, em, del, code, a, u')) {
      return current
    }
    current = current.parentElement
  }
  return null
}

export function refreshInlineFocusMarkers(article: HTMLElement) {
  clearInlineFocusMarkers(article)
  const range = getSelectionRangeWithin(article)
  if (!range) {
    setInlineRevealEnabled(article, false)
    return
  }

  setInlineRevealEnabled(article, true)
  const target = findFocusedInlineElement(article, range.startContainer)
  if (target) {
    target.setAttribute('data-inline-focus', 'true')
  }
}

export function applyUnderlineShortcut(article: HTMLElement): boolean {
  const range = getSelectionRangeWithin(article)
  if (!range || range.collapsed) {
    return false
  }

  const startUnderline = getClosestElementWithin(article, range.startContainer, 'u')
  const endUnderline = getClosestElementWithin(article, range.endContainer, 'u')

  if (
    startUnderline &&
    endUnderline &&
    startUnderline === endUnderline &&
    isRangeEquivalentToElementContents(range, startUnderline)
  ) {
    const firstNode = startUnderline.firstChild
    const lastNode = startUnderline.lastChild
    if (!firstNode || !lastNode) {
      return false
    }

    if (!unwrapInlineElement(startUnderline)) {
      return false
    }

    const selection = article.ownerDocument.getSelection()
    if (selection) {
      const unwrappedRange = article.ownerDocument.createRange()
      unwrappedRange.setStart(firstNode, 0)
      if (lastNode.nodeType === Node.TEXT_NODE) {
        unwrappedRange.setEnd(lastNode, (lastNode.textContent || '').length)
      } else {
        unwrappedRange.setEnd(lastNode, lastNode.childNodes.length)
      }
      selection.removeAllRanges()
      selection.addRange(unwrappedRange)
    }

    return true
  }

  const fragment = range.extractContents()
  if (!hasMeaningfulChildNodes(fragment)) {
    return false
  }

  const underline = article.ownerDocument.createElement('u')
  underline.appendChild(fragment)
  range.insertNode(underline)

  const selection = article.ownerDocument.getSelection()
  if (selection) {
    const underlinedRange = article.ownerDocument.createRange()
    underlinedRange.selectNodeContents(underline)
    selection.removeAllRanges()
    selection.addRange(underlinedRange)
  }

  return true
}
