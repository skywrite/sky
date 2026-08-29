/**
 * The explorer — the notebook's markdown as a tree you open one directory
 * at a time, and any file in it rendered to read. Nothing here walks the
 * whole notebook: a directory is listed when it is opened, a file is read
 * when it is looked at. Editing stays with the block editor.
 */

import * as path from 'node:path'
import { Hono } from 'hono'
import { marked } from 'marked'
import { exists, readDir } from '#shared/fs/mod.ts'
import splitYamlMarkdown from '#shared/models/Markdown/util/splitYamlMarkdown.ts'
import { readMarkdownContent } from '../markdown-preview/content.ts'
import {
  isPathWithinRoot,
  isPathWithinRoots,
  resolveMarkdownPreviewRequest,
  toNotebookRelativePath,
} from '../markdown-preview/request.ts'

export interface ExplorerRoutesOptions {
  /** The notebook root that every path is relative to */
  markdownBaseDir: string
  /** The directories the explorer shows — its roots */
  markdownDirs: string[]
}

export interface ExplorerEntry {
  name: string
  /** Relative to the notebook root */
  path: string
  kind: 'dir' | 'file'
}

export interface ExplorerListing {
  /** The directory listed, relative to the notebook root; '' for the roots */
  path: string
  /** Directories first, then markdown files, each in natural order */
  entries: ExplorerEntry[]
}

export interface ExplorerDoc {
  /** Relative to the notebook root */
  path: string
  /** The YAML frontmatter as written; '' when the file has none */
  frontmatter: string
  /** The body rendered to HTML, HTML comments left out */
  html: string
  version: number
}

type Refusal = { ok: false; status: 400 | 403; message: string }

const COMMENT = /<!--[\s\S]*?-->/g

function byKindThenName(a: ExplorerEntry, b: ExplorerEntry): number {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

/** The roots: the configured directories that exist. */
async function listRoots(options: ExplorerRoutesOptions): Promise<ExplorerListing> {
  const base = path.resolve(options.markdownBaseDir)
  const present = await Promise.all(options.markdownDirs.map(async (dir) => ((await exists(dir)) ? dir : null)))
  const entries = present
    .filter((dir): dir is string => dir !== null)
    .map((dir) => ({ name: path.basename(dir), path: toNotebookRelativePath(base, dir), kind: 'dir' as const }))
  entries.sort(byKindThenName)
  return { path: '', entries }
}

/** A directory the explorer may list: inside the notebook, under one of its roots. */
function resolveDir(
  param: string,
  options: ExplorerRoutesOptions,
): { ok: true; dir: string; relativePath: string } | Refusal {
  if (path.isAbsolute(param)) return { ok: false, status: 400, message: 'a notebook-relative path is required' }
  const base = path.resolve(options.markdownBaseDir)
  const dir = path.resolve(base, path.normalize(param))
  if (!isPathWithinRoot(dir, base)) return { ok: false, status: 403, message: 'outside the notebook' }
  if (!isPathWithinRoots(dir, options.markdownDirs)) {
    return { ok: false, status: 403, message: 'outside the directories the explorer shows' }
  }
  return { ok: true, dir, relativePath: toNotebookRelativePath(base, dir) }
}

/** One level: the directories and markdown files directly inside `dir`; null when it is not a directory. */
async function listDir(dir: string, relativePath: string, base: string): Promise<ExplorerListing | null> {
  const entries: ExplorerEntry[] = []
  try {
    for await (const entry of readDir(dir)) {
      if (entry.name.startsWith('.')) continue
      const isMarkdown = entry.isFile && path.extname(entry.name).toLowerCase() === '.md'
      if (!entry.isDirectory && !isMarkdown) continue
      entries.push({
        name: entry.name,
        path: toNotebookRelativePath(base, path.join(dir, entry.name)),
        kind: entry.isDirectory ? 'dir' : 'file',
      })
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw err
  }
  entries.sort(byKindThenName)
  return { path: relativePath, entries }
}

/** The file rendered to read: frontmatter kept aside, comments left out, the rest as HTML. */
async function readDoc(
  param: string,
  options: ExplorerRoutesOptions,
): Promise<{ ok: true; doc: ExplorerDoc } | Refusal | { ok: false; status: 404; message: string }> {
  const request = resolveMarkdownPreviewRequest(param, undefined, options.markdownBaseDir, options.markdownDirs)
  if (!request.ok) return request
  try {
    const snapshot = await readMarkdownContent(request.value.filePath)
    const { yaml, markdown } = splitYamlMarkdown(snapshot.content)
    const body = markdown.replace(COMMENT, '').trim()
    return {
      ok: true,
      doc: {
        path: request.value.relativePath,
        frontmatter: yaml,
        html: body.length > 0 ? await marked.parse(body) : '',
        version: snapshot.version,
      },
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, status: 404, message: `no file at ${request.value.relativePath}` }
    }
    throw err
  }
}

export function createExplorerRoutes(options: ExplorerRoutesOptions): Hono {
  const app = new Hono()

  // GET /dir            → the roots
  // GET /dir?path=a/b   → what is directly inside a/b
  app.get('/dir', async (c) => {
    const param = c.req.query('path') ?? ''
    if (param === '') return c.json(await listRoots(options))
    const resolved = resolveDir(param, options)
    if (!resolved.ok) return c.json({ message: resolved.message }, resolved.status)
    const listing = await listDir(resolved.dir, resolved.relativePath, path.resolve(options.markdownBaseDir))
    if (!listing) return c.json({ message: `no directory at ${resolved.relativePath}` }, 404)
    return c.json(listing)
  })

  // GET /doc?path=a/b.md → the file, rendered
  app.get('/doc', async (c) => {
    const result = await readDoc(c.req.query('path') ?? '', options)
    if (!result.ok) return c.json({ message: result.message }, result.status)
    return c.json(result.doc)
  })

  return app
}
