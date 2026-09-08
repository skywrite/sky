import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import type { CalendarFields } from './types.ts'
import type { CalendarEventSnapshot } from './updateTypes.ts'

interface SavedDraft {
  fields: CalendarFields
  reviewKey: string
  update?: CalendarEventSnapshot
  /** The exact review presented by chat and voice, including conflicts and assumptions. */
  summary?: string
}

/** Immutable prepared invitations. Sending uses these exact fields without another model call. */
export class CalendarDrafts {
  private readonly dir: string

  constructor(dir: string) {
    this.dir = path.join(dir, 'drafts')
  }

  private file(id: string): string {
    z.uuid().parse(id)
    return path.join(this.dir, `${id}.json`)
  }

  async save(draft: SavedDraft): Promise<string> {
    await mkdir(this.dir, { recursive: true })
    const id = crypto.randomUUID()
    const target = this.file(id)
    const temporary = `${target}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(draft), { flag: 'wx', mode: 0o600 })
      await link(temporary, target)
    } finally {
      await rm(temporary, { force: true })
    }
    return id
  }

  async get(id: string): Promise<SavedDraft> {
    try {
      return JSON.parse(await readFile(this.file(id), 'utf8')) as SavedDraft
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error('Prepared invitation not found. Prepare it again with calendar:schedule.')
      throw error
    }
  }
}
