import {
  clearNode,
  createEmptyParagraph,
  createPlaceholder,
  getLeadingBlockElement,
  getSelectionRangeWithin,
  placeCaretAtElementEnd,
  placeCaretAtElementStart,
  replaceArticleContent,
  replaceElementTag,
} from './dom.ts'
import { createEmptyListItem } from './lists.ts'
import { normalizeText } from './text.ts'
import type { EditableBlock } from './types.ts'

/**
 * What typing at the start of a prose block means: `## ` makes a heading, `- ` / `1. ` /
 * `[ ] ` a list, `> ` a quote, `---` a rule. Each returns whether it applied.
 */

export function normalizeVisualBlockType(article: Element): string {
  const firstElement = getLeadingBlockElement(article)
  if (!(firstElement instanceof HTMLElement)) {
    return 'paragraph'
  }

  const tag = firstElement.tagName.toLowerCase()
  if (/^h[1-6]$/.test(tag)) {
    return 'heading'
  }
  if (tag === 'blockquote') {
    return 'blockquote'
  }
  if (tag === 'ul' || tag === 'ol') {
    return 'list'
  }
  if (tag === 'hr') {
    return 'hr'
  }

  return 'paragraph'
}

export function countTopLevelBlockElements(article: Element): number {
  return Array.from(article.children).filter((node) => {
    if (!(node instanceof HTMLElement)) {
      return false
    }

    const tag = node.tagName.toLowerCase()
    return ['p', 'div', 'blockquote', 'ul', 'ol', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)
  }).length
}

export function applyHeadingShortcut(article: HTMLElement, block: EditableBlock): boolean {
  const range = getSelectionRangeWithin(article)
  if (!range || !range.collapsed) {
    return false
  }

  const firstElement = getLeadingBlockElement(article)
  if (!(firstElement instanceof HTMLElement)) {
    return false
  }

  const tag = firstElement.tagName.toLowerCase()
  if (tag !== 'p' && tag !== 'div') {
    return false
  }

  const prefixRange = article.ownerDocument.createRange()
  prefixRange.selectNodeContents(firstElement)
  prefixRange.setEnd(range.startContainer, range.startOffset)

  const suffixRange = article.ownerDocument.createRange()
  suffixRange.selectNodeContents(firstElement)
  suffixRange.setStart(range.endContainer, range.endOffset)

  const prefixText = normalizeText(prefixRange.toString()).trim()
  const suffixText = normalizeText(suffixRange.toString()).trim()
  const fullText = normalizeText(firstElement.textContent || '').trim()
  const match = fullText.match(/^#{1,6}$/)
  if (!match) {
    return false
  }

  if (prefixText !== fullText || suffixText.length > 0) {
    return false
  }

  const heading = replaceElementTag(firstElement, 'h' + fullText.length)
  clearNode(heading)
  heading.appendChild(createPlaceholder(heading.ownerDocument))
  block.type = 'heading'
  placeCaretAtElementStart(heading)
  return true
}

export function applyParagraphPrefixShortcut(article: HTMLElement, block: EditableBlock): boolean {
  const range = getSelectionRangeWithin(article)
  if (!range || !range.collapsed) {
    return false
  }

  const firstElement = getLeadingBlockElement(article)
  if (!(firstElement instanceof HTMLElement)) {
    return false
  }

  const tag = firstElement.tagName.toLowerCase()
  if (tag !== 'p' && tag !== 'div') {
    return false
  }

  const prefixRange = article.ownerDocument.createRange()
  prefixRange.selectNodeContents(firstElement)
  prefixRange.setEnd(range.startContainer, range.startOffset)

  const suffixRange = article.ownerDocument.createRange()
  suffixRange.selectNodeContents(firstElement)
  suffixRange.setStart(range.endContainer, range.endOffset)

  const prefixText = normalizeText(prefixRange.toString()).trim()
  const suffixText = normalizeText(suffixRange.toString()).trim()
  const fullText = normalizeText(firstElement.textContent || '').trim()

  if (prefixText !== fullText || suffixText.length > 0) {
    return false
  }

  const documentRef = article.ownerDocument

  if (/^[-+*]$/.test(fullText)) {
    const list = documentRef.createElement('ul')
    const listItem = createEmptyListItem(documentRef)
    list.appendChild(listItem)
    replaceArticleContent(article, list)
    block.type = 'list'
    placeCaretAtElementEnd(listItem)
    return true
  }

  if (/^\d+[.)]$/.test(fullText)) {
    const list = documentRef.createElement('ol')
    const listItem = createEmptyListItem(documentRef)
    list.appendChild(listItem)
    replaceArticleContent(article, list)
    block.type = 'list'
    placeCaretAtElementEnd(listItem)
    return true
  }

  if (/^\[(?: |x|X)\]$/.test(fullText)) {
    const list = documentRef.createElement('ul')
    const listItem = createEmptyListItem(documentRef, /x/i.test(fullText))
    list.appendChild(listItem)
    replaceArticleContent(article, list)
    block.type = 'list'
    placeCaretAtElementEnd(listItem)
    return true
  }

  if (fullText === '>') {
    const quote = documentRef.createElement('blockquote')
    const paragraph = createEmptyParagraph(documentRef)
    quote.appendChild(paragraph)
    replaceArticleContent(article, quote)
    block.type = 'blockquote'
    placeCaretAtElementStart(paragraph)
    return true
  }

  return false
}

export function applyThematicBreakShortcut(article: HTMLElement): boolean {
  const range = getSelectionRangeWithin(article)
  if (!range || !range.collapsed) {
    return false
  }

  const firstElement = getLeadingBlockElement(article)
  if (!(firstElement instanceof HTMLElement)) {
    return false
  }

  const tag = firstElement.tagName.toLowerCase()
  if (tag !== 'p' && tag !== 'div') {
    return false
  }

  const prefixRange = article.ownerDocument.createRange()
  prefixRange.selectNodeContents(firstElement)
  prefixRange.setEnd(range.startContainer, range.startOffset)

  const suffixRange = article.ownerDocument.createRange()
  suffixRange.selectNodeContents(firstElement)
  suffixRange.setStart(range.endContainer, range.endOffset)

  const fullText = normalizeText(firstElement.textContent || '').trim()
  const prefixText = normalizeText(prefixRange.toString()).trim()
  const suffixText = normalizeText(suffixRange.toString()).trim()

  if (!/^(-{3,}|\*{3,}|_{3,})$/.test(fullText)) {
    return false
  }

  if (prefixText !== fullText || suffixText.length > 0) {
    return false
  }

  const documentRef = article.ownerDocument
  const hr = documentRef.createElement('hr')
  const paragraph = createEmptyParagraph(documentRef)
  clearNode(article)
  article.appendChild(hr)
  article.appendChild(paragraph)
  placeCaretAtElementStart(paragraph)
  return true
}

function applyTaskListShortcutFallback(article: HTMLElement, block: EditableBlock): boolean {
  const firstElement = getLeadingBlockElement(article)
  if (!(firstElement instanceof HTMLElement)) {
    return false
  }

  const tag = firstElement.tagName.toLowerCase()
  if (tag !== 'p' && tag !== 'div') {
    return false
  }

  const fullText = normalizeText(firstElement.textContent || '')
  const match = fullText.match(/^\[( |x|X)\]\s+([\s\S]*)$/)
  if (!match) {
    return false
  }

  const checked = (match[1] || '').toLowerCase() === 'x'
  const content = match[2] ?? ''
  const documentRef = article.ownerDocument
  const list = documentRef.createElement('ul')
  const listItem = createEmptyListItem(documentRef, checked)
  clearNode(listItem)

  const checkbox = documentRef.createElement('input')
  checkbox.setAttribute('type', 'checkbox')
  checkbox.checked = checked
  if (checked) {
    checkbox.setAttribute('checked', '')
  }
  listItem.appendChild(checkbox)
  listItem.appendChild(documentRef.createTextNode(' '))

  if (content.length > 0) {
    listItem.appendChild(documentRef.createTextNode(content))
  } else {
    listItem.appendChild(createPlaceholder(documentRef))
  }

  list.appendChild(listItem)
  replaceArticleContent(article, list)
  block.type = 'list'
  placeCaretAtElementEnd(listItem)
  return true
}

export function applyMarkdownShortcuts(article: HTMLElement, block: EditableBlock): boolean {
  if (applyTaskListShortcutFallback(article, block)) {
    return true
  }
  block.type = normalizeVisualBlockType(article)
  return false
}
