import process from 'node:process'
import { sweepTotals, syncGmailFollowAccounts } from '#commands/all/google/email/lib/heartbeatSync.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import runDueAutomations from '#lib/automations/runDue.ts'
import { getDarwinIdleMs, openFdCount, readSystemTimezone } from '#lib/sys/mod.ts'
import { routeAISDKWarningsToLog } from '#shared/ai/errorLog.ts'
import * as config from '#shared/config.ts'
import { beginEvent, configureLogging, logger } from '#shared/log.ts'
import { env, exit } from '#shared/sys/mod.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { createChatHost } from './handler/chat/createSession.ts'
import { createClockHost } from './handler/clock/createClockHost.ts'
import { createImportHost } from './handler/import/createImportHost.ts'
import { createSettingsHost } from './handler/settings/createSettingsHost.ts'
import siteHtmlHandler from './handler/siteHtml.ts'
import { createVoiceHost } from './handler/voice/createVoiceHost.ts'
import * as jsend from './jsend.ts'
import MarkdownWatcher from './MarkdownWatcher/mod.ts'
import { createJsonResponse } from './response.ts'
import { processFileUpdate } from './scanner/walkDirs.ts'
import { createServer } from './server.ts'
import store from './store.ts'

// First thing, before anything can log: route this process's records to the
// service stream. Under launchd stdout is not a TTY, so records go to the
// daily file only; interactive `bun run` development also mirrors them to the
// terminal.
configureLogging({ stream: 'service', console: process.stdout.isTTY === true })

const logServer = logger('server')
const logTz = logger('timezone')
const logHeartbeat = logger('heartbeat')
const logAutomations = logger('automations')
const logWatcher = logger('watcher')

// A charter that cannot be read is just as unreadable on the next tick, so the
// same complaint would land 1440 times a day. Report each distinct problem once
// per process and let a restart re-surface anything still wrong.
const reportedAutomationProblems = new Set<string>()

function reportAutomationProblemOnce(key: string, report: () => void): void {
  if (reportedAutomationProblems.has(key)) return
  reportedAutomationProblems.add(key)
  report()
}

// AI SDK warnings from service handlers (e.g. siteHtml) go to the error log
// with a one-line stderr notice instead of stack traces in the service log.
routeAISDKWarningsToLog()

// Recycle the process before its descriptor table fills up. Bun 1.4's
// `--watch` reload re-execs in place and leaves the previous incarnation's
// watcher directory handles open (oven-sh/bun#40706) — one full set per
// code save — and once a process holds more than OPEN_MAX (10,240)
// descriptors, macOS posix_spawn fails with EBADF: every child (agent-slack,
// ioreg, …) dies instantly while the server itself looks healthy. The 12h
// interval below cannot catch this, because a reload restarts it too.
// Measuring the process is immune to reloads; exiting hands launchd
// (KeepAlive) a clean PID at the same cost as the reload that just happened.
const FD_RECYCLE_LIMIT = 4096
const openFds = openFdCount()
if (openFds !== null && openFds > FD_RECYCLE_LIMIT) {
  logServer.warn('Recycling: {openFds} open descriptors exceed {limit}', {
    event: 'recycle',
    openFds,
    limit: FD_RECYCLE_LIMIT,
  })
  exit(0)
}

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
// port for 50-70s at exactly the moments the user travels. Pinning TZ at boot
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
  chat: createChatHost(config, env.toObject()),
  voice: createVoiceHost(config, env.toObject()),
  settings: createSettingsHost(),
  clock: createClockHost(config, env.toObject()),
  imports: createImportHost(config, env.toObject()),
  userDataDir: config.DIR_USER_DATA,
  // undefined → uses MarkdownStore.buildFromAll(); tests pass explicit config for fixture dirs
  markdownStoreConfig: undefined,
})

export default async function run() {
  // One wide boot event carries the phase timings; a boot that dies before
  // emitting it leaves the tz line as the last record, and the throw itself
  // lands in the /tmp crash-catcher.
  const boot = beginEvent(logServer, 'boot')
  boot.set({ openFds })
  logServer.info('Notebook server is starting')

  const scanStarted = performance.now()
  await server.scan()
  boot.set({ scanMs: Math.round(performance.now() - scanStarted) })

  // Heartbeat: periodic cadence runner (follow checks, inbox scans, etc.)
  // See docs/ideas/heartbeat-system.md for design
  const HEARTBEAT_INTERVAL_MS = 60_000 // 1 minute
  // 15 minutes: a steady-state email sync with nothing new is ~45 Gmail
  // metadata calls and no AI calls, so cadence is purely capture freshness —
  // and the tick counter resets with every service restart, so a shorter fuse
  // actually fires on edit-heavy days.
  const EMAIL_SYNC_TICKS = 15
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
              polled: number
              exportFailures: number
              exportFailure: string | null
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
        // Every polled follow failing to export is not follow trouble, it is a
        // dead spawn path (expired Slack auth, EBADF past the fd cliff) — and
        // it stays that way until someone acts, so it must not hide at INFO
        // among the per-follow skips.
        if (data && data.polled > 0 && data.exportFailures === data.polled) {
          logHeartbeat.error('Every follow export failed ({count}): {reason}', {
            event: 'follows-export-failed',
            count: data.exportFailures,
            reason: data.exportFailure,
          })
        }
        if (data && data.errors && data.errors.length > 0) {
          logHeartbeat.error('{count} follow error(s)', { count: data.errors.length, errors: data.errors })
        }
      } else {
        logHeartbeat.error('follow check failed: {message}', { message: result.message })
      }

      // Email follow sync: capture new mail in the Sky/Follow bucket across
      // every Gmail-scoped account and retire quiet follows. Bounded per run
      // (25 unsaved threads/account) so a backlog drains across ticks instead
      // of holding this one — the slack check above shares the
      // heartbeatRunning guard.
      if (heartbeatTick % EMAIL_SYNC_TICKS === 0) {
        const sweep = await syncGmailFollowAccounts({ secrets: ctx.secrets, tasks: commandService })
        const totals = sweepTotals(sweep)
        tick.set({
          emailAccounts: sweep.ran.length,
          emailNew: totals.newFollows,
          emailUpdated: totals.updatedFollows,
          emailBornExpired: totals.bornExpired,
          emailExpired: totals.expired,
          emailMessages: totals.fetchedMessages,
        })
        if (sweep.unavailable) {
          tick.set({ emailSync: sweep.unavailable })
        } else if (totals.fetchedMessages > 0 || totals.newFollows > 0 || totals.expired > 0) {
          logHeartbeat.info(
            'Email sync: {emailNew} new, {emailUpdated} updated, {emailBornExpired} captured+closed, {emailMessages} message(s), {emailExpired} expired',
            {
              event: 'email-synced',
              emailNew: totals.newFollows,
              emailUpdated: totals.updatedFollows,
              emailBornExpired: totals.bornExpired,
              emailMessages: totals.fetchedMessages,
              emailExpired: totals.expired,
              accounts: sweep.ran.map((a) => a.account),
            },
          )
        }
        for (const skipped of sweep.skipped) {
          logHeartbeat.info('Email sync skipped {account}: {reason}', {
            event: 'email-sync-skipped',
            account: skipped.account,
            reason: skipped.reason,
          })
        }
        for (const failed of sweep.ran.filter((a) => a.error)) {
          logHeartbeat.error('Email sync failed for {account}: {message}', {
            account: failed.account,
            message: failed.error,
          })
        }
      }

      // Declared automations: charters under the notebook's automations/ say
      // what runs and when. A missing directory is a no-op, so this stays
      // silent until the first charter exists.
      //
      // The clock is safe against the post-wake flip where Intl transiently
      // reports UTC: TZ is pinned at boot and refreshed above, so the wall
      // clock and the zone name resolve from the same pinned value. Wake is
      // exactly when a missed firing catches up, which is why it matters here.
      const pass = await runDueAutomations({
        dir: config.DIR_AUTOMATIONS,
        statePath: config.FILE_AUTOMATIONS_STATE,
        systemNow: new ZonedDateTime(),
        invoke: async ({ run, args }) => {
          const outcome = await commandService.run(run, args)
          return outcome.status === 'success' ? { outcome: 'acted' } : { outcome: 'failed', message: outcome.message }
        },
      })

      tick.set({ automationsConsidered: pass.considered, automationsRan: pass.ran.length })

      for (const ran of pass.ran) {
        if (ran.outcome === 'failed') {
          logAutomations.error('{name} failed: {message}', {
            event: 'automation-failed',
            name: ran.name,
            run: ran.run,
            lateMinutes: ran.lateMinutes,
            message: ran.message ?? 'no detail given',
          })
        } else {
          logAutomations.info('ran {name} → {outcome}', {
            event: 'automation-ran',
            name: ran.name,
            run: ran.run,
            outcome: ran.outcome,
            lateMinutes: ran.lateMinutes,
          })
        }
      }

      for (const problem of pass.charterErrors) {
        reportAutomationProblemOnce(`charter:${problem.path}:${problem.error}`, () =>
          logAutomations.error('unreadable charter {path}: {error}', {
            event: 'automation-charter-error',
            path: problem.path,
            error: problem.error,
          }),
        )
      }

      for (const warning of pass.unknownKeys) {
        reportAutomationProblemOnce(`keys:${warning.name}:${warning.keys.join(',')}`, () =>
          logAutomations.warn('{name} carries frontmatter nothing reads: {keys}', {
            event: 'automation-unknown-keys',
            name: warning.name,
            keys: warning.keys,
          }),
        )
      }

      if (pass.stateError) {
        const stateError = pass.stateError
        reportAutomationProblemOnce(`state:${stateError}`, () =>
          logAutomations.error('run-state unusable, every charter reads as never run: {error}', {
            event: 'automation-state-error',
            error: stateError,
          }),
        )
      }
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

    // Removed files never reach processFileUpdate (no contents): their share
    // of the scores goes now; the rosters, which only ever grow, follow with
    // a rebuild from disk.
    if (ret.event === 'remove') {
      if (store.forgetFile(ret.file)) {
        store.emitPersonScoresUpdated()
        store.emitOrgScoresUpdated()
        store.emitTagScoresUpdated()
      }
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
  }
}
