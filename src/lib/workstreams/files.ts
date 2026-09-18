import { lstat } from 'node:fs/promises'
import * as path from 'node:path'
import { missing, notebookFile } from '#lib/outbox/files.ts'
import { WorkstreamError } from './types.ts'

/** New files need the same ancestor check as existing sources; a symlinked folder is not local scope. */
export async function workstreamFile(root: string, file: string): Promise<string> {
  const absolute = path.resolve(file)
  const relative = path.relative(path.resolve(root), absolute)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new WorkstreamError('This file must stay inside its workstream storage root.')
  let cursor = path.resolve(root)
  for (const component of relative.split(path.sep)) {
    cursor = path.join(cursor, component)
    try {
      if ((await lstat(cursor)).isSymbolicLink())
        throw new WorkstreamError('Workstream files cannot follow symbolic links.')
    } catch (error) {
      if (!missing(error)) throw error
    }
  }
  return absolute
}

/** Logical workstream references keep their names when owned content moves out of the notebook. */
export function workstreamPathRoot(notebookRoot: string, contentRoot: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some((part) => part === '..'))
    throw new WorkstreamError('Choose a file using a relative path without traversal.')
  const normalized = path.normalize(relative)
  return normalized.startsWith(`workstreams${path.sep}`) ? contentRoot : notebookRoot
}

export async function resolveWorkstreamFile(
  notebookRoot: string,
  contentRoot: string,
  relative: string,
): Promise<string> {
  return notebookFile(workstreamPathRoot(notebookRoot, contentRoot, relative), relative)
}
