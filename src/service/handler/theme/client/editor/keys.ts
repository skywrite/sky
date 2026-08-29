import {
  createEmptyParagraph,
  createPlaceholder,
  getClosestElementWithin,
  getPreviousElementSibling,
  getSelectionRangeWithin,
  hasMeaningfulChildNodes,
  isRangeAtEnd,
  isRangeAtStart,
  placeCaretAtElementEnd,
  placeCaretAtElementStart,
  removePlaceholderIfNeeded,
  replaceElementTag,
  splitElementAtRange,
} from './dom.ts'
import {
  getDeepestLastListItem,
  indentListItem,
  isNestedListItem,
  mergeListItems,
  mergeParagraphIntoListItem,
  outdentListItem,
  splitActiveListItem,
  unwrapListItemToParagraph,
} from './lists.ts'
import { applyThematicBreakShortcut } from './shortcuts.ts'
import { normalizeText } from './text.ts'

/**
 * Enter, Backspace and Tab inside a prose block: split, merge, unwrap, indent. Each returns
 * whether it changed the DOM; the caller marks the document dirty.
 */

function mergeBlockElements(target: HTMLElement, source: HTMLElement) {
  removePlaceholderIfNeeded(target)

  const movingNodes = Array.from(source.childNodes)
  for (const node of movingNodes) {
    target.appendChild(node)
  }

  source.remove()
  placeCaretAtElementEnd(target)
}

function mergeParagraphWithPrevious(paragraph: HTMLElement): boolean {
  const previous = getPreviousElementSibling(paragraph)
  if (!previous) {
    return false
  }

  const tag = previous.tagName
  if (tag === 'P' || tag === 'DIV' || /^H[1-6]$/.test(tag)) {
    mergeBlockElements(previous, paragraph)
    return true
  }

  if (tag === 'BLOCKQUOTE') {
    const targetParagraph = Array.from(previous.children)
      .filter((child) => child.tagName === 'P')
      .at(-1)

    if (targetParagraph instanceof HTMLElement) {
      mergeBlockElements(targetParagraph, paragraph)
      return true
    }
  }

  if (tag === 'UL' || tag === 'OL') {
    const targetItem = getDeepestLastListItem(previous)
    if (targetItem) {
      return mergeParagraphIntoListItem(targetItem, paragraph)
    }
    previous.remove()
    placeCaretAtElementStart(paragraph)
    return true
  }

  if (tag === 'HR') {
    previous.remove()
    placeCaretAtElementStart(paragraph)
    return true
  }

  return false
}

function unwrapBlockquoteParagraph(paragraph: HTMLElement): boolean {
  const blockquote = paragraph.parentElement
  if (!(blockquote instanceof HTMLElement) || blockquote.tagName !== 'BLOCKQUOTE') {
    return false
  }

  const previousSibling = getPreviousElementSibling(paragraph)
  if (previousSibling) {
    return false
  }

  const parent = blockquote.parentNode
  if (!parent) {
    return false
  }

  const liftedParagraph = paragraph.ownerDocument.createElement('p')
  while (paragraph.firstChild) {
    liftedParagraph.appendChild(paragraph.firstChild)
  }
  if (!hasMeaningfulChildNodes(liftedParagraph)) {
    liftedParagraph.appendChild(createPlaceholder(paragraph.ownerDocument))
  }

  parent.insertBefore(liftedParagraph, blockquote)
  paragraph.remove()

  if (!blockquote.children.length) {
    blockquote.remove()
  }

  placeCaretAtElementStart(liftedParagraph)
  return true
}

function splitActiveHeading(article: HTMLElement, range: Range): boolean {
  const heading = getClosestElementWithin(article, range.startContainer, 'h1, h2, h3, h4, h5, h6')
  if (!heading) {
    return false
  }

  if (isRangeAtStart(heading, range)) {
    const paragraph = createEmptyParagraph(heading.ownerDocument)
    heading.parentNode?.insertBefore(paragraph, heading)
    placeCaretAtElementStart(paragraph)
    return true
  }

  if (isRangeAtEnd(heading, range)) {
    const paragraph = createEmptyParagraph(heading.ownerDocument)
    heading.parentNode?.insertBefore(paragraph, heading.nextSibling)
    placeCaretAtElementStart(paragraph)
    return true
  }

  splitElementAtRange(heading, range, 'p')
  return true
}

function splitActiveParagraph(article: HTMLElement, range: Range): boolean {
  const paragraph = getClosestElementWithin(article, range.startContainer, 'p')
  if (!paragraph) {
    return false
  }

  if (isRangeAtStart(paragraph, range)) {
    const nextParagraph = createEmptyParagraph(paragraph.ownerDocument)
    paragraph.parentNode?.insertBefore(nextParagraph, paragraph)
    placeCaretAtElementStart(nextParagraph)
    return true
  }

  if (isRangeAtEnd(paragraph, range)) {
    const nextParagraph = createEmptyParagraph(paragraph.ownerDocument)
    paragraph.parentNode?.insertBefore(nextParagraph, paragraph.nextSibling)
    placeCaretAtElementStart(nextParagraph)
    return true
  }

  splitElementAtRange(paragraph, range, 'p')
  return true
}

function splitActiveBlockquoteParagraph(article: HTMLElement, range: Range): boolean {
  const paragraph = getClosestElementWithin(article, range.startContainer, 'p')
  if (!paragraph) {
    return false
  }
  if (paragraph.parentElement?.tagName !== 'BLOCKQUOTE') {
    return false
  }

  if (normalizeText(paragraph.textContent || '').trim().length === 0) {
    const blockquote = paragraph.parentElement
    if (!(blockquote instanceof HTMLElement) || blockquote.tagName !== 'BLOCKQUOTE') {
      return false
    }

    const nextParagraph = paragraph.ownerDocument.createElement('p')
    nextParagraph.appendChild(createPlaceholder(paragraph.ownerDocument))
    blockquote.parentNode?.insertBefore(nextParagraph, blockquote.nextSibling)
    paragraph.remove()
    if (!blockquote.children.length) {
      blockquote.remove()
    }
    placeCaretAtElementStart(nextParagraph)
    return true
  }

  if (isRangeAtStart(paragraph, range)) {
    const nextParagraph = createEmptyParagraph(paragraph.ownerDocument)
    paragraph.parentNode?.insertBefore(nextParagraph, paragraph)
    placeCaretAtElementStart(nextParagraph)
    return true
  }

  if (isRangeAtEnd(paragraph, range)) {
    const nextParagraph = createEmptyParagraph(paragraph.ownerDocument)
    paragraph.parentNode?.insertBefore(nextParagraph, paragraph.nextSibling)
    placeCaretAtElementStart(nextParagraph)
    return true
  }

  splitElementAtRange(paragraph, range, 'p')
  return true
}

export function handleEnterForVisualBlock(article: HTMLElement, event: KeyboardEvent): boolean {
  if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
    return false
  }

  const range = getSelectionRangeWithin(article)
  if (!range) {
    return false
  }

  if (getClosestElementWithin(article, range.startContainer, 'li')) {
    return splitActiveListItem(article, range)
  }

  const quoteParagraph = getClosestElementWithin(article, range.startContainer, 'p')
  if (quoteParagraph?.parentElement?.tagName === 'BLOCKQUOTE') {
    return splitActiveBlockquoteParagraph(article, range)
  }

  if (getClosestElementWithin(article, range.startContainer, 'h1, h2, h3, h4, h5, h6')) {
    return splitActiveHeading(article, range)
  }

  if (getClosestElementWithin(article, range.startContainer, 'p')) {
    if (applyThematicBreakShortcut(article)) {
      return true
    }
    return splitActiveParagraph(article, range)
  }

  return false
}

export function handleBackspaceForVisualBlock(article: HTMLElement): boolean {
  const range = getSelectionRangeWithin(article)
  if (!range || !range.collapsed) {
    return false
  }

  const heading = getClosestElementWithin(article, range.startContainer, 'h1, h2, h3, h4, h5, h6')
  if (heading && isRangeAtStart(heading, range)) {
    const paragraph = replaceElementTag(heading, 'p')
    placeCaretAtElementStart(paragraph)
    return true
  }

  const listItem = getClosestElementWithin(article, range.startContainer, 'li')
  if (listItem && isRangeAtStart(listItem, range)) {
    if (isNestedListItem(listItem)) {
      return outdentListItem(listItem)
    }

    const previousItem = getPreviousElementSibling(listItem)
    if (previousItem && previousItem.tagName === 'LI') {
      mergeListItems(previousItem, listItem)
      return true
    }

    return unwrapListItemToParagraph(listItem)
  }

  const paragraph = getClosestElementWithin(article, range.startContainer, 'p')
  if (paragraph && paragraph.parentElement?.tagName === 'BLOCKQUOTE' && isRangeAtStart(paragraph, range)) {
    return unwrapBlockquoteParagraph(paragraph)
  }

  if (paragraph && isRangeAtStart(paragraph, range)) {
    return mergeParagraphWithPrevious(paragraph)
  }

  return false
}

export function handleTabForVisualBlock(article: HTMLElement, event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return false
  }

  const range = getSelectionRangeWithin(article)
  if (!range) {
    return false
  }

  const listItem = getClosestElementWithin(article, range.startContainer, 'li')
  if (!listItem) {
    return false
  }

  return event.shiftKey ? outdentListItem(listItem) : indentListItem(listItem)
}
