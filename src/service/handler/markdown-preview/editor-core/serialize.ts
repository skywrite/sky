import type {
  BlockquoteNode,
  DefinitionClusterNode,
  EditorBlockNode,
  EditorDocument,
  EditorInlineNode,
  FenceNode,
  FrontmatterNode,
  HrNode,
  ListItemNode,
  ListNode,
} from './model.ts'

export interface SerializeEditorDocumentOptions {
  preserveSourceRaw?: boolean
}

export function serializeEditorDocument(
  document: EditorDocument,
  options: SerializeEditorDocumentOptions = {},
): string {
  return document.nodes.map((node) => serializeEditorBlockNode(node, options)).join('')
}

export function serializeEditorBlockNode(node: EditorBlockNode, options: SerializeEditorDocumentOptions = {}): string {
  if (shouldUseRawNode(node, options)) {
    return node.raw
  }

  switch (node.type) {
    case 'frontmatter':
      return serializeFrontmatter(node)
    case 'paragraph':
      return `${serializeInlineNodes(node.inlines, options)}\n\n`
    case 'heading':
      return serializeHeadingNode(node, options)
    case 'blockquote':
      return serializeBlockquoteNode(node, options)
    case 'list':
      return serializeListNode(node, options)
    case 'list_item':
      return serializeListItemNode(node, options, node.preservation.pattern ?? '-')
    case 'fence':
      return serializeFenceNode(node)
    case 'html_block':
      return ensureBlockSpacing(node.raw)
    case 'table':
      return ensureBlockSpacing(node.raw || '|  |\n| --- |\n|  |\n')
    case 'hr':
      return serializeHrNode(node)
    case 'definition_cluster':
      return serializeDefinitionClusterNode(node)
    case 'raw_region':
      return node.raw
  }
}

export function serializeInlineNodes(nodes: EditorInlineNode[], options: SerializeEditorDocumentOptions = {}): string {
  return nodes.map((node) => serializeInlineNode(node, options)).join('')
}

function serializeInlineNode(node: EditorInlineNode, options: SerializeEditorDocumentOptions): string {
  if (shouldUseRawInline(node, options)) {
    return node.raw
  }

  switch (node.type) {
    case 'text':
      return node.text
    case 'code_span': {
      const ticks = node.preservation.pattern && node.preservation.pattern.length > 0 ? node.preservation.pattern : '`'
      return `${ticks}${node.text}${ticks}`
    }
    case 'strong': {
      const marker = normalizeInlineMarker(node.preservation.pattern, '**')
      return `${marker}${serializeInlineNodes(node.children, options)}${marker}`
    }
    case 'em': {
      const marker = normalizeInlineMarker(node.preservation.pattern, '*')
      return `${marker}${serializeInlineNodes(node.children, options)}${marker}`
    }
    case 'delete':
      return `~~${serializeInlineNodes(node.children, options)}~~`
    case 'image': {
      const titlePart = node.title ? ` "${node.title}"` : ''
      return `![${node.alt}](${node.href}${titlePart})`
    }
    case 'html_inline':
      return node.text
    case 'link': {
      const text = serializeInlineNodes(node.children, options)
      if (node.linkKind === 'collapsed-reference') {
        return `[${text}][]`
      }
      if (node.linkKind === 'reference') {
        const label = node.referenceLabel && node.referenceLabel.length > 0 ? node.referenceLabel : text
        return `[${text}][${label}]`
      }
      if (node.linkKind === 'shortcut-reference') {
        return `[${text}]`
      }
      const titlePart = node.title ? ` "${node.title}"` : ''
      return `[${text}](${node.href}${titlePart})`
    }
  }
}

function serializeFrontmatter(node: FrontmatterNode): string {
  const delimiter = node.delimiter ?? '---'
  const body = node.body.length > 0 ? `${node.body}\n` : ''
  return `${delimiter}\n${body}${delimiter}\n`
}

function serializeHeadingNode(
  node: EditorBlockNode & { type: 'heading' },
  options: SerializeEditorDocumentOptions,
): string {
  const headingText = serializeInlineNodes(node.inlines, options)
  const pattern = node.preservation.pattern ?? '#'

  if (pattern === '=' || pattern === '-') {
    const underlineChar = pattern
    const width = Math.max(3, headingText.length)
    return `${headingText}\n${underlineChar.repeat(width)}\n\n`
  }

  const marker = /^#{1,6}$/.test(pattern) ? pattern : '#'.repeat(Math.max(1, Math.min(6, node.depth)))
  return `${marker} ${headingText}\n\n`
}

function serializeBlockquoteNode(node: BlockquoteNode, options: SerializeEditorDocumentOptions): string {
  const inner = node.blocks
    .map((block) =>
      serializeEditorBlockNode(block, {
        ...options,
        preserveSourceRaw: false,
      }),
    )
    .join('')
  const trimmedInner = inner.replace(/\n+$/, '')

  const quotedLines =
    trimmedInner.length === 0 ? ['>'] : trimmedInner.split('\n').map((line) => (line.length === 0 ? '>' : `> ${line}`))

  return `${quotedLines.join('\n')}\n\n`
}

function serializeListNode(node: ListNode, options: SerializeEditorDocumentOptions): string {
  let orderedIndex = Number.parseInt(node.start, 10)
  if (!Number.isFinite(orderedIndex) || orderedIndex < 1) {
    orderedIndex = 1
  }

  const items = node.items.map((item) => {
    const defaultMarker = node.ordered ? `${orderedIndex++}.` : '-'
    const marker =
      item.preservation.pattern && item.preservation.pattern.length > 0 ? item.preservation.pattern : defaultMarker
    return serializeListItemNode(item, options, marker).replace(/\n$/, '')
  })

  return `${items.join('\n')}\n\n`
}

function serializeListItemNode(node: ListItemNode, options: SerializeEditorDocumentOptions, marker: string): string {
  const inlineText = serializeInlineNodes(node.inlines, options)
  const checkbox = node.checked === null ? '' : node.checked ? '[x] ' : '[ ] '
  const firstLine = `${marker} ${checkbox}${inlineText}`.trimEnd()

  if (node.blocks.length === 0) {
    return `${firstLine}\n`
  }

  const nested = node.blocks
    .map((block) =>
      serializeEditorBlockNode(block, {
        ...options,
        preserveSourceRaw: false,
      }),
    )
    .join('')
    .replace(/\n+$/, '')
  const nestedIndented = nested
    .split('\n')
    .map((line) => (line.length === 0 ? '' : `  ${line}`))
    .join('\n')

  return `${firstLine}\n${nestedIndented}\n`
}

function serializeFenceNode(node: FenceNode): string {
  const pattern = node.preservation.pattern && node.preservation.pattern.length >= 3 ? node.preservation.pattern : '```'
  const lang = node.lang.length > 0 ? node.lang : ''
  const fenceOpen = `${pattern}${lang}`
  const body = node.text.endsWith('\n') ? node.text : `${node.text}\n`
  return `${fenceOpen}\n${body}${pattern}\n\n`
}

function serializeHrNode(node: HrNode): string {
  const pattern =
    node.preservation.pattern && node.preservation.pattern.trim().length > 0 ? node.preservation.pattern.trim() : '---'
  return `${pattern}\n\n`
}

function serializeDefinitionClusterNode(node: DefinitionClusterNode): string {
  const lines = node.entries.map((entry) => {
    if (entry.type === 'reference') {
      const titlePart = entry.title ? ` "${entry.title}"` : ''
      return `[${entry.label}]: ${entry.href}${titlePart}`
    }

    const bodyLines = entry.body.split('\n')
    const firstLine = bodyLines.shift() ?? ''
    const continuationLines = bodyLines.map((line) => `  ${line}`)
    return [`[^${entry.label}]: ${firstLine}`, ...continuationLines].join('\n')
  })

  return `${lines.join('\n')}\n`
}

function normalizeInlineMarker(pattern: string | undefined, fallback: string): string {
  if (pattern && pattern.length > 0) {
    return pattern
  }
  return fallback
}

function shouldUseRawNode(node: EditorBlockNode, options: SerializeEditorDocumentOptions): boolean {
  if (options.preserveSourceRaw === false) {
    return false
  }

  if (node.raw.length === 0) {
    return false
  }

  return Boolean(node.source || node.sourceBlockCid || node.type === 'raw_region' || node.type === 'frontmatter')
}

function shouldUseRawInline(node: EditorInlineNode, options: SerializeEditorDocumentOptions): boolean {
  if (options.preserveSourceRaw === false) {
    return false
  }
  return node.raw.length > 0
}

function ensureBlockSpacing(raw: string): string {
  if (raw.endsWith('\n\n')) {
    return raw
  }
  if (raw.endsWith('\n')) {
    return `${raw}\n`
  }
  return `${raw}\n\n`
}
