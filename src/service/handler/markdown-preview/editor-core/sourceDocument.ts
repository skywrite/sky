import * as marked from 'marked'
import type { MarkdownSourceBlock, MarkdownSourceDocument, MarkdownSourceSegment } from './types.ts'

const LEADING_FRONTMATTER_RE =
  /^(?:\ufeff)?(?<delimiter>= yaml =|---)\r?\n[\s\S]*?^(?:\k<delimiter>|\.\.\.)\s*(?:\r?\n)?/m

export function parseMarkdownSourceDocument(source: string): MarkdownSourceDocument {
  const { frontmatterRaw, body } = extractLeadingFrontmatterRaw(source)
  const tokens = marked.lexer(body, {})
  const segments: MarkdownSourceSegment[] = []

  let cursor = 0
  let nextCid = 1

  for (const token of tokens) {
    const tokenStart = body.indexOf(token.raw, cursor)
    if (tokenStart === -1) {
      throw new Error(`Unable to locate markdown token in source: ${token.type}`)
    }

    if (tokenStart > cursor) {
      segments.push({
        kind: 'gap',
        raw: body.slice(cursor, tokenStart),
        startOffset: cursor,
        endOffset: tokenStart,
      })
    }

    if (token.type === 'space') {
      segments.push({
        kind: 'gap',
        raw: token.raw,
        startOffset: tokenStart,
        endOffset: tokenStart + token.raw.length,
      })
      cursor = tokenStart + token.raw.length
      continue
    }

    segments.push(createBlock(token, tokenStart, nextCid))
    nextCid++
    cursor = tokenStart + token.raw.length
  }

  if (cursor < body.length) {
    segments.push({
      kind: 'gap',
      raw: body.slice(cursor),
      startOffset: cursor,
      endOffset: body.length,
    })
  }

  return rebuildMarkdownSourceDocument(frontmatterRaw, segments)
}

export function serializeMarkdownSourceDocument(document: MarkdownSourceDocument): string {
  return document.frontmatterRaw + document.body
}

export function replaceBlockRaw(
  document: MarkdownSourceDocument,
  cid: string,
  nextRaw: string,
): MarkdownSourceDocument {
  let found = false

  const nextSegments = document.segments.map((segment) => {
    if (segment.kind !== 'block' || segment.cid !== cid) {
      return segment
    }

    found = true
    return {
      ...segment,
      raw: nextRaw,
    }
  })

  if (!found) {
    throw new Error(`Unknown block cid: ${cid}`)
  }

  return rebuildMarkdownSourceDocument(document.frontmatterRaw, nextSegments)
}

export function replaceInBlock(
  document: MarkdownSourceDocument,
  cid: string,
  searchValue: string,
  replacementValue: string,
): MarkdownSourceDocument {
  const block = document.blocks.find((candidate) => candidate.cid === cid)
  if (!block) {
    throw new Error(`Unknown block cid: ${cid}`)
  }

  if (!block.raw.includes(searchValue)) {
    throw new Error(`Search value not found in block ${cid}`)
  }

  return replaceBlockRaw(document, cid, block.raw.replace(searchValue, replacementValue))
}

export function extractLeadingFrontmatterRaw(source: string): { frontmatterRaw: string; body: string } {
  if (!source.startsWith('---') && !source.startsWith('= yaml =') && !source.startsWith('\ufeff---')) {
    return { frontmatterRaw: '', body: source }
  }

  const match = LEADING_FRONTMATTER_RE.exec(source)
  if (!match) {
    return { frontmatterRaw: '', body: source }
  }

  const frontmatterRaw = match[0]
  return {
    frontmatterRaw,
    body: source.slice(frontmatterRaw.length),
  }
}

function rebuildMarkdownSourceDocument(
  frontmatterRaw: string,
  segments: MarkdownSourceSegment[],
): MarkdownSourceDocument {
  const rebuiltSegments: MarkdownSourceSegment[] = []
  const blocks: MarkdownSourceBlock[] = []
  let cursor = 0

  for (const segment of segments) {
    if (segment.kind === 'gap') {
      const gap = {
        ...segment,
        startOffset: cursor,
        endOffset: cursor + segment.raw.length,
      }
      rebuiltSegments.push(gap)
      cursor = gap.endOffset
      continue
    }

    const block: MarkdownSourceBlock = {
      ...segment,
      startOffset: cursor,
      endOffset: cursor + segment.raw.length,
    }

    rebuiltSegments.push(block)
    blocks.push(block)
    cursor = block.endOffset
  }

  return {
    frontmatterRaw,
    body: rebuiltSegments.map((segment) => segment.raw).join(''),
    segments: rebuiltSegments,
    blocks,
  }
}

function createBlock(token: marked.Token, startOffset: number, cidNumber: number): MarkdownSourceBlock {
  const block: MarkdownSourceBlock = {
    kind: 'block',
    cid: `block-${cidNumber}`,
    tokenType: token.type,
    raw: token.raw,
    startOffset,
    endOffset: startOffset + token.raw.length,
    token,
  }

  if ('text' in token && typeof token.text === 'string') {
    block.text = token.text
  }

  if (token.type === 'heading') {
    block.depth = token.depth
  }

  if (token.type === 'list') {
    block.ordered = token.ordered
  }

  return block
}
