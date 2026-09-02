import * as path from 'node:path'
import { MARKDOWN_PREVIEW_THEMES, type MarkdownPreviewRequest, type MarkdownPreviewTheme } from './types.ts'

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

export function toNotebookRelativePath(markdownBaseDir: string, filePath: string): string {
  return path.relative(markdownBaseDir, filePath).split(path.sep).join('/')
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

/** The notebook path after a route prefix, percent-decoded per segment; undefined when nothing follows. */
export function decodeRoutePath(url: string, prefix: string): string | undefined {
  const pathname = new URL(url).pathname
  const routePath = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : ''
  return routePath.length > 0 ? routePath.split('/').map(decodeURIComponent).join('/') : undefined
}
