import ms from 'ms'
import type { MediumMessage } from '#shared/models/Message/document/mod.ts'
import { parse, stringify } from '#shared/yaml/mod.ts'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'

const YAML_KEY_ORDER = [
  'source',
  'ref',
  'merged',
  'summary',
  'checkInterval',
  'followSince',
  'expires',
  'lastChecked',
  'lastActivity',
  'messages',
  'status',
]

type FollowStatus = 'active' | 'paused' | 'closed'

export type FollowMessage = { date: string; path: string }

interface FollowCreateFields {
  source: MediumMessage
  ref: Record<string, string>
  /** Additional anchors this follow watches — a merged conversation spans several roots */
  merged?: Record<string, string>[]
  summary: string
  checkInterval?: string
  followSince?: PlainDateTime
  expires?: PlainDateTime
  lastChecked?: PlainDateTime
  lastActivity?: PlainDateTime
  messages?: FollowMessage[]
  status?: FollowStatus
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

export default class Follow {
  readonly source: MediumMessage
  readonly ref: Record<string, string>
  readonly merged: Record<string, string>[]
  readonly summary: string
  readonly checkInterval: string
  readonly followSince: PlainDateTime | undefined
  readonly expires: PlainDateTime | undefined
  readonly lastChecked: PlainDateTime | undefined
  readonly lastActivity: PlainDateTime | undefined
  readonly messages: FollowMessage[]
  readonly status: FollowStatus

  private constructor(fields: {
    source: MediumMessage
    ref: Record<string, string>
    merged: Record<string, string>[]
    summary: string
    checkInterval: string
    followSince: PlainDateTime | undefined
    expires: PlainDateTime | undefined
    lastChecked: PlainDateTime | undefined
    lastActivity: PlainDateTime | undefined
    messages: FollowMessage[]
    status: FollowStatus
  }) {
    this.source = fields.source
    this.ref = fields.ref
    this.merged = fields.merged
    this.summary = fields.summary
    this.checkInterval = fields.checkInterval
    this.followSince = fields.followSince
    this.expires = fields.expires
    this.lastChecked = fields.lastChecked
    this.lastActivity = fields.lastActivity
    this.messages = fields.messages
    this.status = fields.status
  }

  static fromYaml(yamlStr: string): Follow {
    const data = parse(yamlStr) as Record<string, unknown>

    return new Follow({
      source: (data['source'] ?? '') as MediumMessage,
      ref: (data['ref'] ?? {}) as Record<string, string>,
      merged: Array.isArray(data['merged']) ? (data['merged'] as Record<string, string>[]) : [],
      summary: (data['summary'] ?? '') as string,
      checkInterval: (data['checkInterval'] ?? '10m') as string,
      followSince: parseDateTimeField(data['followSince']),
      expires: parseDateTimeField(data['expires']),
      lastChecked: parseDateTimeField(data['lastChecked']),
      lastActivity: parseDateTimeField(data['lastActivity']),
      messages: Array.isArray(data['messages']) ? (data['messages'] as FollowMessage[]) : [],
      status: (data['status'] ?? 'active') as FollowStatus,
    })
  }

  static create(fields: FollowCreateFields): Follow {
    return new Follow({
      source: fields.source,
      ref: fields.ref,
      merged: fields.merged ?? [],
      summary: fields.summary,
      checkInterval: fields.checkInterval ?? '10m',
      followSince: fields.followSince,
      expires: fields.expires,
      lastChecked: fields.lastChecked,
      lastActivity: fields.lastActivity,
      messages: fields.messages ?? [],
      status: fields.status ?? 'active',
    })
  }

  toYaml(): string {
    const obj: Record<string, unknown> = {
      source: this.source,
      ref: this.ref,
      merged: this.merged.length > 0 ? this.merged : null,
      summary: this.summary,
      checkInterval: this.checkInterval,
      followSince: this.followSince ? formatDateTime(this.followSince) : null,
      expires: this.expires ? formatDateTime(this.expires) : null,
      lastChecked: this.lastChecked ? formatDateTime(this.lastChecked) : null,
      lastActivity: this.lastActivity ? formatDateTime(this.lastActivity) : null,
      messages: this.messages.length > 0 ? this.messages : null,
      status: this.status,
    }

    return stringify(obj, { keyOrder: YAML_KEY_ORDER })
  }

  updateLastChecked(dt: PlainDateTime): Follow {
    return new Follow({ ...this.fields(), lastChecked: dt })
  }

  updateLastActivity(dt: PlainDateTime): Follow {
    return new Follow({ ...this.fields(), lastActivity: dt })
  }

  updateStatus(status: FollowStatus): Follow {
    return new Follow({ ...this.fields(), status })
  }

  addMessage(date: string, msgPath: string): Follow {
    return new Follow({ ...this.fields(), messages: [...this.messages, { date, path: msgPath }] })
  }

  updateCheckInterval(interval: string): Follow {
    return new Follow({ ...this.fields(), checkInterval: interval })
  }

  withRef(ref: Record<string, string>): Follow {
    return new Follow({ ...this.fields(), ref })
  }

  withMerged(merged: Record<string, string>[]): Follow {
    return new Follow({ ...this.fields(), merged })
  }

  withMessages(messages: FollowMessage[]): Follow {
    return new Follow({ ...this.fields(), messages })
  }

  /** Inactivity window after which a follow with no explicit `expires` auto-expires */
  static readonly DEFAULT_MAX_INACTIVE = '14d'

  /**
   * Milliseconds since the last sign of life. Anchored on the last saved
   * message's date (day granularity — matches what follow:list shows), falling
   * back to lastActivity/followSince. Infinity when no anchor exists at all,
   * since such a follow can never become active on its own.
   */
  inactivityMs(now: PlainDateTime): number {
    const lastMsgDate = this.messages.at(-1)?.date
    if (lastMsgDate) {
      const msgMs = PlainDate.fromString(lastMsgDate).toDate().getTime()
      const todayMs = now.plainDate.toDate().getTime()
      return Math.max(0, todayMs - msgMs)
    }
    const anchor = this.lastActivity ?? this.followSince
    if (!anchor) return Infinity
    return Math.max(0, anchor.until(now).total('milliseconds'))
  }

  /**
   * Whether this follow should be closed. An explicit `expires` deadline alone
   * governs when set — a far-future expires deliberately keeps a slow thread
   * alive past the default inactivity window.
   */
  isExpired(now: PlainDateTime, maxInactive: string = Follow.DEFAULT_MAX_INACTIVE): boolean {
    if (this.expires) {
      return this.expires.until(now).total('milliseconds') >= 0
    }
    const maxMs = ms(maxInactive as ms.StringValue)
    if (maxMs === undefined) return false
    return this.inactivityMs(now) >= maxMs
  }

  /** Compute the check interval based on time since last activity */
  static backoffInterval(now: PlainDateTime, anchor: PlainDateTime | undefined): string {
    if (!anchor) return '10m'
    const HOUR = 3_600_000
    const DAY = 24 * HOUR
    const inactiveMs = Math.max(0, anchor.until(now).total('milliseconds'))
    if (inactiveMs < 1 * HOUR) return '10m'
    if (inactiveMs < 6 * HOUR) return '30m'
    if (inactiveMs < 1 * DAY) return '1h'
    if (inactiveMs < 3 * DAY) return '3h'
    return '12h'
  }

  private fields() {
    return {
      source: this.source,
      ref: this.ref,
      merged: this.merged,
      summary: this.summary,
      checkInterval: this.checkInterval,
      followSince: this.followSince,
      expires: this.expires,
      lastChecked: this.lastChecked,
      lastActivity: this.lastActivity,
      messages: this.messages,
      status: this.status,
    }
  }
}
