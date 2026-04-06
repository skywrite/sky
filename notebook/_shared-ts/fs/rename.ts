import { rename as nodeRename } from 'node:fs/promises'

export default async function rename(oldPath: string, newPath: string): Promise<void> {
  await nodeRename(oldPath, newPath)
}
