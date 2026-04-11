import type {
  BlockquoteNode,
  CodeSpanInlineNode,
  DeleteInlineNode,
  EditorBlockNode,
  EditorInlineNode,
  EmInlineNode,
  HeadingNode,
  ImageInlineNode,
  InlineHtmlNode,
  LinkInlineNode,
  ListItemNode,
  ListNode,
  ParagraphNode,
  StrongInlineNode,
  TextInlineNode,
} from './model.ts'

export interface BlockCursorMaps {
  cursorMap?: number[]
  listItemCursorMaps?: number[][]
}

export function buildBlockCursorMaps(node: EditorBlockNode): BlockCursorMaps {
  switch (node.type) {
    case 'paragraph':
      return {
        cursorMap: buildParagraphCursorMap(node),
      }
    case 'heading':
      return {
        cursorMap: buildHeadingCursorMap(node),
      }
    case 'blockquote':
      return {
        cursorMap: buildBlockquoteCursorMap(node),
      }
    case 'list':
      return {
        listItemCursorMaps: buildListItemCursorMaps(node),
      }
    default:
      return {}
  }
}

function buildParagraphCursorMap(node: ParagraphNode): number[] {
  return buildInlineBlockCursorMap(node.raw, 0, node.inlines)
}

function buildHeadingCursorMap(node: HeadingNode): number[] {
  const prefixLength = node.raw.match(/^(\s*#{1,6}\s+)/)?.[0].length ?? 0
  return buildInlineBlockCursorMap(node.raw, prefixLength, node.inlines)
}

function buildBlockquoteCursorMap(node: BlockquoteNode): number[] | undefined {
  const firstParagraph = node.blocks.find((block): block is ParagraphNode => block.type === 'paragraph')
  if (!firstParagraph) {
    return undefined
  }

  const prefixLength = node.raw.match(/^(\s*>+\s*)/)?.[0].length ?? 0
  return buildInlineBlockCursorMap(node.raw, prefixLength, firstParagraph.inlines)
}

function buildListItemCursorMaps(node: ListNode): number[][] {
  return buildNestedListItemCursorMaps(node.raw, node.items)
}

function buildListItemCursorMap(item: ListItemNode): number[] {
  const prefixLength = item.raw.match(/^(\s*(?:[-+*]|\d+[.)])(?:\s+\[[ xX]\])?\s+)/)?.[0].length ?? 0
  return buildInlineBlockCursorMap(item.raw, prefixLength, item.inlines)
}

function buildNestedListItemCursorMaps(containerRaw: string, items: ListItemNode[]): number[][] {
  const itemStarts = locateSequentialSegments(
    containerRaw,
    items.map((item) => item.raw),
  )
  const cursorMaps: number[][] = []

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!
    const itemStart = itemStarts[index] ?? 0
    const itemMap = buildListItemCursorMap(item).map((offset) => offset + itemStart)
    cursorMaps.push(itemMap)

    const nestedLists = item.blocks.filter((block): block is ListNode => block.type === 'list')
    if (nestedLists.length === 0) {
      continue
    }

    const nestedStarts = locateSequentialSegments(
      item.raw,
      nestedLists.map((list) => list.raw),
    )
    for (let nestedIndex = 0; nestedIndex < nestedLists.length; nestedIndex += 1) {
      const nestedList = nestedLists[nestedIndex]!
      const nestedStart = nestedStarts[nestedIndex] ?? 0
      const nestedMaps = buildNestedListItemCursorMaps(nestedList.raw, nestedList.items)
      for (const nestedMap of nestedMaps) {
        cursorMaps.push(nestedMap.map((offset) => offset + itemStart + nestedStart))
      }
    }
  }

  return cursorMaps
}

function buildInlineBlockCursorMap(raw: string, prefixLength: number, inlines: EditorInlineNode[]): number[] {
  const inlineMap = buildInlineCursorMap(inlines)
  return inlineMap.map((offset) => prefixLength + offset)
}

function buildInlineCursorMap(inlines: EditorInlineNode[]): number[] {
  const cursorMap = [0]
  let visibleOffset = 0
  let rawOffset = 0

  for (const inline of inlines) {
    const inlineMap = buildInlineNodeCursorMap(inline)
    if (cursorMap[visibleOffset] == null || inlineMap[0]! > 0) {
      cursorMap[visibleOffset] = rawOffset + inlineMap[0]!
    }
    for (let index = 1; index < inlineMap.length; index += 1) {
      cursorMap[visibleOffset + index] = rawOffset + inlineMap[index]!
    }
    visibleOffset += inlineMap.length - 1
    rawOffset += inline.raw.length
  }

  return cursorMap
}

function buildInlineNodeCursorMap(inline: EditorInlineNode): number[] {
  switch (inline.type) {
    case 'text':
      return buildLiteralTextCursorMap(inline)
    case 'code_span':
      return buildCodeSpanCursorMap(inline)
    case 'strong':
      return buildWrappedCursorMap(inline, inline.preservation.pattern ?? '**')
    case 'em':
      return buildWrappedCursorMap(inline, inline.preservation.pattern ?? '*')
    case 'delete':
      return buildWrappedCursorMap(inline, '~~')
    case 'link':
      return buildLinkCursorMap(inline)
    case 'image':
      return buildImageCursorMap(inline)
    case 'html_inline':
      return buildLiteralCursorMap(inline.raw, inline.text)
  }
}

function buildLiteralTextCursorMap(inline: TextInlineNode): number[] {
  return buildLiteralCursorMap(inline.raw, inline.text)
}

function buildCodeSpanCursorMap(inline: CodeSpanInlineNode): number[] {
  const marker = inline.preservation.pattern ?? inline.raw.match(/^(`+)/)?.[0] ?? '`'
  return buildPlainTextOffsetMap(inline.text, marker.length)
}

function buildWrappedCursorMap(inline: StrongInlineNode | EmInlineNode | DeleteInlineNode, marker: string): number[] {
  const childMap = buildInlineCursorMap(inline.children)
  return childMap.map((offset) => marker.length + offset)
}

function buildLinkCursorMap(inline: LinkInlineNode): number[] {
  const childMap = buildInlineCursorMap(inline.children)
  return childMap.map((offset) => 1 + offset)
}

function buildImageCursorMap(inline: ImageInlineNode): number[] {
  return buildPlainTextOffsetMap(inline.alt, 2)
}

function buildPlainTextOffsetMap(text: string, rawPrefixLength: number): number[] {
  const cursorMap = new Array<number>(text.length + 1)
  cursorMap[0] = rawPrefixLength

  for (let index = 1; index < cursorMap.length; index += 1) {
    cursorMap[index] = rawPrefixLength + index
  }

  return cursorMap
}

function buildLiteralCursorMap(raw: string, text: string): number[] {
  const cursorMap = [0]
  let rawIndex = 0

  for (let textIndex = 0; textIndex < text.length; textIndex += 1) {
    if (rawIndex >= raw.length) {
      cursorMap.push(raw.length)
      continue
    }

    if (raw[rawIndex] === '\\' && rawIndex + 1 < raw.length) {
      rawIndex += 1
    }

    rawIndex += 1
    cursorMap.push(rawIndex)
  }

  return cursorMap
}

function locateSequentialSegments(source: string, segments: string[]): number[] {
  const starts: number[] = []
  let searchFrom = 0

  for (const segment of segments) {
    const start = source.indexOf(segment, searchFrom)
    starts.push(start >= 0 ? start : searchFrom)
    if (start >= 0) {
      searchFrom = start + segment.length
    }
  }

  return starts
}
