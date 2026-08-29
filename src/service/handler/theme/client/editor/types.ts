/**
 * One block as the editor holds it: its source range in the file, its rendering, and where a
 * click in the rendering lands in the markdown. The server builds these; the editor keeps
 * them current as it saves.
 */
export interface EditableBlock {
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
