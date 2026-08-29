import splitYamlMarkdown from '#shared/models/Markdown/util/splitYamlMarkdown.ts'
import { renderBlockPreview } from './blockPreview.ts'
import { buildBlockCursorMaps } from './editor-core/cursorMap.ts'
import type { EditorBlockNode } from './editor-core/model.ts'
import { parseEditorDocument } from './editor-core/parse.ts'

/**
 * One block as the browser's block editor takes it: its source range in the
 * file, its rendering, and where a click in the rendering lands in the markdown.
 */
export interface EditableBlockDescriptor {
  cid: string
  type: string
  label: string
  raw: string
  previewHtml: string
  startOffset: number
  endOffset: number
  protected: boolean
  cursorMap?: number[]
  listItemCursorMaps?: number[][]
}

export interface MarkdownDocumentEditorState {
  content: string
  version: number
  frontmatter: string
  blocks: EditableBlockDescriptor[]
}

export async function buildMarkdownDocumentEditorState(
  content: string,
  version: number,
): Promise<MarkdownDocumentEditorState> {
  const { yaml } = splitYamlMarkdown(content)

  return {
    content,
    version,
    frontmatter: yaml,
    blocks: await buildEditableBlocks(content),
  }
}

export async function buildEditableBlocks(source: string): Promise<EditableBlockDescriptor[]> {
  const document = parseEditorDocument(source)
  const frontmatterOffset = document.frontmatter?.raw.length ?? 0

  return await Promise.all(
    document.nodes
      .filter((node) => node.type !== 'frontmatter')
      .filter((node) => !(node.type === 'raw_region' && node.raw.trim().length === 0))
      .map(async (node) => {
        const sourceRange = node.source
          ? {
              startOffset: node.source.startOffset + frontmatterOffset,
              endOffset: node.source.endOffset + frontmatterOffset,
            }
          : {
              startOffset: 0,
              endOffset: node.raw.length,
            }

        return {
          cid: node.cid,
          type: node.type,
          label: formatBlockLabel(node),
          raw: node.raw,
          previewHtml: await renderEditableBlockPreview(node),
          startOffset: sourceRange.startOffset,
          endOffset: sourceRange.endOffset,
          protected: node.protected,
          ...buildBlockCursorMaps(node),
        }
      }),
  )
}

async function renderEditableBlockPreview(node: EditorBlockNode): Promise<string> {
  return await renderBlockPreview(node.type, node.raw)
}

function formatBlockLabel(node: EditorBlockNode): string {
  switch (node.type) {
    case 'frontmatter':
      return 'Frontmatter'
    case 'paragraph':
      return 'Paragraph'
    case 'heading':
      return `Heading H${node.depth}`
    case 'blockquote':
      return 'Blockquote'
    case 'list':
      return node.ordered ? 'Ordered List' : 'Bullet List'
    case 'list_item':
      return 'List Item'
    case 'fence':
      return node.lang ? `Code Fence (${node.lang})` : 'Code Fence'
    case 'html_block':
      return node.htmlKind === 'comment' ? 'HTML Comment' : 'HTML Block'
    case 'table':
      return 'Table'
    case 'hr':
      return 'Thematic Break'
    case 'definition_cluster':
      return 'Reference Definitions'
    case 'raw_region':
      return 'Raw Region'
  }
}
