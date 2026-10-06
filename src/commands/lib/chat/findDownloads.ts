import { lstat, readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { discoverDownloadLocations, type DownloadLocation } from '#lib/browser/downloadLocations.ts'
import { Instant } from '#universal/dates/nbdt/mod.ts'
import { resolveFilePath } from './fileTools.ts'

export interface FindDownloadsInput {
  directories?: string[]
  nameContains?: string
  extensions?: string[]
  modifiedSince?: string
  offset?: number
  limit?: number
}

interface DownloadCandidate {
  path: string
  name: string
  bytes: number
  modifiedAt: string
  state: 'candidate' | 'incomplete'
}

interface CheckedDirectory extends DownloadLocation {
  status: 'checked' | 'missing' | 'unavailable'
  entriesExamined: number
  truncated: boolean
  entryErrors: number
  error?: string
}

const PARTIAL_SUFFIX = /\.(crdownload|part|partial|download)$/i
const MAX_ENTRIES = 10_000

function folderError(error: unknown): string {
  switch ((error as NodeJS.ErrnoException).code) {
    case 'ENOENT':
      return 'This folder does not exist.'
    case 'EACCES':
    case 'EPERM':
      return 'Sky could not access this folder. Check the operating system permissions for the app running Sky.'
    case 'ENOTDIR':
      return 'This path is a file, not a folder.'
    default:
      return 'Sky could not read this folder.'
  }
}

/** Metadata only. Candidates still need read_file verification before being used or moved. */
export async function findDownloads(
  input: FindDownloadsInput,
  cwd: string,
  signal?: AbortSignal,
  discover = discoverDownloadLocations,
) {
  try {
    signal?.throwIfAborted()
    const since = input.modifiedSince ? Instant.from(input.modifiedSince).epochMilliseconds : undefined
    const directories = (input.directories ?? []).map((given) => {
      if (!given.trim() || given.includes('\0')) throw new Error('Name a nonempty local folder path.')
      return resolveFilePath(given, cwd)
    })
    const discovered = await discover(directories)
    const checkedDirectories: CheckedDirectory[] = []
    const candidates: (DownloadCandidate & { mtimeMs: number })[] = []
    const extensions = input.extensions?.map((extension) => `.${extension.replace(/^\./, '').toLowerCase()}`)
    const nameContains = input.nameContains?.toLowerCase()
    for (const location of discovered.locations) {
      signal?.throwIfAborted()
      const checked: CheckedDirectory = {
        ...location,
        status: 'checked',
        entriesExamined: 0,
        truncated: false,
        entryErrors: 0,
      }
      checkedDirectories.push(checked)
      try {
        const names = (await readdir(location.path))
          .filter((name) => {
            const finishedName = name.replace(PARTIAL_SUFFIX, '')
            return (
              (!nameContains || name.toLowerCase().includes(nameContains)) &&
              (!extensions?.length || extensions.includes(path.extname(finishedName).toLowerCase()))
            )
          })
          .sort()
        checked.truncated = names.length > MAX_ENTRIES
        for (const name of names.slice(0, MAX_ENTRIES)) {
          signal?.throwIfAborted()
          checked.entriesExamined++
          const filePath = path.join(location.path, name)
          try {
            const info = await lstat(filePath)
            const partial = PARTIAL_SUFFIX.test(name)
            if (!info.isFile() && !(partial && info.isDirectory())) continue
            if (since !== undefined && info.mtimeMs < since) continue
            candidates.push({
              name,
              path: filePath,
              bytes: info.size,
              mtimeMs: info.mtimeMs,
              modifiedAt: Instant.fromEpochMilliseconds(Math.trunc(info.mtimeMs)).toString(),
              state: partial || info.size === 0 ? 'incomplete' : 'candidate',
            })
          } catch {
            checked.entryErrors++
          }
        }
      } catch (error) {
        signal?.throwIfAborted()
        checked.status = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable'
        checked.error = folderError(error)
      }
    }
    signal?.throwIfAborted()
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path))
    const offset = input.offset ?? 0
    const matches = candidates
      .slice(offset, offset + Math.min(input.limit ?? 100, 500))
      .map(({ mtimeMs: _, ...file }) => file)
    const next = offset + matches.length
    return {
      success: true as const,
      browser: discovered.browser,
      configuredDirectories: discovered.configuredDirectories,
      issues: discovered.issues,
      checkedDirectories,
      allFoldersChecked: checkedDirectories.every(
        (entry) => entry.status !== 'unavailable' && !entry.truncated && !entry.entryErrors,
      ),
      matches,
      totalMatches: candidates.length,
      nextOffset: next < candidates.length ? next : null,
    }
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Download search could not finish.',
    }
  }
}
