import * as config from '#shared/config.ts'
import { env, exit } from '#shared/sys/mod.ts'
import { getDarwinIdleMs, runCommand } from '#lib/sys/mod.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { createJsonResponse } from './response.ts'
import * as jsend from './jsend.ts'
import store from './store.ts'
import { createServer } from './server.ts'
import { processFileUpdate } from './scanner/walkDirs.ts'
import { isDayFile, scheduleDayFileSync, subscribeToMobileChanges } from './sync/supabase.ts'
import MarkdownWatcher from './MarkdownWatcher/mod.ts'
import { resetResolverCache } from '#shared/models/DomainCollection/query/execute.ts'
import siteHtmlHandler from './handler/siteHtml.ts'

// kill every 12 hours; for some reason the
// macOS service configuation isn't killing as expected
setInterval(() => exit(0), 12 * 60 * 60 * 1000)

// Track system timezone and restart if it changes
// V8 caches timezone at process start, so we need to restart to pick up changes
async function getSystemTimezone(): Promise<string> {
  const result = await runCommand('readlink', ['/etc/localtime'])
  // /etc/localtime -> /var/db/timezone/zoneinfo/America/New_York
  return result.stdout.trim().replace(/.*\/zoneinfo\//, '')
}

const initialTimezone = await getSystemTimezone()
console.log(`[timezone] Starting with system timezone: ${initialTimezone}`)

setInterval(async () => {
  const currentTz = await getSystemTimezone()
  if (currentTz !== initialTimezone) {
    console.log(`[timezone] System timezone changed from ${initialTimezone} to ${currentTz}, restarting...`)
    exit(0)
  }
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
  console.log('Notebook server is starting...')

  await server.scan()
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
      console.log('[heartbeat] Woken by /heartbeat/wake')
      return createJsonResponse(jsend.success({ sleeping: false }))
    }
    return new Response('Method not allowed', { status: 405 })
  })

  setInterval(async () => {
    if (heartbeatRunning) return
    heartbeatRunning = true
    try {
      const idleMs = await getDarwinIdleMs()
      if (idleMs != null) {
        const hrs = Math.floor(idleMs / 3_600_000)
        const mins = Math.floor((idleMs % 3_600_000) / 60_000)
        const secs = Math.floor((idleMs % 60_000) / 1_000)
        console.log(`[heartbeat] idle: ${hrs}h${mins}m${secs}s`)
      }

      // Sleep: quiet hours (10pm–4am) + idle > 3hrs
      if (!heartbeatSleeping && isQuietHours() && idleMs != null && idleMs >= SLEEP_IDLE_MS) {
        heartbeatSleeping = true
        console.log('[heartbeat] Sleeping (quiet hours + idle > 3h)')
      }

      // Auto-wake when quiet hours end
      if (heartbeatSleeping && !isQuietHours()) {
        heartbeatSleeping = false
        console.log('[heartbeat] Auto-woke (quiet hours ended)')
      }

      if (heartbeatSleeping) {
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
        if (data && data.checked > 0) {
          console.log(`[heartbeat] Checked ${data.checked} follow(s), ${data.withActivity.length} with activity`)
        }
        if (data && data.expired && data.expired.length > 0) {
          console.log(`[heartbeat] Expired ${data.expired.length} follow(s): ${data.expired.join(', ')}`)
        }
        if (data && data.skipped && data.skipped.length > 0) {
          console.log(`[heartbeat] Skipped: ${data.skipped.join(', ')}`)
        }
        if (data && data.errors && data.errors.length > 0) {
          for (const e of data.errors) {
            console.error(`[heartbeat] Follow error: ${e}`)
          }
        }
      } else {
        console.error(`[heartbeat] check failed: ${result.message}`)
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
      console.error('[heartbeat] error:', err)
    } finally {
      heartbeatRunning = false
    }
  }, HEARTBEAT_INTERVAL_MS)
  console.log(`[heartbeat] Started (every ${HEARTBEAT_INTERVAL_MS / 1000}s)`)

  await server.start()

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
      console.error('[watcher] Entity store rebuild failed:', err)
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
  console.log('[watcher] Starting file watcher...')
  const watcher = MarkdownWatcher.getInstance()
  for await (const ret of watcher.run()) {
    if (ret.error) {
      console.error(ret.error)
      continue
    }

    if (!ret.file) continue
    // Log lifecycle events (create/remove) for diagnosability; modify events
    // fire on every save and sync touch, far too noisy to log.
    if (ret.event === 'create' || ret.event === 'remove') {
      console.log(`[watcher] ${ret.event}: ${ret.file}`)
    }

    // Update MarkdownStore for live link resolution
    const mdStore = server.markdownStore
    if (mdStore) {
      if (ret.event === 'remove') {
        mdStore.delete(ret.file)
      } else if (ret.contents) {
        mdStore.set(ret.file, ret.contents)
      }
      // Invalidate cached DomainCollection so next query sees updated data
      resetResolverCache()
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
