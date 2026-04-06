import * as path from 'node:path'
import { mkdir } from 'node:fs/promises'
import writeTextFile from './writeTextFile.ts'

export default async function outputFile(file: string, data: string): Promise<void> {
  const dir = path.dirname(file)
  await mkdir(dir, { recursive: true })

  await writeTextFile(file, data)
}
