export interface SourceRange {
  startOffset: number
  endOffset: number
}

export interface NodePreservation {
  pattern?: string
  prespace?: string
  markindent?: string
  userIndent?: string
}

export interface EditorDocument {
  frontmatter: FrontmatterNode | null
  nodes: EditorBlockNode[]
  allBlocks: EditorBlockNode[]
}

interface EditorNodeBase {
  cid: string
  raw: string
  source?: SourceRange
  sourceBlockCid?: string
  protected: boolean
  preservation: NodePreservation
}

interface EditorBlockNodeBase extends EditorNodeBase {
  kind: 'block'
}

interface EditorInlineNodeBase extends EditorNodeBase {
  kind: 'inline'
}

export interface FrontmatterNode extends EditorBlockNodeBase {
  type: 'frontmatter'
  delimiter: '---' | '= yaml ='
  body: string
}

export interface ParagraphNode extends EditorBlockNodeBase {
  type: 'paragraph'
  inlines: EditorInlineNode[]
}

export interface HeadingNode extends EditorBlockNodeBase {
  type: 'heading'
  depth: number
  inlines: EditorInlineNode[]
}

export interface BlockquoteNode extends EditorBlockNodeBase {
  type: 'blockquote'
  blocks: EditorBlockNode[]
}

export interface ListNode extends EditorBlockNodeBase {
  type: 'list'
  ordered: boolean
  start: string
  loose: boolean
  items: ListItemNode[]
}

export interface ListItemNode extends EditorBlockNodeBase {
  type: 'list_item'
  checked: boolean | null
  loose: boolean
  inlines: EditorInlineNode[]
  blocks: EditorBlockNode[]
}

export interface FenceNode extends EditorBlockNodeBase {
  type: 'fence'
  lang: string
  text: string
}

export interface HtmlBlockNode extends EditorBlockNodeBase {
  type: 'html_block'
  htmlKind: 'comment' | 'html'
}

export interface TableNode extends EditorBlockNodeBase {
  type: 'table'
}

export interface HrNode extends EditorBlockNodeBase {
  type: 'hr'
}

export interface ReferenceDefinitionEntry {
  type: 'reference'
  label: string
  href: string
  title: string | null
}

export interface FootnoteDefinitionEntry {
  type: 'footnote'
  label: string
  body: string
}

export interface DefinitionClusterNode extends EditorBlockNodeBase {
  type: 'definition_cluster'
  entries: Array<ReferenceDefinitionEntry | FootnoteDefinitionEntry>
}

export interface RawRegionNode extends EditorBlockNodeBase {
  type: 'raw_region'
}

export type EditorBlockNode =
  | FrontmatterNode
  | ParagraphNode
  | HeadingNode
  | BlockquoteNode
  | ListNode
  | ListItemNode
  | FenceNode
  | HtmlBlockNode
  | TableNode
  | HrNode
  | DefinitionClusterNode
  | RawRegionNode

export interface TextInlineNode extends EditorInlineNodeBase {
  type: 'text'
  text: string
}

export interface LinkInlineNode extends EditorInlineNodeBase {
  type: 'link'
  href: string
  title: string | null
  linkKind: 'inline' | 'reference' | 'collapsed-reference' | 'shortcut-reference'
  referenceLabel: string | null
  children: EditorInlineNode[]
}

export interface CodeSpanInlineNode extends EditorInlineNodeBase {
  type: 'code_span'
  text: string
}

export interface StrongInlineNode extends EditorInlineNodeBase {
  type: 'strong'
  children: EditorInlineNode[]
}

export interface EmInlineNode extends EditorInlineNodeBase {
  type: 'em'
  children: EditorInlineNode[]
}

export interface DeleteInlineNode extends EditorInlineNodeBase {
  type: 'delete'
  children: EditorInlineNode[]
}

export interface ImageInlineNode extends EditorInlineNodeBase {
  type: 'image'
  href: string
  title: string | null
  alt: string
}

export interface InlineHtmlNode extends EditorInlineNodeBase {
  type: 'html_inline'
  text: string
}

export type EditorInlineNode =
  | TextInlineNode
  | LinkInlineNode
  | CodeSpanInlineNode
  | StrongInlineNode
  | EmInlineNode
  | DeleteInlineNode
  | ImageInlineNode
  | InlineHtmlNode
