import { closeSync, mkdirSync, openSync, readdirSync, statSync, unlinkSync, writeSync } from 'node:fs'
import * as path from 'node:path'
import {
  configureSync,
  getConsoleSink,
  getJsonLinesFormatter,
  getLogger,
  isLogLevel,
  resetSync,
} from '@logtape/logtape'
import type { LogLevel, LogRecord, Logger, Sink, TextFormatter } from '@logtape/logtape'
import { env } from '#shared/sys/mod.ts'

/**
 * Structured logging for sky's long-running processes.
 *
 * The service used to log with bare `console.log` and hand-written
 * `[subsystem]` prefixes through a raw fd redirect — no timestamps, no
 * levels, no structure to query. This module writes wide, structured events
 * to daily JSONL files instead, one stream per process family so concurrent
 * processes never share a file:
 *
 *   service.2026-07-31.jsonl   the launchd daemon
 *   cli.2026-07-31.jsonl       sky commands (short-lived, sometimes concurrent)
 *
 * Files live under `/tmp/sky/logs` — logs are diagnostic exhaust, ephemeral
 * by design: they survive service restarts, accumulate across weeks of
 * uptime, and vanish with /tmp on reboot. That is the accepted contract,
 * matching the per-boot process logs already kept under /tmp; anything that
 * must outlive a reboot belongs in a durable store (the AI error log's
 * pattern), not here. A day's file is immutable once the day ends — nothing
 * is ever renamed, so `tail -f` never breaks and ranged queries are just
 * globs. The sweep bounds growth between reboots: files older than 90 days
 * go first, then oldest-first until the directory fits 500 MiB.
 *
 * Nothing outside this module imports LogTape; swapping the backend stays a
 * one-file change.
 *
 * Inspect:      tail -f /tmp/sky/logs/service.$(date -u +%F).jsonl | jq
 * One subsystem: jq 'select(.logger == "sky.heartbeat")' service.*.jsonl
 * Slow events:   jq 'select(.durationMs > 5000)' service.*.jsonl
 * All streams:   cat *.2026-07-31.jsonl | jq -s 'sort_by(."@timestamp")[]'
 */

/** Process families, each the sole writer of its own daily files. */
export type LogStream = 'service' | 'cli'

// Literal /tmp, not os.tmpdir(): on macOS tmpdir() is the per-user
// /var/folders confetti dir, which the OS actually does age-clean.
export const DIR_LOGS = '/tmp/sky/logs'

/**
 * Root category. Every logger hangs off this so our records stay separable
 * from LogTape's own `logtape.meta` diagnostics.
 */
const ROOT = 'sky'

const DEFAULT_LEVEL: LogLevel = 'info'

/** Sweep thresholds: drop by age first, then oldest-first to fit the cap. */
const RETENTION_DAYS = 90
const MAX_TOTAL_BYTES = 500 * 1024 * 1024

export type { LogLevel, Logger } from '@logtape/logtape'

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

/** The UTC calendar day a record belongs to, and the name of its file. */
function utcDate(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10)
}

/**
 * Convert a value into something `JSON.stringify` cannot choke on.
 *
 * The JSON Lines formatter stringifies properties directly, so one cyclic
 * object or one BigInt anywhere in the payload throws inside the sink — and
 * LogTape responds by dropping the whole record. Losing a log line because of
 * the shape of a field attached to it is the wrong trade, so anything
 * unserializable is replaced by a marker and the record survives.
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
 * Properties are flattened to the top level of each record — wide events make
 * fields the star, and `.durationMs` beats `.properties.durationMs` in every
 * jq query forever after. Flattening means a property could collide with the
 * record's own keys, so those get an underscore prefix instead of silently
 * clobbering the record.
 */
const RESERVED_KEYS = ['@timestamp', 'level', 'logger', 'message']

function guardReservedKeys(properties: Record<string, unknown>): Record<string, unknown> | null {
  let guarded: Record<string, unknown> | null = null
  for (const key of RESERVED_KEYS) {
    if (key in properties) {
      guarded ??= { ...properties }
      guarded[`_${key}`] = guarded[key]
      delete guarded[key]
    }
  }
  return guarded
}

const flatJsonLinesFormatter = getJsonLinesFormatter({ properties: 'flatten' })

/**
 * The flattened JSON Lines formatter, but a record whose properties cannot be
 * stringified is degraded rather than discarded.
 */
export const safeJsonLinesFormatter: TextFormatter = (record: LogRecord) => {
  const guarded = guardReservedKeys(record.properties)
  const rec = guarded ? { ...record, properties: guarded } : record
  try {
    return flatJsonLinesFormatter(rec)
  } catch {
    const properties = toJsonSafe(rec.properties, new WeakSet()) as Record<string, unknown>
    try {
      return flatJsonLinesFormatter({ ...rec, properties })
    } catch {
      // Something outside properties is unserializable. Emit a valid line
      // recording that fact rather than losing the event entirely.
      return `${JSON.stringify({
        '@timestamp': new Date(rec.timestamp).toISOString(),
        level: rec.level === 'warning' ? 'WARN' : rec.level.toUpperCase(),
        logger: rec.category.join('.'),
        message: '[unserializable log record]',
      })}\n`
    }
  }
}

const LOG_FILE_RE = /^([a-z]+)\.(\d{4}-\d{2}-\d{2})\.jsonl$/

/**
 * Enforce retention: delete daily files (any stream) older than
 * RETENTION_DAYS, then oldest-first until the directory fits MAX_TOTAL_BYTES.
 * Files bearing the current date are never deleted — a process may hold them
 * open. Never throws, and every unlink tolerates having lost a race with a
 * sweep from another process.
 */
export function sweepLogs(dir: string, nowMs: number): void {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  const today = utcDate(nowMs)
  const cutoff = utcDate(nowMs - RETENTION_DAYS * 86_400_000)

  const files: { date: string; filePath: string; size: number }[] = []
  for (const name of names) {
    const match = LOG_FILE_RE.exec(name)
    if (!match) continue
    const date = match[2]!
    const filePath = path.join(dir, name)
    if (date < cutoff) {
      try {
        unlinkSync(filePath)
      } catch {
        // Already gone (concurrent sweep) — the goal state, not a failure
      }
      continue
    }
    try {
      files.push({ date, filePath, size: statSync(filePath).size })
    } catch {
      // Vanished between readdir and stat
    }
  }

  let total = files.reduce((sum, f) => sum + f.size, 0)
  if (total <= MAX_TOTAL_BYTES) return
  files.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  for (const f of files) {
    if (total <= MAX_TOTAL_BYTES) break
    if (f.date === today) continue
    try {
      unlinkSync(f.filePath)
      total -= f.size
    } catch {
      // Lost the race; the other sweeper subtracted it from disk for us
    }
  }
}

/**
 * A sink writing each record to `<dir>/<stream>.<utc-date>.jsonl`, opening the
 * next day's file (and sweeping retention) when a record's timestamp crosses
 * midnight UTC. Appends are unbuffered single writes: crash-safe, and safe to
 * interleave should two processes ever share a stream file briefly (launchd
 * restart overlap).
 *
 * Directory creation is lazy — a process that never logs never touches disk.
 */
export function getDailyFileSink(
  dir: string,
  stream: string,
  options: { formatter: TextFormatter },
): Sink & Disposable {
  let fd: number | null = null
  let openDate: string | null = null
  const sink = (record: LogRecord) => {
    const date = utcDate(record.timestamp)
    if (date !== openDate || fd === null) {
      if (fd !== null) closeSync(fd)
      mkdirSync(dir, { recursive: true })
      fd = openSync(path.join(dir, `${stream}.${date}.jsonl`), 'a')
      openDate = date
      sweepLogs(dir, record.timestamp)
    }
    writeSync(fd, options.formatter(record))
  }
  return Object.assign(sink, {
    [Symbol.dispose]: () => {
      if (fd !== null) {
        closeSync(fd)
        fd = null
      }
    },
  })
}

export interface LoggingOptions {
  /** Which process family this is — names the daily file. */
  stream: LogStream
  /** Overrides the level that would otherwise come from SKY_LOG_LEVEL. */
  level?: LogLevel
  /** Writes somewhere other than DIR_LOGS. Tests use this; nothing else should. */
  dir?: string
  /**
   * Mirror records to the console as well as the file. Off by default —
   * stdout belongs to the terminal UI in CLI processes. The service passes
   * `process.stdout.isTTY` so interactive `bun run` development still shows
   * output.
   */
  console?: boolean
}

let configured = false

/**
 * Install the process-wide logging configuration. Idempotent, so entry points
 * may call it defensively; the first call wins. A process that never calls it
 * logs nothing — `logger()` calls in shared code are no-ops there, which is
 * the safe default for processes not yet wired up.
 */
export function configureLogging(options: LoggingOptions): void {
  if (configured) return
  const dir = options.dir ?? DIR_LOGS
  const level = options.level ?? resolveLevel(env.get('SKY_LOG_LEVEL'))
  const skySinks = options.console ? ['file', 'console'] : ['file']
  configureSync({
    sinks: {
      file: getDailyFileSink(dir, options.stream, { formatter: safeJsonLinesFormatter }),
      console: getConsoleSink(),
    },
    loggers: [
      { category: [ROOT], sinks: skySinks, lowestLevel: level },
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

export interface LogEvent {
  /** Accumulate fields as the unit of work progresses. */
  set(fields: Record<string, unknown>): LogEvent
  /** Emit the single wide record for this unit of work. */
  emit(outcome?: string, fields?: Record<string, unknown>): void
  /** Emit at error level with the failure attached. */
  fail(error: unknown, fields?: Record<string, unknown>): void
}

/**
 * One wide event per unit of work, instead of a trail of narration: begin at
 * the top, `set()` fields as they become known, `emit()`/`fail()` exactly once
 * at the end. The record carries the event name, outcome, wall duration
 * (monotonic — measured with performance.now, immune to clock changes), and
 * every accumulated field:
 *
 *   const tick = beginEvent(logger('heartbeat'), 'tick', { level: 'debug' })
 *   tick.set({ idleMs, checked })
 *   tick.emit()              // {event:"tick", outcome:"ok", durationMs, idleMs, checked}
 *
 * Event names are literal — no `{placeholder}` templating.
 */
export function beginEvent(log: Logger, event: string, options: { level?: 'debug' | 'info' } = {}): LogEvent {
  const started = performance.now()
  const acc: Record<string, unknown> = {}
  function finish(method: 'debug' | 'info' | 'error', outcome: string, extra?: Record<string, unknown>): void {
    log[method](event, {
      event,
      outcome,
      durationMs: Math.round(performance.now() - started),
      ...acc,
      ...extra,
    })
  }
  return {
    set(fields) {
      Object.assign(acc, fields)
      return this
    },
    emit(outcome = 'ok', fields) {
      finish(options.level ?? 'info', outcome, fields)
    },
    fail(error, fields) {
      finish('error', 'error', { error, ...fields })
    },
  }
}
