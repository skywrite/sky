export interface MarkdownSourceGap {
  kind: 'gap'
  raw: string
  startOffset: number
  endOffset: number
}

export interface MarkdownSourceBlock {
  kind: 'block'
  cid: string
  tokenType: string
  raw: string
  startOffset: number
  endOffset: number
  text?: string
  depth?: number
  ordered?: boolean
  token: unknown
}

export type MarkdownSourceSegment = MarkdownSourceGap | MarkdownSourceBlock

export interface MarkdownSourceDocument {
  frontmatterRaw: string
  body: string
  segments: MarkdownSourceSegment[]
  blocks: MarkdownSourceBlock[]
}
