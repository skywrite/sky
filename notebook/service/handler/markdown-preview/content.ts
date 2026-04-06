import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'

export interface MarkdownContentSnapshot {
  content: string
  version: number
}

export class MarkdownSaveConflictError extends Error {
  readonly currentContent: string
  readonly currentVersion: number

  constructor(snapshot: MarkdownContentSnapshot) {
    super('Markdown file changed on disk')
    this.name = 'MarkdownSaveConflictError'
    this.currentContent = snapshot.content
    this.currentVersion = snapshot.version
  }
}

export async function readMarkdownContent(filePath: string): Promise<MarkdownContentSnapshot> {
  const content = await readTextFile(filePath)
  const version = computeMarkdownVersion(content)
  return { content, version }
}

export async function saveMarkdownContent(
  filePath: string,
  content: string,
  expectedVersion?: number,
  force = false,
): Promise<MarkdownContentSnapshot> {
  const current = await readMarkdownContent(filePath)
  if (!force && expectedVersion != null && current.version !== expectedVersion) {
    throw new MarkdownSaveConflictError(current)
  }

  await writeTextFile(filePath, content)
  return await readMarkdownContent(filePath)
}

function computeMarkdownVersion(content: string): number {
  let hash = 2166136261
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}
