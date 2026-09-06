import { readDir } from '#shared/fs/mod.ts'

/** The project completion list: visible folders directly inside projects/open. */
export default async function openProjectNames(openDir: string): Promise<string[]> {
  const names: string[] = []
  try {
    for await (const entry of readDir(openDir)) {
      if (entry.isDirectory && !entry.name.startsWith('.')) names.push(entry.name)
    }
  } catch {
    return []
  }
  return names
}
