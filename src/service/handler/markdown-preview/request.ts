import * as path from 'node:path'
import {
  MARKDOWN_PREVIEW_THEMES,
  type MarkdownPreviewMode,
  type MarkdownPreviewRequest,
  type MarkdownPreviewTheme,
} from './types.ts'

export type ResolvedPreviewRequest =
  | { ok: true; value: MarkdownPreviewRequest }
  | { ok: false; status: 400 | 403; message: string }

export function resolveMarkdownPreviewRequest(
  fileParam: string | undefined,
  themeParam: string | undefined,
  markdownBaseDir: string,
  markdownDirs: string[],
): ResolvedPreviewRequest {
  if (!fileParam) {
    return { ok: false, status: 400, message: 'Missing required query param: file' }
  }

  if (path.isAbsolute(fileParam)) {
    return { ok: false, status: 400, message: 'Preview route requires a notebook-relative markdown file path' }
  }

  const resolvedBaseDir = path.resolve(markdownBaseDir)
  const resolvedFilePath = path.resolve(resolvedBaseDir, path.normalize(fileParam))

  if (!isPathWithinRoot(resolvedFilePath, resolvedBaseDir)) {
    return { ok: false, status: 403, message: 'Requested file is outside the notebook base directory' }
  }

  if (path.extname(resolvedFilePath).toLowerCase() !== '.md') {
    return { ok: false, status: 400, message: 'Preview route only supports .md files' }
  }

  if (!isPathWithinRoots(resolvedFilePath, markdownDirs)) {
    return { ok: false, status: 403, message: 'Requested file is outside configured markdown directories' }
  }

  return {
    ok: true,
    value: {
      filePath: resolvedFilePath,
      relativePath: toNotebookRelativePath(resolvedBaseDir, resolvedFilePath),
      theme: normalizeTheme(themeParam),
    },
  }
}

export function buildMarkdownPreviewPath(
  relativePath: string,
  options?: { theme?: string; mode?: MarkdownPreviewMode },
): string {
  const normalizedPath = relativePath.trim()
  const pathname =
    normalizedPath.length > 0 ? `/docs/${normalizedPath.split('/').map(encodeURIComponent).join('/')}` : '/docs/'

  const search = new URLSearchParams()
  if (options?.theme && options.theme !== 'github') {
    search.set('theme', options.theme)
  }
  if (options?.mode && options.mode !== 'preview') {
    search.set('mode', options.mode)
  }

  return search.size > 0 ? `${pathname}?${search.toString()}` : pathname
}

export function buildMarkdownContentApiPath(relativePath: string): string {
  const normalizedPath = relativePath.trim()
  return `/docs/_api/content/${normalizedPath.split('/').map(encodeURIComponent).join('/')}`
}

export function buildMarkdownDocumentApiPath(relativePath: string): string {
  const normalizedPath = relativePath.trim()
  return `/docs/_api/document/${normalizedPath.split('/').map(encodeURIComponent).join('/')}`
}

export function buildMarkdownPdfExportPath(relativePath: string, options?: { theme?: string }): string {
  const normalizedPath = relativePath.trim()
  const pathname = `/docs/_api/export-pdf/${normalizedPath.split('/').map(encodeURIComponent).join('/')}`
  const search = new URLSearchParams()
  if (options?.theme && options.theme !== 'github') {
    search.set('theme', options.theme)
  }

  return search.size > 0 ? `${pathname}?${search.toString()}` : pathname
}

export function toNotebookRelativePath(markdownBaseDir: string, filePath: string): string {
  return path.relative(markdownBaseDir, filePath).split(path.sep).join('/')
}

export function resolveMarkdownPreviewTheme(themeParam: string | undefined): MarkdownPreviewTheme {
  return normalizeTheme(themeParam)
}

export function resolveMarkdownPreviewMode(modeParam: string | undefined): MarkdownPreviewMode {
  return modeParam === 'edit' ? 'edit' : 'preview'
}

function normalizeTheme(themeParam: string | undefined): MarkdownPreviewTheme {
  if (!themeParam) return 'github'
  return MARKDOWN_PREVIEW_THEMES.includes(themeParam as MarkdownPreviewTheme)
    ? (themeParam as MarkdownPreviewTheme)
    : 'github'
}

export function isPathWithinRoots(filePath: string, markdownDirs: string[]): boolean {
  const resolvedFile = path.resolve(filePath)

  return markdownDirs.some((root) => {
    return isPathWithinRoot(resolvedFile, root)
  })
}

export function isPathWithinRoot(filePath: string, rootDir: string): boolean {
  const resolvedRoot = path.resolve(rootDir)
  const relative = path.relative(resolvedRoot, filePath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
