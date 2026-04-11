import { readFile } from 'node:fs/promises'

export default async function readTextFile(path: string): Promise<string> {
  return readFile(path, 'utf-8')
}
