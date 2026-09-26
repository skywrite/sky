import { mkdir, readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { createDayFile } from './createDayFile.ts'

/**
 * Create `<stem>.md` in `dir`, or `<stem>-2.md`, `<stem>-3.md`… when that name is taken, compared
 * case-insensitively. Never overwrites a file. Returns the path it created.
 */
export async function createNumberedFile(dir: string, stem: string, content: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const taken = new Set((await readdir(dir)).map((name) => name.toLowerCase()))
  for (let n = 1; n < 10_000; n++) {
    const name = `${stem}${n === 1 ? '' : `-${n}`}.md`
    if (taken.has(name.toLowerCase())) continue
    const file = path.join(dir, name)
    if (await createDayFile(file, content)) return file
  }
  throw new Error(`No free file name for ${stem} in ${dir}`)
}
