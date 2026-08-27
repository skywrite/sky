import Document from '#shared/models/Markdown/Document/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { parseTrigger, type Trigger } from './trigger.ts'

/*
  An automation charter: one markdown file declaring work the system does on
  its owner's behalf.

    ---
    run: google:email:inbox:fetch
    every: 5m
    args:
      label: Sky/Follow
    status: active
    ---

    Why this matters, and what a good outcome looks like.

  Frontmatter is the whole machine surface. The body is a brief: documentation
  for a mechanical job, and the actual instructions for an agentic one, which is
  why the model keeps it rather than discarding it.
*/

export type AutomationStatus = 'active' | 'paused'

const STATUSES = new Set<string>(['active', 'paused'])

/**
 * Keys a charter may carry. The trigger keys are validated by parseTrigger;
 * created/updated/tags/rel are corpus-wide document conventions rather than
 * anything this model reads.
 */
const KNOWN_KEYS = new Set(['run', 'every', 'at', 'tz', 'status', 'until', 'args', 'created', 'updated', 'tags', 'rel'])

/** A charter could not be read; the message is meant for the person who wrote it */
export class AutomationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AutomationError'
  }
}

function parseRun(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AutomationError('run: needs a command name, like day:start')
  }
  const run = value.trim()
  if (/\s/.test(run)) {
    throw new AutomationError(`run: "${run}" should be a command name alone — put flags in args:`)
  }
  return run
}

function parseStatus(value: unknown): AutomationStatus {
  if (value === undefined || value === null) return 'active'
  if (typeof value !== 'string' || !STATUSES.has(value.trim().toLowerCase())) {
    throw new AutomationError(`status: ${String(value)} is not one of active, paused`)
  }
  return value.trim().toLowerCase() as AutomationStatus
}

function parseUntil(value: unknown): PlainDate | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !value.trim()) {
    throw new AutomationError('until: needs a date like 2026-12-31')
  }
  try {
    return new PlainDate(value.trim())
  } catch {
    throw new AutomationError(`until: ${value} is not a date (want YYYY-MM-DD)`)
  }
}

function parseArgs(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AutomationError('args: needs a mapping of flag names to values')
  }
  return value as Record<string, unknown>
}

export default class Automation {
  readonly name: string
  readonly run: string
  readonly trigger: Trigger
  readonly status: AutomationStatus
  readonly until: PlainDate | undefined
  readonly args: Record<string, unknown>
  /** The prose body, verbatim — a brief for whatever `run` points at */
  readonly brief: string
  /**
   * Frontmatter keys this model does not read. A misspelled key would otherwise
   * change behavior in silence: `timezone:` instead of `tz:` leaves a charter on
   * notebook time while looking zoned. Surfaced rather than thrown so one typo
   * does not stop a charter that is otherwise fine.
   */
  readonly unknownKeys: string[]

  private constructor(fields: {
    name: string
    run: string
    trigger: Trigger
    status: AutomationStatus
    until: PlainDate | undefined
    args: Record<string, unknown>
    brief: string
    unknownKeys: string[]
  }) {
    this.name = fields.name
    this.run = fields.run
    this.trigger = fields.trigger
    this.status = fields.status
    this.until = fields.until
    this.args = fields.args
    this.brief = fields.brief
    this.unknownKeys = fields.unknownKeys
  }

  /** Throws AutomationError or TriggerError with a message worth showing */
  static fromMarkdown(contents: string, name: string): Automation {
    const doc = Document.fromMarkdown(contents)
    const yaml = doc.yaml

    // Both land as empty frontmatter, so name the actual problem rather than
    // letting the first missing field speak for the whole file.
    if (doc.yamlError) {
      throw new AutomationError(`Frontmatter is not valid YAML: ${doc.yamlError}`)
    }
    if (!Object.keys(yaml).length) {
      throw new AutomationError('Needs frontmatter carrying run: and a trigger')
    }

    return new Automation({
      name,
      run: parseRun(yaml.run),
      trigger: parseTrigger(yaml),
      status: parseStatus(yaml.status),
      until: parseUntil(yaml.until),
      args: parseArgs(yaml.args),
      brief: doc.markdown.trim(),
      unknownKeys: Object.keys(yaml).filter((key) => !KNOWN_KEYS.has(key)),
    })
  }

  /** Active, and not past the day it was set to stop */
  isRunnable(today: PlainDate): boolean {
    if (this.status !== 'active') return false
    return !this.until || today.ymd <= this.until.ymd
  }
}
