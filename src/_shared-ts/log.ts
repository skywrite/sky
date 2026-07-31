import * as path from 'node:path'
import * as os from 'node:os'
import { mkdirSync } from 'node:fs'
import { getRotatingFileSink } from '@logtape/file'
import { configureSync, getConsoleSink, getLogger, isLogLevel, jsonLinesFormatter, resetSync } from '@logtape/logtape'
import type { LogLevel, LogRecord, Logger, TextFormatter } from '@logtape/logtape'
import { DIR_USER_DATA } from '#config'
import { env } from '#shared/sys/mod.ts'

/**
 * Structured logging for long-running processes.
 *
 * The notebook service used to log with bare `console.log` and hand-written
 * `[subsystem]` prefixes, redirected by launchd to /tmp. That gave us no
 * timestamps at all — a daemon whose failure modes are "when did the timezone
 * flip?" and "how long was the port unbound?" was writing lines that could not
 * answer either — no level control, no rotation, and a file macOS periodically
 * deletes. This routes the same messages into a rotating JSONL file next to
 * the AI error log, with a real timestamp on every record.
 *
 * Nothing imports LogTape directly; everything goes through this module, so
 * swapping the backend stays a one-file change.
 *
 * Inspect with: tail -20 <userDataDir>/logs/service.jsonl | jq
 * Filter to one subsystem: jq 'select(.logger == "sky.heartbeat")'
 */

export const SERVICE_LOG_PATH = path.join(DIR_USER_DATA, 'logs', 'service.jsonl')

/** Home-relative form of the log path for terminal display. */
export const SERVICE_LOG_DISPLAY = SERVICE_LOG_PATH.startsWith(os.homedir())
  ? `~${SERVICE_LOG_PATH.slice(os.homedir().length)}`
  : SERVICE_LOG_PATH

/**
 * Root category. Every logger hangs off this so our records stay separable
 * from LogTape's own `logtape.meta` diagnostics in the same stream.
 */
const ROOT = 'sky'

const DEFAULT_LEVEL: LogLevel = 'info'

/** 5 MiB across 5 files caps the log directory at ~25 MiB. */
const MAX_SIZE = 5 * 1024 * 1024
const MAX_FILES = 5

/**
 * Resolve the configured level. LogTape spells the third level `warning`;
 * `warn` is accepted because that is what everyone types. An unusable value
 * falls back to the default instead of throwing — a typo in an env var must
 * not be the reason the service fails to boot.
 */
export function resolveLevel(raw: string | undefined): LogLevel {
  if (raw == null || raw.trim() === '') return DEFAULT_LEVEL
  const normalized = raw.trim().toLowerCase()
  const candidate = normalized === 'warn' ? 'warning' : normalized
  if (isLogLevel(candidate)) return candidate
  console.warn(`Ignoring SKY_LOG_LEVEL=${JSON.stringify(raw)}; falling back to "${DEFAULT_LEVEL}"`)
  return DEFAULT_LEVEL
}

/**
 * Convert a value into something `JSON.stringify` cannot choke on.
 *
 * `jsonLinesFormatter` stringifies properties directly, so one cyclic object or
 * one BigInt anywhere in the payload throws inside the sink — and LogTape
 * responds by dropping the whole record. Losing a log line because of the shape
 * of a field attached to it is the wrong trade, so anything unserializable is
 * replaced by a marker and the record survives.
 *
 * Errors are rebuilt by hand: their `message` and `stack` are non-enumerable,
 * so the generic object branch would flatten them to `{}` — the exact failure
 * this whole module exists to avoid.
 */
function toJsonSafe(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'symbol') return value.toString()
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  if (value instanceof Date) return value.toISOString()
  seen.add(value)
  try {
    if (value instanceof Error) {
      const serialized: Record<string, unknown> = {
        name: value.name,
        message: value.message,
        stack: value.stack,
      }
      if (value.cause !== undefined) serialized.cause = toJsonSafe(value.cause, seen)
      if (value instanceof AggregateError) {
        serialized.errors = value.errors.map((e: unknown) => toJsonSafe(e, seen))
      }
      return serialized
    }
    if (Array.isArray(value)) return value.map((item) => toJsonSafe(item, seen))
    if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [String(k), toJsonSafe(v, seen)]))
    if (value instanceof Set) return [...value].map((item) => toJsonSafe(item, seen))
    const plain: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) plain[key] = toJsonSafe(item, seen)
    return plain
  } finally {
    // Only ancestors count as cycles; a value repeated across sibling branches
    // should still serialize in full.
    seen.delete(value)
  }
}

/**
 * `jsonLinesFormatter`, but a record whose properties cannot be stringified is
 * degraded rather than discarded.
 */
const safeJsonLinesFormatter: TextFormatter = (record: LogRecord) => {
  try {
    return jsonLinesFormatter(record)
  } catch {
    const properties = toJsonSafe(record.properties, new WeakSet()) as Record<string, unknown>
    try {
      return jsonLinesFormatter({ ...record, properties })
    } catch {
      // Something outside properties is unserializable. Emit a valid line
      // recording that fact rather than losing the event entirely.
      return `${JSON.stringify({
        '@timestamp': new Date(record.timestamp).toISOString(),
        level: record.level === 'warning' ? 'WARN' : record.level.toUpperCase(),
        logger: record.category.join('.'),
        message: '[unserializable log record]',
        properties: {},
      })}\n`
    }
  }
}

export interface LoggingOptions {
  /** Overrides the level that would otherwise come from SKY_LOG_LEVEL. */
  level?: LogLevel
  /** Writes somewhere other than the service log. Tests use this; nothing else should. */
  path?: string
}

let configured = false

/**
 * Install the process-wide logging configuration. Idempotent, so entry points
 * may call it defensively; the first call wins.
 *
 * Buffering is disabled (`bufferSize: 0`) so every record hits the file as it
 * is written. The default 8 KiB / 5s buffer would drop the last few seconds of
 * output on a crash, which is the output most worth having.
 */
export function configureLogging(options: LoggingOptions = {}): void {
  if (configured) return
  const destination = options.path ?? SERVICE_LOG_PATH
  const level = options.level ?? resolveLevel(env.get('SKY_LOG_LEVEL'))
  mkdirSync(path.dirname(destination), { recursive: true })
  configureSync({
    sinks: {
      file: getRotatingFileSink(destination, {
        formatter: safeJsonLinesFormatter,
        maxSize: MAX_SIZE,
        maxFiles: MAX_FILES,
        bufferSize: 0,
      }),
      console: getConsoleSink(),
    },
    loggers: [
      { category: [ROOT], sinks: ['file'], lowestLevel: level },
      // LogTape reports its own failures here — a full disk, an unwritable
      // path. Those must not go to the file sink, since the file sink is what
      // they are about; stderr is the one place still guaranteed to work.
      { category: ['logtape', 'meta'], sinks: ['console'], lowestLevel: 'warning' },
    ],
    reset: true,
  })
  configured = true
}

/** Tear the configuration down so a test can install a fresh one. Test-facing. */
export function resetLogging(): void {
  resetSync()
  configured = false
}

/**
 * Logger for one subsystem: `logger('heartbeat')` replaces a hand-written
 * `[heartbeat]` prefix and becomes a queryable `sky.heartbeat` category.
 *
 * Pass an Error straight in — `log.error(err)` keeps the stack and the whole
 * `cause` chain — or attach structured fields with
 * `log.info('Checked {count} follow(s)', { count })`.
 */
export function logger(...subsystem: string[]): Logger {
  return getLogger([ROOT, ...subsystem])
}
