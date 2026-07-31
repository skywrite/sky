import process from 'node:process'
import * as config from '#shared/config.ts'
import { env, exit } from '#shared/sys/mod.ts'
import { getDarwinIdleMs, readSystemTimezone } from '#lib/sys/mod.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { createJsonResponse } from './response.ts'
import * as jsend from './jsend.ts'
import store from './store.ts'
import { createServer } from './server.ts'
import { processFileUpdate } from './scanner/walkDirs.ts'
import { isDayFile, scheduleDayFileSync, subscribeToMobileChanges } from './sync/supabase.ts'
import MarkdownWatcher from './MarkdownWatcher/mod.ts'
import siteHtmlHandler from './handler/siteHtml.ts'
import { routeAISDKWarningsToLog } from '#shared/ai/errorLog.ts'
import { beginEvent, configureLogging, logger } from '#shared/log.ts'

// First thing, before anything can log: route this process's records to the
// service stream. Under launchd stdout is not a TTY, so records go to the
// daily file only; interactive `bun run` development also mirrors them to the
// terminal.
configureLogging({ stream: 'service', console: process.stdout.isTTY === true })

const logServer = logger('server')
const logTz = logger('timezone')
const logHeartbeat = logger('heartbeat')
const logWatcher = logger('watcher')

// AI SDK warnings from service handlers (e.g. siteHtml) go to the error log
// with a one-line stderr notice instead of stack traces in the service log.
routeAISDKWarningsToLog()

// kill every 12 hours; for some reason the
// macOS service configuation isn't killing as expected
setInterval(() => exit(0), 12 * 60 * 60 * 1000)

// Track the system timezone and adopt changes in place. The JS engine
// resolves the host zone once per process, so a long-lived service goes
// stale when travel re-links /etc/localtime. Assigning process.env.TZ is
// the escape hatch: Bun (like Node) hooks that specific setter to drop the
// engine's timezone cache, so Date and Intl re-resolve immediately. That is
// runtime-specific behavior, not POSIX — a plain setenv would change
// nothing. This replaces the old exit(0)-and-respawn, which unbound the
// port for 50-70s at exactly the moments JP travels. Pinning TZ at boot
// also immunizes the process (and every child it spawns) against the
// post-wake wobble where Intl transiently reports UTC: an explicit TZ
// outranks the host default.
let trackedTimezone = await readSystemTimezone()
if (trackedTimezone) {
  process.env.TZ = trackedTimezone
  logTz.info('Starting with system timezone {tz} (TZ pinned)', { tz: trackedTimezone })
} else {
  logTz.warn('Could not read system timezone; running with runtime default')
}

setInterval(async () => {
  const currentTz = await readSystemTimezone()
  // null = transient read failure (relink window): keep the current zone
  // rather than restarting over a hiccup like the old comparison did.
  if (!currentTz || currentTz === trackedTimezone) return
  logTz.info('System timezone changed from {from} to {to} (updated in place)', {
    event: 'tz-change',
    from: trackedTimezone ?? 'unknown',
    to: currentTz,
  })
  process.env.TZ = currentTz
  trackedTimezone = currentTz
}, 30 * 1000)

// Production-specific routes
const customRoutes = new Map<string, (req: Request) => Promise<Response>>()
customRoutes.set('/site-html', async (req: Request) => {
  if (req.method === 'POST') {
    try {
      const jsonData = await req.json()
      await siteHtmlHandler(jsonData)
      return createJsonResponse(jsend.success({}))
    } catch (error) {
      return createJsonResponse(jsend.error((error as Error).message, { code: 500 }))
    }
  } else {
    return new Response('Method not allowed', { status: 405 })
  }
})

// Create server using factory
const server = createServer({
  port: config.PORT_SERVER as number,
  markdownDirs: config.DIRS_MARKDOWN,
  paths: {
    people: config.DIR_PEOPLE,
    peopleOld: config.DIR_PEOPLE_OLD,
    orgs: config.DIR_ORGS,
    projects: config.DIR_PROJECTS,
    places: config.DIR_PLACES,
    time: config.DIR_TIME,
  },
  store,
  customRoutes,
  // undefined → uses MarkdownStore.buildFromAll(); tests pass explicit config for fixture dirs
  markdownStoreConfig: undefined,
})

export default async function run() {
  // One wide boot event carries the phase timings; a boot that dies before
  // emitting it leaves the tz line as the last record, and the throw itself
  // lands in the /tmp crash-catcher.
  const boot = beginEvent(logServer, 'boot')
  logServer.info('Notebook server is starting')

  const scanStarted = performance.now()
  await server.scan()
  boot.set({ scanMs: Math.round(performance.now() - scanStarted) })
  subscribeToMobileChanges(config)

  // Heartbeat: periodic cadence runner (follow checks, inbox scans, etc.)
  // See docs/ideas/heartbeat-system.md for design
  const HEARTBEAT_INTERVAL_MS = 60_000 // 1 minute
  const EMAIL_SYNC_TICKS = 3 // every 3 minutes
  const SLEEP_IDLE_MS = 3 * 3_600_000 // 3 hours
  let heartbeatRunning = false
  let heartbeatTick = 0
  let heartbeatSleeping = false

  function isQuietHours(): boolean {
    const hour = new Date().getHours()
    return hour >= 22 || hour < 4
  }

  // Wake endpoint: POST /heartbeat/wake
  customRoutes.set('/heartbeat/wake', async (req: Request) => {
    if (req.method === 'POST') {
      heartbeatSleeping = false
      logHeartbeat.info('wake', { event: 'wake', reason: 'endpoint' })
      return createJsonResponse(jsend.success({ sleeping: false }))
    }
    return new Response('Method not allowed', { status: 405 })
  })

  let intervalCount = 0

  setInterval(async () => {
    if (heartbeatRunning) return
    heartbeatRunning = true
    // One wide event per tick, at debug so steady-state stays quiet; anything
    // that actually happens gets its own info/error record below.
    const tick = beginEvent(logHeartbeat, 'tick', { level: 'debug' })
    try {
      const idleMs = await getDarwinIdleMs()
      tick.set({ idleMs, tz: trackedTimezone })

      // Hourly pulse at info (and on the first tick after boot): the always-on
      // trail of tz and idle state — the tripwire for the recurring
      // Intl-flips-to-UTC bug, bounded to 60-minute resolution.
      intervalCount++
      if (intervalCount % 60 === 1) {
        logHeartbeat.info('heartbeat', {
          event: 'heartbeat',
          tz: trackedTimezone,
          idleMs,
          sleeping: heartbeatSleeping,
        })
      }

      // Sleep: quiet hours (10pm–4am) + idle > 3hrs
      if (!heartbeatSleeping && isQuietHours() && idleMs != null && idleMs >= SLEEP_IDLE_MS) {
        heartbeatSleeping = true
        logHeartbeat.info('sleep', { event: 'sleep', reason: 'quiet hours + idle > 3h', idleMs })
      }

      // Auto-wake when quiet hours end
      if (heartbeatSleeping && !isQuietHours()) {
        heartbeatSleeping = false
        logHeartbeat.info('wake', { event: 'wake', reason: 'quiet hours ended' })
      }

      if (heartbeatSleeping) {
        tick.emit('sleeping')
        return
      }

      heartbeatTick++
      const ctx = CommandContext.server(config, env.toObject())
      const commandService = new CommandService(ctx)

      // Slack follow check (every tick — has its own per-follow backoff)
      const result = await commandService.run('slack:follow:check', {})

      if (result.status === 'success') {
        const data = result.data as
          | {
              checked: number
              expired: string[]
              skipped: string[]
              errors: string[]
              withActivity: { fileName: string }[]
            }
          | undefined
        tick.set({
          checked: data?.checked ?? 0,
          withActivity: data?.withActivity.length ?? 0,
          expired: data?.expired?.length ?? 0,
          skipped: data?.skipped?.length ?? 0,
        })
        if (data && data.checked > 0) {
          logHeartbeat.info('Checked {checked} follow(s), {withActivity} with activity', {
            event: 'follows-checked',
            checked: data.checked,
            withActivity: data.withActivity.length,
          })
        }
        if (data && data.expired && data.expired.length > 0) {
          logHeartbeat.info('Expired {count} follow(s)', {
            event: 'follows-expired',
            count: data.expired.length,
            expired: data.expired,
          })
        }
        if (data && data.skipped && data.skipped.length > 0) {
          logHeartbeat.info('Skipped {count} follow(s)', {
            event: 'follows-skipped',
            count: data.skipped.length,
            skipped: data.skipped,
          })
        }
        if (data && data.errors && data.errors.length > 0) {
          logHeartbeat.error('{count} follow error(s)', { count: data.errors.length, errors: data.errors })
        }
      } else {
        logHeartbeat.error('follow check failed: {message}', { message: result.message })
      }

      // Email follow sync (every 3 minutes) — disabled until IMAP zlib stability is resolved
      // if (heartbeatTick % EMAIL_SYNC_TICKS === 0) {
      //   const emailAccounts = await ctx.secrets.list('email')
      //   for (const entry of emailAccounts) {
      //     try {
      //       const emailResult = await commandService.run('follow:email:sync', { account: entry.name })
      //       if (emailResult.status === 'success') {
      //         const data = emailResult.data as
      //           | { newFollows: number; updatedFollows: number; totalMessages: number }
      //           | undefined
      //         if (data && data.totalMessages > 0) {
      //           console.log(
      //             `[heartbeat] Email sync ${entry.name}: ${data.newFollows} new, ${data.updatedFollows} updated, ${data.totalMessages} msgs`,
      //           )
      //         }
      //       } else {
      //         console.error(`[heartbeat] Email sync ${entry.name} failed: ${emailResult.message}`)
      //       }
      //     } catch (err) {
      //       console.error(`[heartbeat] Email sync ${entry.name} error:`, err)
      //     }
      //   }
      // }
    } catch (err) {
      tick.fail(err)
      return
    } finally {
      heartbeatRunning = false
    }
    tick.emit()
  }, HEARTBEAT_INTERVAL_MS)
  logHeartbeat.info('Started (every {intervalSecs}s)', { intervalSecs: HEARTBEAT_INTERVAL_MS / 1000 })

  const startStarted = performance.now()
  await server.start()
  boot.emit('ok', {
    startMs: Math.round(performance.now() - startStarted),
    port: server.port,
    tz: trackedTimezone,
  })

  // Start file watcher AFTER server is listening —
  // chokidar's initial directory scan competes for I/O with buildMarkdownStore()
  watchFiles()
}

// Entity/score stores are add-only during incremental updates, so removals
// need a full rebuild (see server.rebuildEntityStores). Debounced: a burst of
// deletions (dir removal, sync sweep) triggers one rebuild, and a rebuild
// requested mid-run schedules exactly one follow-up.
let entityRebuildTimer: ReturnType<typeof setTimeout> | null = null
let entityRebuildRunning = false
let entityRebuildQueued = false

function scheduleEntityRebuild() {
  if (entityRebuildTimer) clearTimeout(entityRebuildTimer)
  entityRebuildTimer = setTimeout(async () => {
    entityRebuildTimer = null
    if (entityRebuildRunning) {
      entityRebuildQueued = true
      return
    }
    entityRebuildRunning = true
    try {
      await server.rebuildEntityStores()
    } catch (err) {
      logWatcher.error('Entity store rebuild failed', err as Error)
    } finally {
      entityRebuildRunning = false
      if (entityRebuildQueued) {
        entityRebuildQueued = false
        scheduleEntityRebuild()
      }
    }
  }, 2_000)
}

async function watchFiles() {
  logWatcher.info('Starting file watcher')
  const watcher = MarkdownWatcher.getInstance()
  for await (const ret of watcher.run()) {
    if (ret.error) {
      logWatcher.error('watcher error: {error}', { error: ret.error })
      continue
    }

    if (!ret.file) continue
    // Log lifecycle events (create/remove) for diagnosability; modify events
    // fire on every save and sync touch, far too noisy to log.
    if (ret.event === 'create' || ret.event === 'remove') {
      logWatcher.info('{event}: {file}', { event: ret.event, file: ret.file })
    }

    // Update MarkdownStore for live queries and link resolution. set/delete
    // bump the store version, which the DomainCollection resolver caches
    // (yoga delegates and executeQuery) compare on their next query — no
    // invalidation call belongs here. One used to live here and silently
    // targeted a cache the served yoga resolvers never read, so deleted
    // files kept resolving until the next restart.
    const mdStore = server.markdownStore
    if (mdStore) {
      if (ret.event === 'remove') {
        mdStore.delete(ret.file)
      } else if (ret.contents) {
        mdStore.set(ret.file, ret.contents)
      }
    }

    // Removed files never reach processFileUpdate (no contents), so their
    // entities/scores would linger — rebuild the entity stores from disk.
    if (ret.event === 'remove') {
      scheduleEntityRebuild()
    }

    if (!ret.contents) continue

    const { personScoresUpdated, orgScoresUpdated, tagScoresUpdated } = processFileUpdate(
      ret.contents,
      ret.file,
      server.entityDetector,
      server.scanners,
    )

    if (personScoresUpdated) {
      store.emitPersonScoresUpdated()
    }
    if (orgScoresUpdated) {
      store.emitOrgScoresUpdated()
    }
    if (tagScoresUpdated) {
      store.emitTagScoresUpdated()
    }

    // Trigger Supabase sync for day file changes (debounced)
    if (isDayFile(ret.file, config.DIR_TIME)) {
      scheduleDayFileSync(ret.file, config)
    }
  }
}
