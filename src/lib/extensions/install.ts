/**
 * Adding and removing extensions. Version 1 adds a folder on this Mac: the
 * manifest is checked, the folder is linked into the extensions folder, its
 * dependencies are installed, and the command manifest is rebuilt so the
 * extension's commands answer at once. Removing unlinks; the folder stays.
 */

import { existsSync } from 'node:fs'
import { lstat, mkdir, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { buildManifest } from '#commands/all/cli/_commandsManifest.ts'
import { DIR_CODE_SRC } from '#config'
import { disabledMarker, EXTENSIONS_DIR, type InstalledExtension, listInstalled } from './installed.ts'
import { authorHandle, readManifest } from './manifest.ts'

export type AddOutcome =
  | { added: true; id: string; dir: string; commands: string[]; install: string }
  | { added: false; reason: string }

export interface AddOptions {
  root?: string
  /** Run the dependency install in the folder; the default runs `bun install` */
  installDependencies?: (dir: string) => Promise<{ ok: boolean; detail: string }>
  /** Rebuild the command manifest; the default is the real one */
  rebuild?: () => Promise<{ commands: { local: Array<{ name: string }> } }>
  /** Where Sky's own packages live; the default is the checkout's */
  hostModules?: string
}

/**
 * The packages an extension's screens share with Sky's web app. One copy of
 * each on the page: an extension with a ui/ folder gets links to Sky's own,
 * replacing any copy its install brought, and the bundler resolves them the
 * way it resolves Sky's.
 */
export const SHARED_UI_PACKAGES = ['react', 'react-dom', '@mantine/core', '@mantine/hooks'] as const

export async function linkSharedPackages(dir: string, hostModules: string): Promise<string[]> {
  if (!existsSync(path.join(dir, 'ui'))) return []
  const linked: string[] = []
  for (const name of SHARED_UI_PACKAGES) {
    const source = path.join(hostModules, name)
    if (!existsSync(source)) continue
    const link = path.join(dir, 'node_modules', name)
    const current = await lstat(link).catch(() => null)
    if (current?.isSymbolicLink() && (await realpath(link).catch(() => null)) === (await realpath(source))) continue
    if (current) await rm(link, { recursive: true, force: true })
    await mkdir(path.dirname(link), { recursive: true })
    await symlink(source, link, 'dir')
    linked.push(name)
  }
  return linked
}

export async function addExtension(folder: string, options: AddOptions = {}): Promise<AddOutcome> {
  const root = options.root ?? EXTENSIONS_DIR
  const dir = path.resolve(folder)
  if (!existsSync(dir)) return { added: false, reason: `no such folder: ${dir}` }

  let text: string
  try {
    text = await readFile(path.join(dir, 'package.json'), 'utf8')
  } catch {
    return { added: false, reason: `${dir} has no package.json` }
  }
  const read = readManifest(text)
  if (!read.ok) return { added: false, reason: read.reason }
  const author = authorHandle(read.manifest)
  if (!author)
    return {
      added: false,
      reason:
        'the author needs a GitHub profile URL, or the repository a GitHub URL, to give the extension its author/name identity',
    }
  const slug = read.manifest.name
  const id = `${author}/${slug}`

  const target = path.join(root, author, slug)
  if (existsSync(target) || (await isLink(target))) {
    const current = (await isLink(target)) ? path.resolve(path.dirname(target), await readlink(target)) : target
    if (current !== dir)
      return {
        added: false,
        reason: `${id} is already installed from ${current}. Remove it first: sky extensions:remove ${id}`,
      }
  } else {
    await mkdir(path.dirname(target), { recursive: true })
    await symlink(dir, target, 'dir')
  }

  const install = await (options.installDependencies ?? installWithBun)(dir)
  if (!install.ok) {
    await rm(target, { force: true })
    return { added: false, reason: `dependency install failed in ${dir}:\n${install.detail}` }
  }
  await linkSharedPackages(dir, options.hostModules ?? path.join(DIR_CODE_SRC, 'node_modules'))

  const manifest = await (options.rebuild ?? buildManifest)()
  const commands = manifest.commands.local
    .map((c) => c.name)
    .filter((name) => name.startsWith(`${slug}:`))
    .sort()
  return { added: true, id, dir, commands, install: install.detail }
}

export type RemoveOutcome = { removed: true; id: string; dir: string } | { removed: false; reason: string }

/** Unlink an installed extension by `author/slug` or by slug alone when that is unambiguous. */
export async function removeExtension(
  name: string,
  options: { root?: string; rebuild?: () => Promise<unknown> } = {},
): Promise<RemoveOutcome> {
  const root = options.root ?? EXTENSIONS_DIR
  const installed = await listInstalled(root)
  const matches = installed.filter((e) => e.id === name || e.slug === name)
  if (matches.length === 0) return { removed: false, reason: `${name} is not installed` }
  if (matches.length > 1)
    return {
      removed: false,
      reason: `${name} is installed more than once: ${matches.map((m) => m.id).join(', ')}. Say which.`,
    }
  const extension: InstalledExtension = matches[0]
  const linkPath = path.join(root, extension.author, extension.slug)
  if (await isLink(linkPath)) await rm(linkPath, { force: true })
  else
    return {
      removed: false,
      reason: `${extension.id} is a real folder, not a link; delete ${linkPath} yourself if that is what you want`,
    }
  await (options.rebuild ?? buildManifest)()
  return { removed: true, id: extension.id, dir: extension.dir }
}

export type EnableOutcome = { changed: true; id: string; enabled: boolean } | { changed: false; reason: string }

/** Switch an installed extension on or off, by `author/slug` or by slug alone when that is unambiguous. */
export async function setExtensionEnabled(
  name: string,
  enabled: boolean,
  options: { root?: string; rebuild?: () => Promise<unknown> } = {},
): Promise<EnableOutcome> {
  const root = options.root ?? EXTENSIONS_DIR
  const matches = (await listInstalled(root)).filter((e) => e.id === name || e.slug === name)
  if (matches.length === 0) return { changed: false, reason: `${name} is not installed` }
  if (matches.length > 1) {
    return {
      changed: false,
      reason: `${name} is installed more than once: ${matches.map((m) => m.id).join(', ')}. Say which.`,
    }
  }
  const extension = matches[0]
  const marker = disabledMarker(root, extension.author, extension.slug)
  if (enabled) await rm(marker, { force: true })
  else await writeFile(marker, '')
  await (options.rebuild ?? buildManifest)()
  return { changed: true, id: extension.id, enabled }
}

async function isLink(p: string): Promise<boolean> {
  try {
    return (await lstat(p)).isSymbolicLink()
  } catch {
    return false
  }
}

async function installWithBun(dir: string): Promise<{ ok: boolean; detail: string }> {
  const bun = Bun.which('bun') ?? process.execPath
  const proc = Bun.spawn([bun, 'install'], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: process.env })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const code = await proc.exited
  const detail = [out.trim(), err.trim()].filter(Boolean).join('\n')
  return { ok: code === 0, detail: detail || (code === 0 ? 'nothing to install' : `bun install exited ${code}`) }
}
