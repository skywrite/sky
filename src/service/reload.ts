/**
 * Restarts that wait for idle.
 *
 * The service used to run under `bun --watch`, which restarted it the
 * moment a file it imported changed — under a chat turn, an import, a
 * mission — and re-exec'd in place, leaking a set of watcher descriptors
 * each time until the process had to recycle itself. Now the service
 * watches its own source and decides when to go. A change marks a restart
 * pending; the process leaves — with the exit code the launcher reads as
 * "start me again" — only once nothing is held (activity.ts), however long
 * that takes. While it waits it says so in the log now and then, and the
 * person can say "now". Every start is a fresh spawn, so nothing leaks.
 */

import { type FSWatcher, watch } from 'node:fs'
import { holding, onRelease } from './activity.ts'

/** The launcher starts the service again on this code, and only this one. */
export const RELOAD_EXIT_CODE = 3

/**
 * Whether a change to this file, relative to `src`, calls for a restart:
 * the server's own source and the environment it starts with. Not the
 * page's sources, which are built on request; not tests, docs, or
 * fixtures; nothing under node_modules.
 */
export function isServerSource(relPath: string): boolean {
  const p = relPath.replaceAll('\\', '/')
  if (p.includes('node_modules/')) return false
  if (p.startsWith('fixtures/') || p.includes('/fixtures/')) return false
  if (p.startsWith('docs/') || p.includes('/docs/')) return false
  if (p.includes('handler/theme/client/')) return false
  if (/_test\.tsx?$/.test(p)) return false
  if (p === '.env' || p.endsWith('/.env')) return true
  return /\.(ts|tsx|json|graphql)$/.test(p)
}

interface Log {
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
}

export interface ReloadGateOptions {
  /** The source root to watch — `src` */
  root: string
  exit: (code: number) => void
  log: Log
  /** Changes within this window are one restart */
  debounceMs?: number
  /** Idle this long before leaving, so a response in flight lands */
  graceMs?: number
  /** While pending and held, say so in the log this often */
  remindMs?: number
  /** False keeps the file watcher off — tests report changes themselves */
  watch?: boolean
}

export interface ReloadStatus {
  /** A restart waiting to happen: since when, why, and which files changed */
  pending: { since: number; reasons: string[]; files: string[] } | null
  /** What it waits on */
  holding: string[]
}

export interface ReloadGate {
  /** A file under the root changed */
  onChange(relPath: string): void
  /** Ask for a restart for a reason of the service's own — its twelve hours up, its descriptors high */
  request(reason: string): void
  /** Leave now, held or not — the person asked */
  restartNow(reason: string): void
  status(): ReloadStatus
  close(): void
}

const DEBOUNCE_MS = 500
const GRACE_MS = 1500
const REMIND_MS = 30 * 60_000

export function createReloadGate(options: ReloadGateOptions): ReloadGate {
  const { root, exit, log } = options
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS
  const graceMs = options.graceMs ?? GRACE_MS
  const remindMs = options.remindMs ?? REMIND_MS

  let pending: { since: number; reasons: Set<string>; files: Set<string> } | null = null
  let leaving = false
  let deferredLogged = false
  let changed = new Set<string>()
  let debounce: ReturnType<typeof setTimeout> | null = null
  let grace: ReturnType<typeof setTimeout> | null = null
  let remind: ReturnType<typeof setInterval> | null = null
  let watcher: FSWatcher | null = null

  const leave = (why: string): void => {
    if (leaving) return
    leaving = true
    const waitedMs = pending ? Date.now() - pending.since : 0
    log.info('Restarting ({why}): {reasons}', {
      event: 'reload',
      why,
      reasons: pending ? [...pending.reasons] : [],
      files: pending ? [...pending.files] : [],
      waitedMs,
      holding: holding(),
    })
    close()
    exit(RELOAD_EXIT_CODE)
  }

  const attempt = (): void => {
    if (!pending || leaving) return
    const held = holding()
    if (held.length > 0) {
      if (!deferredLogged) {
        deferredLogged = true
        log.info('Restart waits on {holding}', { event: 'reload-deferred', holding: held })
      }
      return
    }
    if (grace) return
    grace = setTimeout(() => {
      grace = null
      if (holding().length > 0) {
        attempt()
        return
      }
      leave('idle')
    }, graceMs)
  }

  const mark = (reason: string): void => {
    if (leaving) return
    if (!pending) {
      pending = { since: Date.now(), reasons: new Set(), files: new Set() }
      log.info('Restart pending: {reason}', { event: 'reload-pending', reason, holding: holding() })
      // The wait has no end but the work's own; a line now and then keeps a
      // hold that never lets go from passing for a quiet machine.
      remind = setInterval(() => {
        if (!pending || leaving) return
        const held = holding()
        if (held.length === 0) return
        log.info('Still waiting to restart, {minutes} minutes, on {holding}', {
          event: 'reload-waiting',
          minutes: Math.round((Date.now() - pending.since) / 60_000),
          holding: held,
        })
      }, remindMs)
    }
    pending.reasons.add(reason)
    for (const file of changed) pending.files.add(file)
    changed = new Set()
    attempt()
  }

  const onChange = (relPath: string): void => {
    if (leaving || !isServerSource(relPath)) return
    changed.add(relPath)
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      debounce = null
      mark('source changed')
    }, debounceMs)
  }

  const unsubscribe = onRelease(attempt)

  function close(): void {
    if (debounce) clearTimeout(debounce)
    if (grace) clearTimeout(grace)
    if (remind) clearInterval(remind)
    debounce = grace = remind = null
    unsubscribe()
    watcher?.close()
    watcher = null
  }

  if (options.watch !== false) {
    try {
      watcher = watch(root, { recursive: true }, (_event, filename) => {
        if (filename) onChange(String(filename))
      })
    } catch (err) {
      log.warn('Not watching {root} for changes: {message}', {
        root,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    onChange,
    request: mark,
    restartNow: (reason) => {
      if (leaving) return
      if (!pending) pending = { since: Date.now(), reasons: new Set(), files: new Set() }
      pending.reasons.add(reason)
      leave('asked')
    },
    status: () => ({
      pending: pending ? { since: pending.since, reasons: [...pending.reasons], files: [...pending.files] } : null,
      holding: holding(),
    }),
    close,
  }
}
