import * as path from 'node:path'
import { readDir } from '#shared/fs/mod.ts'
import { toNotebookRelativePath } from './request.ts'
import type { MarkdownExplorerDirectory, MarkdownExplorerNode } from './types.ts'

export async function buildMarkdownExplorerTree(
  markdownBaseDir: string,
  markdownDirs: string[],
  currentRelativePath: string,
): Promise<MarkdownExplorerDirectory[]> {
  const roots = await Promise.all(
    markdownDirs.map(async (rootDir) => {
      return await buildExplorerDirectoryNode(markdownBaseDir, rootDir, currentRelativePath)
    }),
  )

  return roots.filter((node): node is MarkdownExplorerDirectory => node !== null)
}

async function buildExplorerDirectoryNode(
  markdownBaseDir: string,
  directoryPath: string,
  currentRelativePath: string,
): Promise<MarkdownExplorerDirectory | null> {
  const relativePath = toNotebookRelativePath(markdownBaseDir, directoryPath)
  const children: MarkdownExplorerNode[] = []

  try {
    for await (const entry of readDir(directoryPath)) {
      if (shouldIgnoreExplorerEntry(entry.name)) continue

      const entryPath = path.join(directoryPath, entry.name)
      if (entry.isDirectory) {
        const childDirectory = await buildExplorerDirectoryNode(markdownBaseDir, entryPath, currentRelativePath)
        if (childDirectory) children.push(childDirectory)
        continue
      }

      if (entry.isFile && path.extname(entry.name).toLowerCase() === '.md') {
        const childRelativePath = toNotebookRelativePath(markdownBaseDir, entryPath)
        children.push({
          type: 'file',
          name: entry.name,
          relativePath: childRelativePath,
          isCurrent: childRelativePath === currentRelativePath,
        })
      }
    }
  } catch (err) {
    const error = err as NodeJS.ErrnoException
    if (error?.code === 'ENOENT') return null
    throw err
  }

  children.sort(compareExplorerNodes)

  if (children.length === 0) return null

  return {
    type: 'directory',
    name: path.basename(directoryPath),
    relativePath,
    isCurrentBranch: isCurrentBranchPath(relativePath, currentRelativePath),
    children,
  }
}

function compareExplorerNodes(a: MarkdownExplorerNode, b: MarkdownExplorerNode): number {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

function shouldIgnoreExplorerEntry(name: string): boolean {
  return name.startsWith('.')
}

function isCurrentBranchPath(directoryRelativePath: string, currentRelativePath: string): boolean {
  return currentRelativePath === directoryRelativePath || currentRelativePath.startsWith(`${directoryRelativePath}/`)
}
