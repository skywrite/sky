import { DIR_STATE_FOLLOW_EMAIL_ACTIVE, DIR_STATE_FOLLOW_EMAIL_ARCHIVE } from '#config'
import { exists } from '#shared/fs/mod.ts'
import type { StoreError } from '../Store/types.ts'
import { loadFollowDir, type FollowFileEntry } from './loadFollowDir.ts'

export interface EmailFollowEntry {
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

  /** Capture history survives closure. Active copies win if a move was interrupted. */
  static async buildWithArchive(
    activeDir = DIR_STATE_FOLLOW_EMAIL_ACTIVE,
    archiveDir = DIR_STATE_FOLLOW_EMAIL_ARCHIVE,
  ): Promise<EmailFollowRegistry> {
    const [active, archive] = await Promise.all([this.build(activeDir), this.build(archiveDir)])
    return new EmailFollowRegistry(new Map([...archive.byFile, ...active.byFile]), [
      ...archive.errors,
      ...active.errors,
    ])
  }

  getAll(): EmailFollowEntry[] {
    return Array.from(this.byFile.entries()).map(([fileName, { follow, path: filePath }]) => ({
      follow,
      path: filePath,
      fileName,
    }))
  }

  getActive(): EmailFollowEntry[] {
    return this.getAll().filter((e) => e.follow.status === 'active')
  }

  findByFileName(name: string): FollowFileEntry | undefined {
    return this.byFile.get(name)
  }

  findByThreadId(threadId: string, account?: string): EmailFollowEntry | undefined {
    const matches = this.getAll().filter(
      (e) =>
        e.follow.ref.threadId === threadId &&
        (!account || e.follow.ref.account?.toLowerCase() === account.toLowerCase()),
    )
    // Older releases could start another follow for the same thread. Prefer
    // its current watch, then the archive with the latest capture cutoff.
    return matches.sort(
      (a, b) =>
        Number(b.follow.status === 'active') - Number(a.follow.status === 'active') ||
        (b.follow.lastActivity?.toString() ?? '').localeCompare(a.follow.lastActivity?.toString() ?? ''),
    )[0]
  }

  get size(): number {
    return this.byFile.size
  }

  get errors(): StoreError[] {
    return this._errors
  }
}
