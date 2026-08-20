import ms from 'ms'
import { DIR_STATE_FOLLOW_SLACK_ACTIVE } from '#config'
import { exists } from '#shared/fs/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { StoreError } from '../Store/types.ts'
import { loadFollowDir, type FollowFileEntry } from './loadFollowDir.ts'

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

  /**
   * Find the follow tracking a thread, identified by channel + root ts —
   * never by link strings, since one thread wears many URLs. ref.thread_ts is
   * authoritative when present; a follow created before its thread had
   * replies stores none, so its root is the message ts in ref.link (…/p<ts>).
   */
  findByThreadRoot(channel: string, rootTs: string): SlackFollowEntry | undefined {
    const rootDigits = rootTs.replace('.', '')
    return this.getAll().find(({ follow }) => {
      if (follow.ref.channel !== channel) return false
      if (follow.ref.thread_ts) return follow.ref.thread_ts === rootTs
      return follow.ref.link?.match(/\/p(\d{10,})(?:[?#]|$)/)?.[1] === rootDigits
    })
  }

  get size(): number {
    return this.byFile.size
  }

  get errors(): StoreError[] {
    return this._errors
  }
}
