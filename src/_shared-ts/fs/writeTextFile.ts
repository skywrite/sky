import { writeFile } from 'node:fs/promises'

export default async function writeTextFile(path: string, data: string): Promise<void> {
  await writeFile(path, data, 'utf-8')
}
