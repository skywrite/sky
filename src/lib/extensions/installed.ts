/**
 * Installed extensions live in Sky's own folder, beside the config and the
 * command manifest: `~/.sky/extensions/<author>/<slug>/`. A downloaded
 * extension is a real folder there; one on this Mac is a link. Presence is
 * the whole of "installed": the loader registers what it finds.
 */

import { existsSync } from 'node:fs'
import { lstat, readdir, readFile, readlink } from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_HOME } from '#config'
import { authorHandle, type ExtensionManifest, readManifest } from './manifest.ts'

export const EXTENSIONS_DIR = path.join(DIR_HOME, '.sky', 'extensions')

export interface InstalledExtension {
  author: string
  slug: string
  /** `author/slug` */
  id: string
  /** Switched on. Off leaves the folder in place but loads nothing from it. */
  enabled: boolean
  /** The folder Sky loads from: the link's target when linked */
  dir: string
  /** Where the link points, when the extension is a link to a folder on this Mac */
  linkedFrom?: string
  manifest: ExtensionManifest
  /** Why the folder could not be read as an extension, when it could not */
  problem?: string
}

/** A command root the manifest builder walks, and the prefix every command under it gets. */
export interface ExtensionCommandRoot {
  dir: string
  prefix: string
}

export async function listInstalled(root: string = EXTENSIONS_DIR): Promise<InstalledExtension[]> {
  if (!existsSync(root)) return []
  const found: InstalledExtension[] = []
  for (const author of await readdir(root)) {
    if (author.startsWith('.')) continue
    const authorDir = path.join(root, author)
    if (!(await lstat(authorDir)).isDirectory()) continue
    for (const slug of await readdir(authorDir)) {
      if (slug.startsWith('.')) continue
      const installed = await readInstalled(author, slug, path.join(authorDir, slug))
      if (installed) found.push(installed)
    }
  }
  return found.sort((a, b) => a.id.localeCompare(b.id))
}

/** The marker that switches an extension off: an empty file beside its folder. */
export function disabledMarker(root: string, author: string, slug: string): string {
  return path.join(root, author, `${slug}.disabled`)
}

async function readInstalled(author: string, slug: string, dir: string): Promise<InstalledExtension | null> {
  const stat = await lstat(dir)
  const id = `${author}/${slug}`
  const enabled = !existsSync(disabledMarker(path.dirname(path.dirname(dir)), author, slug))
  const broken = (problem: string, linkedFrom?: string): InstalledExtension => ({
    author,
    slug,
    id,
    enabled,
    dir,
    linkedFrom,
    manifest: placeholder(slug),
    problem,
  })
  let linkedFrom: string | undefined
  if (stat.isSymbolicLink()) {
    linkedFrom = path.resolve(path.dirname(dir), await readlink(dir))
    if (!existsSync(linkedFrom)) return broken(`the linked folder is gone: ${linkedFrom}`, linkedFrom)
  } else if (!stat.isDirectory()) return null

  let text: string
  try {
    text = await readFile(path.join(dir, 'package.json'), 'utf8')
  } catch {
    return broken('no package.json', linkedFrom)
  }
  const read = readManifest(text)
  if (!read.ok) return broken(read.reason, linkedFrom)
  const problem =
    read.manifest.name !== slug
      ? `installed as ${slug} but its package.json says ${read.manifest.name}`
      : authorHandle(read.manifest) !== author
        ? `installed under ${author} but its author is ${authorHandle(read.manifest) ?? 'unknown'}`
        : undefined
  return { author, slug, id, enabled, dir, linkedFrom, manifest: read.manifest, problem }
}

function placeholder(slug: string): ExtensionManifest {
  return {
    name: slug,
    version: '0.0.0',
    description: '',
    author: { name: '', email: 'unknown@example.com', url: 'https://example.com' },
    sky: { manifest: 1, name: slug, categories: ['Utilities'] },
  }
}

/** The command roots of every healthy, switched-on extension, prefixed by slug. */
export async function extensionCommandRoots(root: string = EXTENSIONS_DIR): Promise<ExtensionCommandRoot[]> {
  const roots: ExtensionCommandRoot[] = []
  for (const extension of await listInstalled(root)) {
    if (extension.problem || !extension.enabled) continue
    const dir = path.join(extension.dir, 'commands')
    if (existsSync(dir)) roots.push({ dir, prefix: extension.slug })
  }
  return roots
}
