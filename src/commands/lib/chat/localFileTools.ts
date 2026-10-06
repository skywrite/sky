import { createHash } from 'node:crypto'
import { constants, createReadStream, type Stats } from 'node:fs'
import { copyFile, link, lstat, mkdir, readdir, realpath, rmdir, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import { createFileTools, resolveFilePath, type FileToolsOptions } from './fileTools.ts'
import { findDownloads } from './findDownloads.ts'

const filePath = z.string().trim().min(1).max(4096)
const MAX_MOVE_ENTRIES = 10_000
type FileKind = 'file' | 'directory' | 'symlink' | 'other'
const kindOf = (info: Stats): FileKind =>
  info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other'
const codeOf = (error: unknown) => (error as NodeJS.ErrnoException).code
const present = (location: string) =>
  lstat(location).then(
    () => true,
    () => false,
  )

function resolve(given: string, cwd: string): string {
  if (!given.trim() || given.includes('\0')) throw new Error('Name a nonempty local path.')
  return path.resolve(resolveFilePath(given, cwd))
}

function problem(error: unknown): string {
  switch (codeOf(error)) {
    case 'EEXIST':
      return 'The destination already exists. Nothing there was overwritten. Choose a different destination.'
    case 'ENOENT':
      return 'A file or folder no longer exists. List the containing folder and use its current path.'
    case 'EACCES':
    case 'EPERM':
      return 'The operating system denied access to this path. Check the folder permissions for the app running Sky.'
    case 'ENOSPC':
      return 'The destination has no free space. Free space or choose another destination.'
    case 'ENOTEMPTY':
      return 'The source folder changed during the move. Its remaining contents were preserved.'
    case 'ENOTDIR':
      return 'Part of this path is a file, rather than a folder. List its parent to check the path.'
    default:
      return error instanceof Error ? error.message : 'The file operation could not finish.'
  }
}

export async function listDirectory(
  input: { path: string; offset?: number; limit?: number },
  cwd: string,
  signal?: AbortSignal,
) {
  const location = resolve(input.path, cwd)
  try {
    signal?.throwIfAborted()
    const names = (await readdir(location)).sort()
    const offset = input.offset ?? 0
    const limit = Math.min(input.limit ?? 200, 500)
    const entries = await Promise.all(
      names.slice(offset, offset + limit).map(async (name) => {
        const entryPath = path.join(location, name)
        try {
          const info = await lstat(entryPath)
          return { name, path: entryPath, kind: kindOf(info), ...(info.isFile() ? { bytes: info.size } : {}) }
        } catch (error) {
          return { name, path: entryPath, error: problem(error) }
        }
      }),
    )
    signal?.throwIfAborted()
    const next = offset + entries.length
    return {
      success: true,
      path: location,
      entries,
      total: names.length,
      nextOffset: next < names.length ? next : null,
    }
  } catch (error) {
    return { success: false, path: location, error: problem(error) }
  }
}

export async function createDirectory(input: { path: string }, cwd: string, signal?: AbortSignal) {
  const location = resolve(input.path, cwd)
  try {
    signal?.throwIfAborted()
    const created = await mkdir(location, { recursive: true })
    return { success: true, path: location, created: created !== undefined }
  } catch (error) {
    return { success: false, path: location, error: problem(error) }
  }
}

/** Resolve existing ancestors before checking whether a destination is inside its source. */
async function canonicalDestination(location: string): Promise<string> {
  try {
    return await realpath(location)
  } catch (error) {
    if (codeOf(error) !== 'ENOENT') throw error
    const parent = path.dirname(location)
    if (parent === location) throw error
    return path.join(await canonicalDestination(parent), path.basename(location))
  }
}

type MoveEntry = { source: string; relative: string; info: Stats }
async function inspectMove(source: string, signal?: AbortSignal): Promise<MoveEntry[]> {
  const entries: MoveEntry[] = []
  const inspect = async (location: string, relative: string) => {
    signal?.throwIfAborted()
    const info = await lstat(location)
    if (!info.isFile() && !info.isDirectory())
      throw new Error(`Cannot move ${location}: symbolic links and special files need a separate explicit operation.`)
    entries.push({ source: location, relative, info })
    if (entries.length > MAX_MOVE_ENTRIES)
      throw new Error('This folder has more than 10,000 entries. Move smaller folders separately.')
    if (info.isDirectory())
      for (const name of (await readdir(location)).sort())
        await inspect(path.join(location, name), path.join(relative, name))
  }
  await inspect(source, '')
  return entries
}

const unchanged = (before: Stats, now: Stats) =>
  before.dev === now.dev && before.ino === now.ino && before.size === now.size && before.mtimeMs === now.mtimeMs

async function digest(location: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(location)) hash.update(chunk)
  return hash.digest('hex')
}

/** Exclusive destination claims prevent clobbering, including two simultaneous moves to the same name. */
export async function movePath(input: { source: string; destination: string }, cwd: string, signal?: AbortSignal) {
  const source = resolve(input.source, cwd)
  const destination = resolve(input.destination, cwd)
  let filesMoved = 0
  let destinationCreated = false
  try {
    signal?.throwIfAborted()
    const sourceInfo = await lstat(source)
    if (await present(destination)) throw Object.assign(new Error('Destination exists'), { code: 'EEXIST' })
    const sourceReal = await realpath(source)
    const destinationReal = await canonicalDestination(destination)
    const relative = path.relative(sourceReal, destinationReal)
    if (
      sourceInfo.isDirectory() &&
      (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)))
    )
      throw new Error('A folder cannot be moved inside itself. Choose a destination outside the source folder.')
    const entries = await inspectMove(source, signal)
    signal?.throwIfAborted()
    await mkdir(path.dirname(destination), { recursive: true })
    for (const entry of entries) {
      signal?.throwIfAborted()
      const target = path.join(destination, entry.relative)
      const current = await lstat(entry.source)
      if (entry.info.isDirectory()) {
        if (!current.isDirectory() || current.dev !== entry.info.dev || current.ino !== entry.info.ino)
          throw new Error(`The source folder changed during the move: ${entry.source}`)
        await mkdir(target)
        destinationCreated = true
        continue
      }
      if (!current.isFile() || !unchanged(entry.info, current))
        throw new Error(`The source file changed during the move: ${entry.source}`)
      try {
        await link(entry.source, target)
      } catch (error) {
        if (codeOf(error) !== 'EXDEV') throw error
        await copyFile(entry.source, target, constants.COPYFILE_EXCL)
        destinationCreated = true
        if ((await digest(entry.source)) !== (await digest(target)))
          throw new Error(`The copied file could not be verified. The source was preserved: ${entry.source}`)
      }
      destinationCreated = true
      signal?.throwIfAborted()
      if (!unchanged(entry.info, await lstat(entry.source)))
        throw new Error(`The source file changed during the move. Both paths were preserved: ${entry.source}`)
      await unlink(entry.source)
      filesMoved++
    }
    // Only remove empty source folders. Files added during the move must never be deleted.
    for (const entry of entries.toReversed()) {
      signal?.throwIfAborted()
      if (entry.info.isDirectory()) await rmdir(entry.source)
    }
    return { success: true, source, destination, kind: kindOf(sourceInfo), filesMoved }
  } catch (error) {
    return {
      success: false,
      source,
      destination,
      filesMoved,
      partial: destinationCreated,
      sourceExists: await present(source),
      destinationExists: await present(destination),
      error: `${problem(error)}${destinationCreated ? ' Inspect both paths before continuing; the move may be partially complete.' : ''}`,
    }
  }
}

/** Full chat hosts opt in here; a browser worker keeps createFileTools and its restricted reader only. */
export function createChatFileTools(options: Omit<FileToolsOptions, 'allowedRoot'>) {
  return {
    ...createFileTools(options),
    find_downloads: tool({
      description:
        'Find local downloads before declaring a browser download missing. Reads the selected browser’s configured download folder and checks it plus Desktop, Downloads, and any additional task/destination folders you supply. Searches direct children only, without reading file contents or following child symlinks. Returns newest candidates first, incomplete downloads marked separately, checked folders, access errors, and nextOffset. Use read_file to verify candidates before organizing them. If results are truncated, narrow the filters; never infer disk-wide absence from an incomplete search.',
      inputSchema: z.object({
        directories: z
          .array(filePath)
          .max(20)
          .optional()
          .describe('Additional task and destination folders, plus any save location named by the user or browser.'),
        nameContains: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .describe('Optional case-insensitive filename fragment. Omit if the website may use an unfamiliar filename.'),
        extensions: z
          .array(z.string().regex(/^\.?[A-Za-z0-9]{1,16}$/))
          .max(20)
          .optional()
          .describe('Optional file types such as pdf or csv; partial downloads of these types are also returned.'),
        modifiedSince: z
          .string()
          .optional()
          .describe('Optional ISO timestamp including timezone. Omit to include files from earlier attempts.'),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
      execute: (input: Parameters<typeof findDownloads>[0], execution?: { abortSignal?: AbortSignal }) =>
        findDownloads(input, options.cwd, execution?.abortSignal),
    }),
    list_directory: tool({
      description:
        'List an actual local folder before organizing its contents. Returns file/folder paths and sizes, with nextOffset for more entries. Does not read file contents or follow child symlinks. Use paths named by the user or returned by earlier tools.',
      inputSchema: z.object({
        path: filePath,
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
      execute: (input: Parameters<typeof listDirectory>[0], execution?: { abortSignal?: AbortSignal }) =>
        listDirectory(input, options.cwd, execution?.abortSignal),
    }),
    create_directory: tool({
      description:
        'Create a local folder and its missing parents for the user’s requested work. An existing folder is left in place. Returns the actual path. No shell command or extra confirmation is needed for an already requested folder.',
      inputSchema: z.object({ path: filePath }),
      execute: (input: Parameters<typeof createDirectory>[0], execution?: { abortSignal?: AbortSignal }) =>
        createDirectory(input, options.cwd, execution?.abortSignal),
    }),
    move_path: tool({
      description:
        'Move or rename a local file or folder for the user’s requested work. Destination is the exact new path, including its filename or folder name; missing parents are created. Refuses existing destinations, overwrites, merges, symlinks, and moves into the source itself. List folders first, move only authorized items, and inspect both paths after a partial failure. Returns the verified final path and count. Moving a file does not prove it was uploaded.',
      inputSchema: z.object({ source: filePath, destination: filePath }),
      execute: (input: Parameters<typeof movePath>[0], execution?: { abortSignal?: AbortSignal }) =>
        movePath(input, options.cwd, execution?.abortSignal),
    }),
  }
}
