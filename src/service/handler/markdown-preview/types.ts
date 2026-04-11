export const MARKDOWN_PREVIEW_THEMES = ['github', 'gothic', 'newsprint', 'night', 'pixyll', 'whitey'] as const

export type MarkdownPreviewTheme = (typeof MARKDOWN_PREVIEW_THEMES)[number]
export type MarkdownPreviewMode = 'preview' | 'edit'

export interface MarkdownPreviewRequest {
  filePath: string
  relativePath: string
  theme: MarkdownPreviewTheme
}

export interface MarkdownPreviewRenderOptions {
  markdownBaseDir: string
  markdownDirs: string[]
  defaultTheme?: MarkdownPreviewTheme
  mode?: MarkdownPreviewMode
}

export interface MarkdownExplorerFile {
  type: 'file'
  name: string
  relativePath: string
  isCurrent: boolean
}

export interface MarkdownExplorerDirectory {
  type: 'directory'
  name: string
  relativePath: string
  isCurrentBranch: boolean
  children: MarkdownExplorerNode[]
}

export type MarkdownExplorerNode = MarkdownExplorerDirectory | MarkdownExplorerFile
