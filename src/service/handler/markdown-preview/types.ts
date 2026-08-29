export const MARKDOWN_PREVIEW_THEMES = ['github', 'gothic', 'newsprint', 'night', 'pixyll', 'whitey'] as const

export type MarkdownPreviewTheme = (typeof MARKDOWN_PREVIEW_THEMES)[number]

export interface MarkdownPreviewRequest {
  filePath: string
  relativePath: string
  theme: MarkdownPreviewTheme
}
