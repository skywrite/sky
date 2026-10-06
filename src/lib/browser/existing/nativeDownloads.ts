import { constants, type Stats } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { PageProtocol } from './connection.ts'

const MAX_BYTES = 100 * 1024 * 1024
const sameFile = (a: Stats, b: Stats) =>
  a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs

function downloadName(actual: string, suggested: string): boolean {
  if (actual === suggested) return true
  const { name, ext } = path.parse(suggested)
  const prefix = `${name} (`
  const suffix = `)${ext}`
  return (
    actual.startsWith(prefix) && actual.endsWith(suffix) && /^\d+$/.test(actual.slice(prefix.length, -suffix.length))
  )
}

interface NativeDownloadOptions {
  directories: readonly string[]
  save(name: string, bytes: Buffer): Promise<void>
  notice(message: string): void
  track(work: Promise<void>): Promise<void>
  timeoutMs?: number
}

/** Page download events bind native files to Sky's own tabs, including downloads response capture misses. */
export class NativeDownloads {
  private readonly directories = new Map<string, { before?: Set<string>; error?: string }>()
  private readonly claimed = new Set<string>()
  private readonly pending = new Map<string, (bytes: number | null) => void>()
  private readonly detach: (() => void)[] = []
  private closed = false

  private constructor(private readonly options: NativeDownloadOptions) {}

  static async create(options: NativeDownloadOptions): Promise<NativeDownloads> {
    const capture = new NativeDownloads(options)
    for (const given of options.directories) {
      const directory = await realpath(given).catch(() => path.resolve(given))
      if (capture.directories.has(directory)) continue
      try {
        capture.directories.set(directory, { before: new Set(await readdir(directory)) })
      } catch (error) {
        // A missing folder may be created by the download; an unreadable baseline cannot identify new files.
        capture.directories.set(
          directory,
          (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? { before: new Set() }
            : { error: 'unavailable at task start' },
        )
      }
    }
    return capture
  }

  attach(protocol: PageProtocol): void {
    const begin = (event: { guid: string; suggestedFilename: string }) => {
      if (this.closed || this.pending.has(event.guid)) return
      const name = path.basename(event.suggestedFilename)
      if (!name || name !== event.suggestedFilename) return
      let done!: (bytes: number | null) => void
      const completed = new Promise<number | null>((resolve) => (done = resolve))
      this.pending.set(event.guid, done)
      const timer = setTimeout(() => done(null), this.options.timeoutMs ?? 20000)
      void this.options.track(
        completed
          .then(async (bytes) => {
            if (this.closed) return
            if (bytes === null) {
              this.options.notice(
                `Browser download notice: Brave started downloading "${name}", but completion was not confirmed. Check Brave's Downloads list before retrying.`,
              )
              return
            }
            try {
              await this.collect(name, bytes)
            } catch {
              const locations = [...this.directories]
                .map(([directory, state]) => `"${directory}"${state.error ? ` (${state.error})` : ''}`)
                .join(', ')
              this.options.notice(
                `Browser download notice: Brave completed "${name}", but Sky could not collect the file. Checked locations: ${locations || 'unavailable'}. Use find_downloads to inspect these and any requested destination before retrying; do not assume the download failed.`,
              )
            }
          })
          .finally(() => {
            clearTimeout(timer)
            this.pending.delete(event.guid)
          }),
      )
    }
    const progress = (event: { guid: string; state: string; receivedBytes: number }) => {
      if (event.state === 'completed') this.pending.get(event.guid)?.(event.receivedBytes)
      else if (event.state === 'canceled') this.pending.get(event.guid)?.(null)
    }
    protocol.on('Page.downloadWillBegin', begin)
    protocol.on('Page.downloadProgress', progress)
    this.detach.push(() => {
      protocol.off('Page.downloadWillBegin', begin)
      protocol.off('Page.downloadProgress', progress)
    })
  }

  close(): void {
    this.closed = true
    for (const stop of this.detach) stop()
    for (const done of this.pending.values()) done(null)
  }

  private async collect(name: string, bytes: number): Promise<void> {
    if (!this.directories.size || bytes <= 0 || bytes > MAX_BYTES) throw new Error('Download unavailable')
    // Chromium can emit completion just before the final filename appears on disk.
    for (let attempt = 0; attempt < 10 && !this.closed; attempt++) {
      const candidates: { name: string; location: string; info: Stats }[] = []
      for (const [directory, state] of this.directories) {
        if (!state.before) continue
        try {
          if ((await realpath(directory)) !== directory) throw new Error('Folder changed')
          const names = await readdir(directory)
          state.error = undefined
          for (const candidate of names) {
            const location = path.join(directory, candidate)
            if (state.before.has(candidate) || this.claimed.has(location) || !downloadName(candidate, name)) continue
            const info = await lstat(location).catch(() => undefined)
            if (info?.isFile() && info.size === bytes) candidates.push({ name: candidate, location, info })
          }
        } catch (error) {
          state.error = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'folder missing' : 'folder unavailable'
        }
      }
      if (candidates.length > 1) throw new Error('Ambiguous download')
      if (candidates.length === 1) {
        const candidate = candidates[0]
        this.claimed.add(candidate.location)
        const file = await open(candidate.location, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          if (!sameFile(candidate.info, await file.stat())) throw new Error('Download changed')
          const body = Buffer.alloc(bytes)
          let offset = 0
          while (offset < bytes) {
            const read = await file.read(body, offset, bytes - offset, offset)
            if (!read.bytesRead) throw new Error('Incomplete download')
            offset += read.bytesRead
          }
          if (!sameFile(candidate.info, await file.stat())) throw new Error('Download changed')
          if (!this.closed) await this.options.save(candidate.name, body)
        } finally {
          await file.close()
        }
        return
      }
      await delay(100)
    }
    if (!this.closed) throw new Error('Download not located')
  }
}
