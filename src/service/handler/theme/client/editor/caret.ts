import type { EditableBlock } from './types.ts'

/**
 * Where a click lands. A click on the rendering names a text offset; these turn it into an
 * offset in the block's markdown (through the cursor maps the server built, or by walking the
 * source) and put the caret at the point in a block being edited in place.
 */

/** Where a click landed: the point, and the text offset it names inside the block (and which list item). */
export interface ClickContext {
  clientX: number
  clientY: number
  textOffset?: number
  listItemIndex?: number
}

function preferredCursorOffset(raw: string): number {
  const trimmedLength = raw.replace(/[\s\u00a0]+$/u, '').length
  return trimmedLength > 0 ? trimmedLength : 0
}

function findVisibleTextCursorOffset(raw: string, textOffset: number, blockPrefixPattern: RegExp | null): number {
  const lines = raw.split('\n')
  let remaining = textOffset
  let offset = 0

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const prefixMatch = blockPrefixPattern ? line.match(blockPrefixPattern) : null
    const prefixLength = prefixMatch ? prefixMatch[0].length : 0
    const visibleLength = Math.max(line.length - prefixLength, 0)

    if (remaining <= visibleLength) {
      return offset + prefixLength + remaining
    }

    remaining -= visibleLength
    offset += line.length
    if (lineIndex < lines.length - 1) {
      offset += 1
    }
  }

  return preferredCursorOffset(raw)
}

function findHeadingCursorOffset(raw: string, textOffset: number): number {
  const firstLine = raw.split('\n')[0] || ''
  const prefixMatch = firstLine.match(/^(\s*#{1,6}\s+)/)
  const prefixLength = prefixMatch ? prefixMatch[0].length : 0
  return prefixLength + Math.min(textOffset, Math.max(firstLine.length - prefixLength, 0))
}

function findListItemCursorOffset(raw: string, listItemIndex: number, textOffset: number): number {
  const lines = raw.split('\n')
  let currentIndex = 0
  let offset = 0

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const markerMatch = line.match(/^(\s*)(?:[-+*]|\d+[.)])(?:\s+\[[ xX]\])?\s+/)
    if (markerMatch) {
      if (currentIndex === listItemIndex) {
        const markerLength = markerMatch[0].length
        const visibleLength = Math.max(line.length - markerLength, 0)
        return offset + markerLength + Math.min(textOffset, visibleLength)
      }
      currentIndex += 1
    }

    offset += line.length
    if (lineIndex < lines.length - 1) {
      offset += 1
    }
  }

  return preferredCursorOffset(raw)
}

export function resolveCursorOffset(block: EditableBlock, clickContext: ClickContext | null) {
  function resolveMappedOffset(cursorMap: number[] | undefined, visibleOffset: number): number | null {
    if (!Array.isArray(cursorMap) || cursorMap.length === 0) {
      return null
    }

    const clampedOffset = Math.max(0, Math.min(visibleOffset, cursorMap.length - 1))
    return cursorMap[clampedOffset]
  }

  if (clickContext && typeof clickContext.listItemIndex === 'number' && block.type === 'list') {
    const mappedOffset = resolveMappedOffset(
      block.listItemCursorMaps && block.listItemCursorMaps[clickContext.listItemIndex],
      clickContext.textOffset || 0,
    )
    if (typeof mappedOffset === 'number') {
      return mappedOffset
    }
    return findListItemCursorOffset(block.raw, clickContext.listItemIndex, clickContext.textOffset || 0)
  }

  if (clickContext && typeof clickContext.textOffset === 'number') {
    const mappedOffset = resolveMappedOffset(block.cursorMap, clickContext.textOffset)
    if (typeof mappedOffset === 'number') {
      return mappedOffset
    }

    switch (block.type) {
      case 'heading':
        return findHeadingCursorOffset(block.raw, clickContext.textOffset)
      case 'paragraph':
        return findVisibleTextCursorOffset(block.raw, clickContext.textOffset, null)
      case 'blockquote':
        return findVisibleTextCursorOffset(block.raw, clickContext.textOffset, /^(\s*>+\s*)/)
    }
  }

  return preferredCursorOffset(block.raw)
}

function getPointRange(documentRef: Document, clientX: number, clientY: number): Range | null {
  if (typeof documentRef.caretPositionFromPoint === 'function') {
    const caretPosition = documentRef.caretPositionFromPoint(clientX, clientY)
    if (caretPosition) {
      const range = documentRef.createRange()
      range.setStart(caretPosition.offsetNode, caretPosition.offset)
      range.collapse(true)
      return range
    }
  }

  if (typeof documentRef.caretRangeFromPoint === 'function') {
    const range = documentRef.caretRangeFromPoint(clientX, clientY)
    if (range) {
      range.collapse(true)
      return range
    }
  }

  return null
}

function getTextOffsetWithinElement(element: Element, event: MouseEvent): number | null {
  const documentRef = element.ownerDocument
  const pointRange = getPointRange(documentRef, event.clientX, event.clientY)
  if (!pointRange || !element.contains(pointRange.startContainer)) {
    return null
  }

  const prefixRange = documentRef.createRange()
  prefixRange.selectNodeContents(element)
  prefixRange.setEnd(pointRange.startContainer, pointRange.startOffset)
  return prefixRange.toString().length
}

export function resolveClickContext(preview: HTMLElement, event: MouseEvent): ClickContext | null {
  const target = event.target
  if (!(target instanceof Node)) {
    return null
  }

  const previewArticle = preview.querySelector('.editable-block-preview')
  if (!(previewArticle instanceof Element)) {
    return null
  }

  const targetElement = target instanceof Element ? target : target.parentElement
  if (!targetElement) {
    return null
  }

  const textContainer = targetElement.closest('li, p, h1, h2, h3, h4, h5, h6')
  const textOffset =
    textContainer && previewArticle.contains(textContainer) ? getTextOffsetWithinElement(textContainer, event) : null

  const listItem = targetElement.closest('li')
  if (listItem && previewArticle.contains(listItem)) {
    const items = Array.from(previewArticle.querySelectorAll('li'))
    const listItemIndex = items.indexOf(listItem)
    if (listItemIndex >= 0) {
      return {
        clientX: event.clientX,
        clientY: event.clientY,
        listItemIndex,
        textOffset: textOffset ?? 0,
      }
    }
  }

  if (typeof textOffset === 'number') {
    return {
      clientX: event.clientX,
      clientY: event.clientY,
      textOffset,
    }
  }

  return null
}

export function placeCaretAtPoint(article: HTMLElement, clickContext: ClickContext | null) {
  if (!clickContext || typeof clickContext.clientX !== 'number' || typeof clickContext.clientY !== 'number') {
    return false
  }

  const range = getPointRange(article.ownerDocument, clickContext.clientX, clickContext.clientY)
  if (!range || !article.contains(range.startContainer)) {
    return false
  }

  const selection = article.ownerDocument.getSelection()
  if (!selection) {
    return false
  }

  selection.removeAllRanges()
  selection.addRange(range)
  return true
}
