import * as marked from 'marked'
import type { MarkdownSourceBlock, MarkdownSourceDocument, MarkdownSourceGap } from './types.ts'
import type {
  BlockquoteNode,
  DefinitionClusterNode,
  DeleteInlineNode,
  EditorBlockNode,
  EditorDocument,
  EditorInlineNode,
  EmInlineNode,
  FenceNode,
  FootnoteDefinitionEntry,
  FrontmatterNode,
  HeadingNode,
  HrNode,
  HtmlBlockNode,
  ImageInlineNode,
  InlineHtmlNode,
  LinkInlineNode,
  ListItemNode,
  ListNode,
  ParagraphNode,
  RawRegionNode,
  ReferenceDefinitionEntry,
  StrongInlineNode,
  TableNode,
  TextInlineNode,
} from './model.ts'
import { parseMarkdownSourceDocument } from './sourceDocument.ts'

export function parseEditorDocument(source: string): EditorDocument {
  const sourceDocument = parseMarkdownSourceDocument(source)
  return parseEditorDocumentFromSource(sourceDocument)
}

export function parseEditorDocumentFromSource(sourceDocument: MarkdownSourceDocument): EditorDocument {
  const nodes: EditorBlockNode[] = []

  if (sourceDocument.frontmatterRaw.length > 0) {
    nodes.push(parseFrontmatterNode(sourceDocument.frontmatterRaw))
  }

  for (let index = 0; index < sourceDocument.segments.length; index++) {
    const segment = sourceDocument.segments[index]!

    if (segment.kind === 'gap') {
      const gapNode = parseGapNode(segment, index)
      if (gapNode) {
        nodes.push(gapNode)
      }
      continue
    }

    nodes.push(parseSourceBackedBlock(segment))
  }

  return {
    frontmatter: nodes.find((node): node is FrontmatterNode => node.type === 'frontmatter') ?? null,
    nodes,
    allBlocks: flattenBlocks(nodes),
  }
}

function parseFrontmatterNode(frontmatterRaw: string): FrontmatterNode {
  const lines = frontmatterRaw.split(/\r?\n/)
  const delimiter = lines[0]?.trim() === '= yaml =' ? '= yaml =' : '---'
  const body = lines.slice(1, -2).join('\n')

  return {
    kind: 'block',
    type: 'frontmatter',
    cid: 'frontmatter',
    raw: frontmatterRaw,
    source: {
      startOffset: 0,
      endOffset: frontmatterRaw.length,
    },
    protected: true,
    preservation: { pattern: delimiter },
    delimiter,
    body,
  }
}

function parseGapNode(segment: MarkdownSourceGap, index: number): DefinitionClusterNode | RawRegionNode {
  const definitionEntries = parseDefinitionEntries(segment.raw)
  if (definitionEntries) {
    return {
      kind: 'block',
      type: 'definition_cluster',
      cid: `gap-${index}`,
      raw: segment.raw,
      source: {
        startOffset: segment.startOffset,
        endOffset: segment.endOffset,
      },
      protected: true,
      preservation: {},
      entries: definitionEntries,
    }
  }

  return {
    kind: 'block',
    type: 'raw_region',
    cid: `gap-${index}`,
    raw: segment.raw,
    source: {
      startOffset: segment.startOffset,
      endOffset: segment.endOffset,
    },
    protected: true,
    preservation: {
      pattern: segment.raw.trim().length === 0 ? 'whitespace' : undefined,
    },
  }
}

function parseSourceBackedBlock(segment: MarkdownSourceBlock): EditorBlockNode {
  const token = segment.token as marked.Token

  switch (token.type) {
    case 'paragraph':
      {
        const definitionEntries = parseDefinitionEntries(segment.raw)
        if (definitionEntries) {
          return {
            kind: 'block',
            type: 'definition_cluster',
            cid: segment.cid,
            raw: segment.raw,
            source: sourceRange(segment),
            sourceBlockCid: segment.cid,
            protected: true,
            preservation: {},
            entries: definitionEntries,
          } satisfies DefinitionClusterNode
        }
      }
      if (looksLikeMarkdownTable(segment.raw)) {
        const tableNode: TableNode = {
          kind: 'block',
          type: 'table',
          cid: segment.cid,
          raw: segment.raw,
          source: sourceRange(segment),
          sourceBlockCid: segment.cid,
          protected: true,
          preservation: {},
        }
        return tableNode
      }

      return {
        kind: 'block',
        type: 'paragraph',
        cid: segment.cid,
        raw: segment.raw,
        source: sourceRange(segment),
        sourceBlockCid: segment.cid,
        protected: false,
        preservation: {},
        inlines: parseInlineTokens(token.tokens, segment.cid),
      } satisfies ParagraphNode
    case 'heading':
      return {
        kind: 'block',
        type: 'heading',
        cid: segment.cid,
        raw: segment.raw,
        source: sourceRange(segment),
        sourceBlockCid: segment.cid,
        protected: false,
        preservation: {
          pattern: inferHeadingPattern(segment.raw),
        },
        depth: token.depth,
        inlines: parseInlineTokens(token.tokens, segment.cid),
      } satisfies HeadingNode
    case 'list':
      return parseListNode(segment, token as marked.Tokens.List)
    case 'blockquote':
      return {
        kind: 'block',
        type: 'blockquote',
        cid: segment.cid,
        raw: segment.raw,
        source: sourceRange(segment),
        sourceBlockCid: segment.cid,
        protected: false,
        preservation: {
          pattern: '>',
        },
        blocks: parseNestedBlockTokens(token.tokens, segment.cid),
      } satisfies BlockquoteNode
    case 'code':
      return {
        kind: 'block',
        type: 'fence',
        cid: segment.cid,
        raw: segment.raw,
        source: sourceRange(segment),
        sourceBlockCid: segment.cid,
        protected: true,
        preservation: {
          pattern: inferFencePattern(segment.raw),
        },
        lang: token.lang ?? '',
        text: token.text,
      } satisfies FenceNode
    case 'html':
      return {
        kind: 'block',
        type: 'html_block',
        cid: segment.cid,
        raw: segment.raw,
        source: sourceRange(segment),
        sourceBlockCid: segment.cid,
        protected: true,
        preservation: {},
        htmlKind: segment.raw.trimStart().startsWith('<!--') ? 'comment' : 'html',
      } satisfies HtmlBlockNode
    case 'table':
      return {
        kind: 'block',
        type: 'table',
        cid: segment.cid,
        raw: segment.raw,
        source: sourceRange(segment),
        sourceBlockCid: segment.cid,
        protected: true,
        preservation: {},
      } satisfies TableNode
    case 'hr':
      return {
        kind: 'block',
        type: 'hr',
        cid: segment.cid,
        raw: segment.raw,
        source: sourceRange(segment),
        sourceBlockCid: segment.cid,
        protected: false,
        preservation: {
          pattern: segment.raw.trim(),
        },
      } satisfies HrNode
    default:
      return {
        kind: 'block',
        type: 'raw_region',
        cid: segment.cid,
        raw: segment.raw,
        source: sourceRange(segment),
        sourceBlockCid: segment.cid,
        protected: true,
        preservation: {},
      } satisfies RawRegionNode
  }
}

function parseListNode(segment: MarkdownSourceBlock, token: marked.Tokens.List): ListNode {
  return {
    kind: 'block',
    type: 'list',
    cid: segment.cid,
    raw: segment.raw,
    source: sourceRange(segment),
    sourceBlockCid: segment.cid,
    protected: false,
    preservation: {
      pattern: inferListPattern(segment.raw),
    },
    ordered: token.ordered,
    start: String(token.start ?? ''),
    loose: token.loose,
    items: token.items.map((item, index) => parseListItemNode(item, `${segment.cid}:item-${index + 1}`)),
  }
}

function parseListItemNode(token: marked.Tokens.ListItem, cid: string): ListItemNode {
  const { inlineTokens, blockTokens } = splitListItemTokens(token.tokens)
  const marker = inferListPattern(token.raw)
  const spacing = extractListSpacing(token.raw)

  return {
    kind: 'block',
    type: 'list_item',
    cid,
    raw: token.raw,
    protected: false,
    preservation: {
      pattern: marker,
      prespace: spacing.prespace,
      markindent: spacing.markindent,
      userIndent: spacing.prespace,
    },
    checked: typeof token.checked === 'boolean' ? token.checked : null,
    loose: token.loose,
    inlines: parseInlineTokens(inlineTokens, cid),
    blocks: parseNestedBlockTokens(blockTokens, cid),
  }
}

function parseNestedBlockTokens(tokens: marked.Token[] | undefined, parentCid: string): EditorBlockNode[] {
  if (!tokens || tokens.length === 0) {
    return []
  }

  const blocks: EditorBlockNode[] = []

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (token.type === 'space') {
      continue
    }

    const sourceBackedBlock: MarkdownSourceBlock = {
      kind: 'block',
      cid: `${parentCid}:block-${index + 1}`,
      tokenType: token.type,
      raw: token.raw,
      startOffset: 0,
      endOffset: token.raw.length,
      token,
      text: 'text' in token && typeof token.text === 'string' ? token.text : undefined,
      depth: token.type === 'heading' ? token.depth : undefined,
      ordered: token.type === 'list' ? token.ordered : undefined,
    }

    blocks.push(parseSourceBackedBlock(sourceBackedBlock))
  }

  return blocks
}

function parseInlineTokens(tokens: marked.Token[] | undefined, parentCid: string): EditorInlineNode[] {
  if (!tokens || tokens.length === 0) {
    return []
  }

  const inlines: EditorInlineNode[] = []

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    const cid = `${parentCid}:inline-${index + 1}`

    if (token.type === 'text' && token.tokens && token.tokens.length > 0) {
      inlines.push(...parseInlineTokens(token.tokens, cid))
      continue
    }

    switch (token.type) {
      case 'text':
        inlines.push({
          kind: 'inline',
          type: 'text',
          cid,
          raw: token.raw,
          protected: false,
          preservation: {},
          text: token.text,
        } satisfies TextInlineNode)
        break
      case 'link':
        inlines.push({
          kind: 'inline',
          type: 'link',
          cid,
          raw: token.raw,
          protected: false,
          preservation: {},
          href: token.href,
          title: token.title ?? null,
          linkKind: inferLinkKind(token.raw),
          referenceLabel: inferReferenceLabel(token.raw),
          children: parseInlineTokens(token.tokens, cid),
        } satisfies LinkInlineNode)
        break
      case 'codespan':
        inlines.push({
          kind: 'inline',
          type: 'code_span',
          cid,
          raw: token.raw,
          protected: false,
          preservation: {
            pattern: inferCodeSpanPattern(token.raw),
          },
          text: token.text,
        })
        break
      case 'strong':
        inlines.push({
          kind: 'inline',
          type: 'strong',
          cid,
          raw: token.raw,
          protected: false,
          preservation: {
            pattern: inferWrappedPattern(token.raw),
          },
          children: parseInlineTokens(token.tokens, cid),
        } satisfies StrongInlineNode)
        break
      case 'em':
        inlines.push({
          kind: 'inline',
          type: 'em',
          cid,
          raw: token.raw,
          protected: false,
          preservation: {
            pattern: inferWrappedPattern(token.raw),
          },
          children: parseInlineTokens(token.tokens, cid),
        } satisfies EmInlineNode)
        break
      case 'del':
        inlines.push({
          kind: 'inline',
          type: 'delete',
          cid,
          raw: token.raw,
          protected: false,
          preservation: {
            pattern: '~~',
          },
          children: parseInlineTokens(token.tokens, cid),
        } satisfies DeleteInlineNode)
        break
      case 'image':
        inlines.push({
          kind: 'inline',
          type: 'image',
          cid,
          raw: token.raw,
          protected: false,
          preservation: {},
          href: token.href,
          title: token.title ?? null,
          alt: token.text,
        } satisfies ImageInlineNode)
        break
      case 'html':
        inlines.push({
          kind: 'inline',
          type: 'html_inline',
          cid,
          raw: token.raw,
          protected: true,
          preservation: {},
          text: token.raw,
        } satisfies InlineHtmlNode)
        break
      case 'br':
        inlines.push({
          kind: 'inline',
          type: 'text',
          cid,
          raw: token.raw,
          protected: false,
          preservation: {},
          text: '\n',
        } satisfies TextInlineNode)
        break
      default:
        inlines.push({
          kind: 'inline',
          type: 'text',
          cid,
          raw: token.raw,
          protected: false,
          preservation: {},
          text: 'text' in token && typeof token.text === 'string' ? token.text : token.raw,
        } satisfies TextInlineNode)
        break
    }
  }

  return inlines
}

function splitListItemTokens(tokens: marked.Token[] | undefined): {
  inlineTokens: marked.Token[]
  blockTokens: marked.Token[]
} {
  if (!tokens || tokens.length === 0) {
    return { inlineTokens: [], blockTokens: [] }
  }

  const inlineTokens: marked.Token[] = []
  const blockTokens: marked.Token[] = []
  const inlineTokenTypes = new Set(['text', 'escape', 'link', 'codespan', 'strong', 'em', 'del', 'image', 'html', 'br'])

  for (const token of tokens) {
    if (inlineTokenTypes.has(token.type)) {
      inlineTokens.push(token)
    } else {
      blockTokens.push(token)
    }
  }

  return { inlineTokens, blockTokens }
}

function parseDefinitionEntries(raw: string): Array<ReferenceDefinitionEntry | FootnoteDefinitionEntry> | null {
  const lines = raw.split(/\r?\n/)
  const entries: Array<ReferenceDefinitionEntry | FootnoteDefinitionEntry> = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]!
    const trimmed = line.trim()

    if (trimmed.length === 0) {
      index++
      continue
    }

    const referenceMatch = /^\[([^\]]+)\]:\s+(\S+)(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*$/.exec(trimmed)
    if (referenceMatch) {
      entries.push({
        type: 'reference',
        label: referenceMatch[1]!,
        href: referenceMatch[2]!,
        title: referenceMatch[3] ?? referenceMatch[4] ?? referenceMatch[5] ?? null,
      })
      index++
      continue
    }

    const footnoteMatch = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(trimmed)
    if (footnoteMatch) {
      const bodyLines: string[] = [footnoteMatch[2] ?? '']
      index++

      while (index < lines.length) {
        const continuation = lines[index]!
        if (continuation.trim().length === 0) {
          bodyLines.push('')
          index++
          continue
        }
        if (/^(?:\s{2,}|\t)/.test(continuation)) {
          bodyLines.push(continuation.replace(/^(?:\s{2,}|\t)/, ''))
          index++
          continue
        }
        break
      }

      entries.push({
        type: 'footnote',
        label: footnoteMatch[1]!,
        body: bodyLines.join('\n').trimEnd(),
      })
      continue
    }

    return null
  }

  return entries.length > 0 ? entries : null
}

function flattenBlocks(nodes: EditorBlockNode[]): EditorBlockNode[] {
  const result: EditorBlockNode[] = []

  for (const node of nodes) {
    result.push(node)

    if (node.type === 'blockquote') {
      result.push(...flattenBlocks(node.blocks))
    }

    if (node.type === 'list') {
      for (const item of node.items) {
        result.push(item)
        result.push(...flattenBlocks(item.blocks))
      }
    }
  }

  return result
}

function sourceRange(sourceBlock: MarkdownSourceBlock) {
  return {
    startOffset: sourceBlock.startOffset,
    endOffset: sourceBlock.endOffset,
  }
}

function inferHeadingPattern(raw: string): string {
  const atxMatch = /^(#{1,6})\s/m.exec(raw)
  if (atxMatch) {
    return atxMatch[1]!
  }

  const lines = raw.trimEnd().split(/\r?\n/)
  const underline = lines.at(1)?.trim()
  if (underline && /^=+$/.test(underline)) {
    return '='
  }
  if (underline && /^-+$/.test(underline)) {
    return '-'
  }

  return '#'
}

function inferFencePattern(raw: string): string {
  const match = /^(`{3,}|~{3,})/.exec(raw)
  return match?.[1] ?? '```'
}

function inferListPattern(raw: string): string {
  const match = /^\s*([*+-]|\d+[.)])\s+/.exec(raw)
  return match?.[1] ?? '-'
}

function extractListSpacing(raw: string): { prespace: string; markindent: string } {
  const match = /^(\s*)([*+-]|\d+[.)])(\s+)/.exec(raw)
  return {
    prespace: match?.[1] ?? '',
    markindent: match?.[3] ?? ' ',
  }
}

function inferCodeSpanPattern(raw: string): string {
  const match = /^(`+)/.exec(raw)
  return match?.[1] ?? '`'
}

function inferWrappedPattern(raw: string): string {
  const match = /^([*_~]{1,2})/.exec(raw)
  return match?.[1] ?? ''
}

function inferLinkKind(raw: string): 'inline' | 'reference' | 'collapsed-reference' | 'shortcut-reference' {
  if (/^\[[^\]]+\]\([^)]*\)$/.test(raw)) {
    return 'inline'
  }
  if (/^\[[^\]]+\]\[\]$/.test(raw)) {
    return 'collapsed-reference'
  }
  if (/^\[[^\]]+\]\[[^\]]+\]$/.test(raw)) {
    return 'reference'
  }
  return 'shortcut-reference'
}

function inferReferenceLabel(raw: string): string | null {
  const referenceMatch = /^\[[^\]]+\]\[([^\]]+)\]$/.exec(raw)
  if (referenceMatch) {
    return referenceMatch[1] ?? null
  }
  if (/^\[[^\]]+\]\[\]$/.test(raw)) {
    return ''
  }
  const shortcutMatch = /^\[([^\]]+)\]$/.exec(raw)
  return shortcutMatch?.[1] ?? null
}

function looksLikeMarkdownTable(raw: string): boolean {
  const lines = raw.trim().split(/\r?\n/)
  if (lines.length < 2) {
    return false
  }

  if (!lines[0]?.includes('|')) {
    return false
  }

  return /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(lines[1]!.trim())
}
