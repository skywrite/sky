import * as path from 'node:path'
import process from 'node:process'
import open from 'open'
import openEditor from '#lib/shell/openEditor.ts'
import { runCommand } from '#lib/sys/mod.ts'
import { loadSkyConfig, openSavedIn } from '#shared/config/loader.ts'
import type { OpenSavedTarget, SkyConfig } from '#shared/config/types.ts'

export interface OpenSavedFilesOptions {
  /** Notebook root directory (defaults to live config.dir). */
  baseDir?: string
  /** Sky web service port (defaults to live config.server.port). */
  port?: number
  /** Override the configured openSavedIn target (defaults to live config.openSavedIn ?? 'browser'). */
  target?: OpenSavedTarget
  /** Editor command override (defaults to live config.editor). */
  editor?: string
  /** Platform override for tests (defaults to process.platform). */
  platform?: NodeJS.Platform
  /** Config loader override for tests (defaults to loadSkyConfig). */
  loadConfig?: () => Pick<SkyConfig, 'dir' | 'editor' | 'openSavedIn' | 'server'>
  /** Command runner override for tests (defaults to runCommand). */
  run?: typeof runCommand
  /** Cross-platform URL opener override for tests (defaults to open). */
  openUrl?: (url: string) => Promise<unknown>
  /** Editor opener override for tests (defaults to openEditor). */
  openInEditor?: (files: Array<{ file: string }>, editor?: string) => Promise<void>
}

export interface OpenSavedFilesResult {
  target: OpenSavedTarget
  opened: number
}

function validateRelativePath(rel: string, original: string): string {
  const normalized = rel.replaceAll('\\', '/').replace(/\/+$/, '')
  const parts = normalized.split('/')
  if (!normalized || path.isAbsolute(normalized) || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid notebook path: ${original}`)
  }
  return parts.join('/')
}

/** Local Explorer URL for a notebook-relative path, matching openJournals and explorerHref. */
export function explorerFileUrl(relativePath: string, port: number): string {
  const clean = validateRelativePath(relativePath.trim(), relativePath)
  return `http://localhost:${port}/explorer/${clean.split('/').map(encodeURIComponent).join('/')}`
}

/** Normalize a captured file (notebook-relative or absolute inside baseDir) to a clean POSIX notebook-relative path. */
export function toNotebookRelativePath(file: string, baseDir: string): string {
  const raw = file.trim()
  if (!raw) throw new Error('Cannot open an empty file path.')
  if (path.isAbsolute(raw)) {
    const rel = path.relative(path.resolve(baseDir), path.resolve(raw))
    return validateRelativePath(rel, file)
  }
  return validateRelativePath(raw.replace(/^\.\//, ''), file)
}

/**
 * Open newly saved notebook files according to the user's `openSavedIn` preference:
 * - `'browser'` (default): open each file's local Explorer URL in browser tabs
 * - `'code'`: open the files on disk in the configured code editor
 * - `'none'`: do not open anything
 */
export async function openSavedFiles(
  files: readonly string[],
  options: OpenSavedFilesOptions = {},
): Promise<OpenSavedFilesResult> {
  const cfg = (options.loadConfig ?? loadSkyConfig)()
  const target = options.target ?? openSavedIn(cfg)
  if (files.length === 0 || target === 'none') return { target, opened: 0 }

  const baseDir = options.baseDir ?? cfg.dir
  const relativePaths = [...new Set(files.map((file) => toNotebookRelativePath(file, baseDir)))]

  if (target === 'code') {
    const editor = options.editor ?? cfg.editor
    const openFiles = options.openInEditor ?? ((items, ed) => openEditor(items, ed ? { editor: ed } : undefined))
    await openFiles(
      relativePaths.map((relPath) => ({ file: path.join(baseDir, relPath) })),
      editor,
    )
    return { target, opened: relativePaths.length }
  }

  const port = options.port ?? cfg.server.port
  const urls = relativePaths.map((relPath) => explorerFileUrl(relPath, port))
  const platform = options.platform ?? process.platform
  if (platform === 'darwin') {
    const run = options.run ?? runCommand
    const result = await run('open', urls, { timeout: 10_000 })
    if (!result.success) {
      throw new Error(result.stderr.trim() || 'Could not open Explorer browser tabs.')
    }
  } else {
    const openUrl = options.openUrl ?? ((url: string) => open(url))
    for (const url of urls) await openUrl(url)
  }

  return { target, opened: urls.length }
}
