import { DIR_STATE_FOLLOW_EMAIL_ACTIVE } from '#config'
import { exists } from '#shared/fs/mod.ts'
import { loadFollowDir, type FollowFileEntry } from './loadFollowDir.ts'
import type { StoreError } from '../Store/types.ts'

interface EmailFollowEntry {
  follow: FollowFileEntry['follow']
  path: string
  fileName: string
}

export default class EmailFollowRegistry {
  private byFile: Map<string, FollowFileEntry>
  private _errors: StoreError[]

  private constructor(byFile: Map<string, FollowFileEntry>, errors: StoreError[]) {
    this.byFile = byFile
    this._errors = errors
  }

  static async build(dir: string = DIR_STATE_FOLLOW_EMAIL_ACTIVE): Promise<EmailFollowRegistry> {
    if (!(await exists(dir))) {
      return new EmailFollowRegistry(new Map(), [])
    }

    const { byFile, errors } = await loadFollowDir(dir)

    // Defensive: drop anything that isn't an Email follow (the dir should only hold email).
    for (const [name, entry] of byFile) {
      if (entry.follow.source !== 'Email') byFile.delete(name)
    }

    return new EmailFollowRegistry(byFile, errors)
  }

  getAll(): EmailFollowEntry[] {
    return Array.from(this.byFile.entries()).map(([fileName, { follow, path: filePath }]) => ({
      follow,
      path: filePath,
      fileName,
    }))
  }

  findByFileName(name: string): FollowFileEntry | undefined {
    return this.byFile.get(name)
  }

  findByThreadId(threadId: string): EmailFollowEntry | undefined {
    return this.getAll().find((e) => e.follow.ref.threadId === threadId)
  }

  get size(): number {
    return this.byFile.size
  }

  get errors(): StoreError[] {
    return this._errors
  }
}
