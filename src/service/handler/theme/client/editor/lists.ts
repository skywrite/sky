import {
  clearNode,
  createPlaceholder,
  getClosestElementWithin,
  getPreviousElementSibling,
  hasMeaningfulChildNodes,
  isRangeAtEnd,
  isRangeAtStart,
  placeCaretAtElementEnd,
  placeCaretAtElementStart,
  removePlaceholderIfNeeded,
  setElementFromFragment,
} from './dom.ts'
import { normalizeText } from './text.ts'

/**
 * List items: checkboxes, nesting, merging, indent and outdent, and Enter inside a list.
 * Each command returns whether it changed the DOM; the caller marks the document dirty.
 */

export function createEmptyListItem(documentRef: Document, checked?: boolean) {
  const listItem = documentRef.createElement('li')
  if (typeof checked === 'boolean') {
    const checkbox = documentRef.createElement('input')
    checkbox.setAttribute('type', 'checkbox')
    checkbox.checked = checked
    if (checked) {
      checkbox.setAttribute('checked', '')
    }
    listItem.appendChild(checkbox)
    listItem.appendChild(documentRef.createTextNode(' '))
  }
  listItem.appendChild(createPlaceholder(documentRef))
  return listItem
}

function createContinuationListItem(sourceListItem: HTMLElement): HTMLLIElement {
  const checkbox = getDirectCheckboxInput(sourceListItem)
  return createEmptyListItem(sourceListItem.ownerDocument, checkbox ? false : undefined)
}

function createParagraphFromListItem(listItem: HTMLElement): HTMLParagraphElement {
  const paragraph = listItem.ownerDocument.createElement('p')
  const childNodes = Array.from(listItem.childNodes)

  childNodes.forEach((node) => {
    if (node instanceof HTMLInputElement && node.getAttribute('type') === 'checkbox') {
      return
    }

    if (node instanceof HTMLElement && (node.tagName === 'UL' || node.tagName === 'OL')) {
      return
    }

    paragraph.appendChild(node)
  })

  if (!hasMeaningfulChildNodes(paragraph)) {
    paragraph.appendChild(createPlaceholder(listItem.ownerDocument))
  }

  return paragraph
}

function getDirectCheckboxInput(li: Element): HTMLInputElement | null {
  const candidate = li.firstElementChild
  if (candidate instanceof HTMLInputElement && candidate.getAttribute('type') === 'checkbox') {
    return candidate
  }

  return null
}

function cloneCheckboxInput(checkbox: HTMLInputElement, checked: boolean): HTMLInputElement {
  const clone = checkbox.cloneNode(true) as HTMLInputElement
  clone.checked = checked
  if (checked) {
    clone.setAttribute('checked', '')
  } else {
    clone.removeAttribute('checked')
  }
  return clone
}

function setListItemFromFragment(
  element: HTMLElement,
  fragment: DocumentFragment,
  checkboxTemplate: HTMLInputElement | null,
) {
  clearNode(element)
  if (checkboxTemplate) {
    element.appendChild(cloneCheckboxInput(checkboxTemplate, false))
    element.appendChild(element.ownerDocument.createTextNode(' '))
  }

  if (hasMeaningfulChildNodes(fragment)) {
    element.appendChild(fragment)
    return
  }

  element.appendChild(createPlaceholder(element.ownerDocument))
}

function getListItemInlineText(li: HTMLElement): string {
  const clone = li.cloneNode(true)
  Array.from(clone.childNodes).forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      return
    }

    if (node.tagName === 'INPUT' && node.getAttribute('type') === 'checkbox') {
      node.remove()
      return
    }

    if (node.tagName === 'UL' || node.tagName === 'OL') {
      node.remove()
    }
  })

  return normalizeText(clone.textContent || '').trim()
}

function hasDirectNestedList(li: Element) {
  return Array.from(li.children).some((child) => child.tagName === 'UL' || child.tagName === 'OL')
}

function getListItemInsertionPoint(li: Element): Element | null {
  return Array.from(li.children).find((child) => child.tagName === 'UL' || child.tagName === 'OL') || null
}

function insertNodeIntoListItem(li: Element, node: Node) {
  const nestedList = getListItemInsertionPoint(li)
  if (nestedList) {
    li.insertBefore(node, nestedList)
    return
  }

  li.appendChild(node)
}

export function getDeepestLastListItem(list: Element | null): HTMLElement | null {
  if (!(list instanceof HTMLElement) || (list.tagName !== 'UL' && list.tagName !== 'OL')) {
    return null
  }

  let currentList = list
  let lastItem = Array.from(currentList.children)
    .filter((child) => child.tagName === 'LI')
    .at(-1)

  while (lastItem instanceof HTMLElement) {
    const nestedList = Array.from(lastItem.children)
      .filter((child) => child.tagName === 'UL' || child.tagName === 'OL')
      .at(-1)

    if (!(nestedList instanceof HTMLElement)) {
      return lastItem
    }

    currentList = nestedList
    lastItem = Array.from(currentList.children)
      .filter((child) => child.tagName === 'LI')
      .at(-1)
  }

  return null
}

export function mergeParagraphIntoListItem(listItem: HTMLElement, paragraph: HTMLElement) {
  removePlaceholderIfNeeded(listItem)
  const movingNodes = Array.from(paragraph.childNodes)
  for (const node of movingNodes) {
    insertNodeIntoListItem(listItem, node)
  }
  paragraph.remove()
  placeCaretAtElementEnd(listItem)
  return true
}

export function mergeListItems(target: HTMLElement, source: HTMLElement) {
  removePlaceholderIfNeeded(target)

  const movingNodes = Array.from(source.childNodes)
  for (const node of movingNodes) {
    if (node instanceof HTMLInputElement && node.getAttribute('type') === 'checkbox') {
      continue
    }
    insertNodeIntoListItem(target, node)
  }

  source.remove()
  placeCaretAtElementEnd(target)
}

function ensureNestedList(parentItem: HTMLElement, tagName: string): HTMLElement {
  const existing = Array.from(parentItem.children).find((child) => child.tagName === tagName)
  if (existing instanceof HTMLElement) {
    return existing
  }

  const nestedList = parentItem.ownerDocument.createElement(tagName.toLowerCase())
  parentItem.appendChild(nestedList)
  return nestedList
}

export function unwrapListItemToParagraph(listItem: HTMLElement) {
  const list = listItem.parentElement
  if (!(list instanceof HTMLElement) || (list.tagName !== 'UL' && list.tagName !== 'OL')) {
    return false
  }

  const nestedLists = Array.from(listItem.children).filter((child) => child.tagName === 'UL' || child.tagName === 'OL')
  const insertionPoint = listItem.nextSibling
  nestedLists.forEach((nestedList) => {
    Array.from(nestedList.children)
      .filter((child) => child.tagName === 'LI')
      .forEach((childItem) => {
        list.insertBefore(childItem, insertionPoint)
      })
    nestedList.remove()
  })

  const paragraph = createParagraphFromListItem(listItem)
  list.parentNode?.insertBefore(paragraph, list)
  listItem.remove()

  if (list.children.length === 0) {
    list.remove()
  }

  placeCaretAtElementStart(paragraph)
  return true
}

export function isNestedListItem(listItem: Element): boolean {
  const list = listItem.parentElement
  if (!(list instanceof HTMLElement) || (list.tagName !== 'UL' && list.tagName !== 'OL')) {
    return false
  }

  return list.parentElement instanceof HTMLElement && list.parentElement.tagName === 'LI'
}

export function indentListItem(listItem: HTMLElement): boolean {
  const list = listItem.parentElement
  if (!list || (list.tagName !== 'UL' && list.tagName !== 'OL')) {
    return false
  }

  const previousItem = getPreviousElementSibling(listItem)
  if (!previousItem || previousItem.tagName !== 'LI') {
    return false
  }

  const nestedList = ensureNestedList(previousItem, list.tagName)
  nestedList.appendChild(listItem)
  placeCaretAtElementStart(listItem)
  return true
}

export function outdentListItem(listItem: HTMLElement): boolean {
  const list = listItem.parentElement
  if (!list || (list.tagName !== 'UL' && list.tagName !== 'OL')) {
    return false
  }

  const parentItem = list.parentElement
  const parentList = parentItem?.parentElement
  if (!(parentItem instanceof HTMLElement) || parentItem.tagName !== 'LI') {
    return false
  }
  if (!(parentList instanceof HTMLElement) || (parentList.tagName !== 'UL' && parentList.tagName !== 'OL')) {
    return false
  }

  parentList.insertBefore(listItem, parentItem.nextSibling)
  if (list.children.length === 0) {
    list.remove()
  }
  placeCaretAtElementStart(listItem)
  return true
}

export function splitActiveListItem(article: HTMLElement, range: Range): boolean {
  const listItem = getClosestElementWithin(article, range.startContainer, 'li')
  if (!listItem) {
    return false
  }

  if (getListItemInlineText(listItem).length === 0 && !hasDirectNestedList(listItem)) {
    const list = listItem.parentElement
    if (!list) {
      return false
    }

    const paragraph = list.ownerDocument.createElement('p')
    paragraph.appendChild(createPlaceholder(list.ownerDocument))
    listItem.remove()

    if (list.children.length === 0) {
      list.replaceWith(paragraph)
    } else {
      list.parentNode?.insertBefore(paragraph, list.nextSibling)
    }

    placeCaretAtElementStart(paragraph)
    return true
  }

  if (isRangeAtStart(listItem, range)) {
    const previousItem = createContinuationListItem(listItem)
    listItem.parentNode?.insertBefore(previousItem, listItem)
    placeCaretAtElementStart(previousItem)
    return true
  }

  if (isRangeAtEnd(listItem, range)) {
    const nextItem = createContinuationListItem(listItem)
    listItem.parentNode?.insertBefore(nextItem, listItem.nextSibling)
    placeCaretAtElementStart(nextItem)
    return true
  }

  const doc = listItem.ownerDocument
  const beforeRange = doc.createRange()
  beforeRange.selectNodeContents(listItem)
  beforeRange.setEnd(range.startContainer, range.startOffset)

  const afterRange = doc.createRange()
  afterRange.selectNodeContents(listItem)
  afterRange.setStart(range.endContainer, range.endOffset)

  const beforeFragment = beforeRange.cloneContents()
  const afterFragment = afterRange.cloneContents()
  const checkbox = getDirectCheckboxInput(listItem)

  setElementFromFragment(listItem, beforeFragment)

  const nextItem = doc.createElement('li')
  setListItemFromFragment(nextItem, afterFragment, checkbox)
  listItem.parentNode?.insertBefore(nextItem, listItem.nextSibling)

  placeCaretAtElementStart(nextItem)
  return true
}
