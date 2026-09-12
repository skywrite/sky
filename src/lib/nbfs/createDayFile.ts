import { randomUUID } from 'node:crypto'
import { link, mkdir, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { atomicWrite } from '#lib/outbox/files.ts'

/** Publish a complete canonical day file without overwriting or creating a day-2.md. */
export async function createDayFile(file: string, content: string): Promise<boolean> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await atomicWrite(temporary, content)
    try {
      await link(temporary, file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw error
    }
    return true
  } finally {
    await unlink(temporary).catch(() => {})
  }
}
