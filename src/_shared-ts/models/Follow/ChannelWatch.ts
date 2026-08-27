import * as path from 'node:path'
import ms from 'ms'
import { exists, readTextFile, walk } from '#shared/fs/mod.ts'
import { parse, stringify } from '#shared/yaml/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { StoreError } from '../Store/types.ts'

const YAML_KEY_ORDER = [
  'source',
  'channel',
  'workspaceUrl',
  'label',
  'checkInterval',
  'watchSince',
  'lastChecked',
  'lastSeenTs',
  'status',
]

type ChannelWatchStatus = 'active' | 'paused'

interface ChannelWatchCreateFields {
  channel: string
  workspaceUrl: string
  label: string
  checkInterval?: string
  watchSince?: PlainDateTime
  lastChecked?: PlainDateTime
  lastSeenTs: string
  status?: ChannelWatchStatus
}

function parseDateTimeField(value: unknown): PlainDateTime | undefined {
  if (typeof value === 'string' && value.trim()) {
    return PlainDateTime.fromString(value)
  }
  return undefined
}

function formatDateTime(dt: PlainDateTime): string {
  return `${dt.date} ${dt.time}`
}

/**
 * A standing watch on a Slack channel: every new root message it sees is fed
 * to slack:follow:message, which captures it and follows its thread. Unlike a
 * thread Follow, a watch never expires on inactivity and tracks a message-ts
 * cursor (lastSeenTs) instead of diffing replies.
 */
export default class ChannelWatch {
  readonly channel: string
  readonly workspaceUrl: string
  readonly label: string
  readonly checkInterval: string
  readonly watchSince: PlainDateTime | undefined
  readonly lastChecked: PlainDateTime | undefined
  readonly lastSeenTs: string
  readonly status: ChannelWatchStatus

  private constructor(fields: {
    channel: string
    workspaceUrl: string
    label: string
    checkInterval: string
    watchSince: PlainDateTime | undefined
    lastChecked: PlainDateTime | undefined
    lastSeenTs: string
    status: ChannelWatchStatus
  }) {
    this.channel = fields.channel
    this.workspaceUrl = fields.workspaceUrl
    this.label = fields.label
    this.checkInterval = fields.checkInterval
    this.watchSince = fields.watchSince
    this.lastChecked = fields.lastChecked
    this.lastSeenTs = fields.lastSeenTs
    this.status = fields.status
  }

  static fromYaml(yamlStr: string): ChannelWatch {
    const data = parse(yamlStr) as Record<string, unknown>
    return new ChannelWatch({
      channel: (data['channel'] ?? '') as string,
      workspaceUrl: (data['workspaceUrl'] ?? '') as string,
      label: (data['label'] ?? '') as string,
      checkInterval: (data['checkInterval'] ?? ChannelWatch.DEFAULT_INTERVAL) as string,
      watchSince: parseDateTimeField(data['watchSince']),
      lastChecked: parseDateTimeField(data['lastChecked']),
      lastSeenTs: String(data['lastSeenTs'] ?? '0.000000'),
      status: (data['status'] ?? 'active') as ChannelWatchStatus,
    })
  }

  static create(fields: ChannelWatchCreateFields): ChannelWatch {
    return new ChannelWatch({
      channel: fields.channel,
      workspaceUrl: fields.workspaceUrl,
      label: fields.label,
      checkInterval: fields.checkInterval ?? ChannelWatch.DEFAULT_INTERVAL,
      watchSince: fields.watchSince,
      lastChecked: fields.lastChecked,
      lastSeenTs: fields.lastSeenTs,
      status: fields.status ?? 'active',
    })
  }

  toYaml(): string {
    const obj: Record<string, unknown> = {
      source: 'Slack',
      channel: this.channel,
      workspaceUrl: this.workspaceUrl,
      label: this.label,
      checkInterval: this.checkInterval,
      watchSince: this.watchSince ? formatDateTime(this.watchSince) : null,
      lastChecked: this.lastChecked ? formatDateTime(this.lastChecked) : null,
      lastSeenTs: this.lastSeenTs,
      status: this.status,
    }
    return stringify(obj, { keyOrder: YAML_KEY_ORDER })
  }

  updateCursor(lastSeenTs: string, checkedAt: PlainDateTime): ChannelWatch {
    return new ChannelWatch({ ...this.fields(), lastSeenTs, lastChecked: checkedAt })
  }

  isDue(now: PlainDateTime): boolean {
    if (this.status !== 'active') return false
    if (!this.lastChecked) return true
    const intervalMs = ms(this.checkInterval as ms.StringValue)
    if (intervalMs === undefined) return false
    return this.lastChecked.until(now).total('milliseconds') >= intervalMs
  }

  static readonly DEFAULT_INTERVAL = '30m'

  private fields() {
    return {
      channel: this.channel,
      workspaceUrl: this.workspaceUrl,
      label: this.label,
      checkInterval: this.checkInterval,
      watchSince: this.watchSince,
      lastChecked: this.lastChecked,
      lastSeenTs: this.lastSeenTs,
      status: this.status,
    }
  }
}

export interface ChannelWatchEntry {
  watch: ChannelWatch
  path: string
  fileName: string
}

export class ChannelWatchRegistry {
  private entries: ChannelWatchEntry[]
  private _errors: StoreError[]

  private constructor(entries: ChannelWatchEntry[], errors: StoreError[]) {
    this.entries = entries
    this._errors = errors
  }

  static async build(dir: string): Promise<ChannelWatchRegistry> {
    if (!(await exists(dir))) return new ChannelWatchRegistry([], [])
    const entries: ChannelWatchEntry[] = []
    const errors: StoreError[] = []
    for await (const entry of walk(dir, { exts: ['.yaml', '.yml'], includeDirs: false })) {
      try {
        const watch = ChannelWatch.fromYaml(await readTextFile(entry.path))
        entries.push({ watch, path: entry.path, fileName: path.basename(entry.path, path.extname(entry.path)) })
      } catch (err) {
        errors.push({ path: entry.path, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return new ChannelWatchRegistry(entries, errors)
  }

  get size(): number {
    return this.entries.length
  }

  get errors(): StoreError[] {
    return this._errors
  }

  getAll(): ChannelWatchEntry[] {
    return [...this.entries]
  }

  getDue(now: PlainDateTime): ChannelWatchEntry[] {
    return this.entries.filter((e) => e.watch.isDue(now))
  }

  findByChannel(channelId: string): ChannelWatchEntry | undefined {
    return this.entries.find((e) => e.watch.channel === channelId)
  }
}
