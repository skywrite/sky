import ms from 'ms'
import { DIR_STATE_FOLLOW_SLACK_ACTIVE } from '#config'
import { exists } from '#shared/fs/mod.ts'
import { loadFollowDir, type FollowFileEntry } from './loadFollowDir.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { StoreError } from '../Store/types.ts'

interface SlackFollowEntry {
  follow: FollowFileEntry['follow']
  path: string
  fileName: string
}

export default class SlackFollowRegistry {
  private byFile: Map<string, FollowFileEntry>
  private _errors: StoreError[]

  private constructor(byFile: Map<string, FollowFileEntry>, errors: StoreError[]) {
    this.byFile = byFile
    this._errors = errors
  }

  static async build(dir: string = DIR_STATE_FOLLOW_SLACK_ACTIVE): Promise<SlackFollowRegistry> {
    if (!(await exists(dir))) {
      return new SlackFollowRegistry(new Map(), [])
    }

    const { byFile, errors } = await loadFollowDir(dir)

    // Defensive: drop anything that isn't a Slack follow (the dir should only hold slack).
    for (const [name, entry] of byFile) {
      if (entry.follow.source !== 'Slack') byFile.delete(name)
    }

    return new SlackFollowRegistry(byFile, errors)
  }

  getAll(): SlackFollowEntry[] {
    return Array.from(this.byFile.entries()).map(([fileName, { follow, path: filePath }]) => ({
      follow,
      path: filePath,
      fileName,
    }))
  }

  getActive(): SlackFollowEntry[] {
    return this.getAll().filter((e) => e.follow.status === 'active')
  }

  getDue(now: PlainDateTime): SlackFollowEntry[] {
    return this.getActive().filter((e) => {
      const { follow } = e
      if (!follow.lastChecked) return true

      const intervalMs = ms(follow.checkInterval as ms.StringValue)
      if (intervalMs === undefined) return false

      const lastCheckedMs = follow.lastChecked.toTimeDateValue().getTime()
      const nowMs = now.toTimeDateValue().getTime()
      return nowMs - lastCheckedMs >= intervalMs
    })
  }

  findByFileName(name: string): FollowFileEntry | undefined {
    return this.byFile.get(name)
  }

  get size(): number {
    return this.byFile.size
  }

  get errors(): StoreError[] {
    return this._errors
  }
}
