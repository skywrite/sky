import { parse, stringify } from '#shared/yaml/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { MediumMessage } from '#shared/models/Message/document/mod.ts'

const YAML_KEY_ORDER = [
  'source',
  'ref',
  'summary',
  'checkInterval',
  'followSince',
  'expires',
  'lastChecked',
  'lastActivity',
  'messages',
  'status',
]

type FollowStatus = 'active' | 'paused'

export type FollowMessage = { date: string; path: string }

interface FollowCreateFields {
  source: MediumMessage
  ref: Record<string, string>
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

  /** Compute the check interval based on time since last activity */
  static backoffInterval(now: PlainDateTime, anchor: PlainDateTime | undefined): string {
    if (!anchor) return '10m'
    const HOUR = 3_600_000
    const DAY = 24 * HOUR
    const inactiveMs = Math.max(0, now.toTimeDateValue().getTime() - anchor.toTimeDateValue().getTime())
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
