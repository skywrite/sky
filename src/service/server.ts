/**
 * Server factory for the notebook service.
 *
 * Creates an HTTP/GraphQL server that can be configured with custom
 * markdown directories, port, and store instance. This enables:
 * - Isolated testing with mock data directories
 * - Multiple server instances on different ports
 * - Deterministic scoring tests
 *
 * ## Scoring Limitation
 *
 * Person/org scores are computed at scan time using the current date (or
 * referenceDate for tests). The recency multiplier is baked into the score
 * when recordInteraction() is called, so scores become stale if the server
 * runs for extended periods without rescanning.
 *
 * Example: An interaction from 7 days ago scores 1.0× (week tier) at startup.
 * If the server runs for another week without rescanning, it still shows 1.0×
 * even though it should now be 0.5× (month tier).
 *
 * TODO: Add a heartbeat/timer to periodically rescan or recompute scores
 * so they stay fresh relative to the current date.
 */

import * as path from 'node:path'
import { serve } from '@hono/node-server'
import type { ServerType } from '@hono/node-server'
import { DIR_USER_DATA } from '#config'
import { beginEvent, logger } from '#shared/log.ts'
import { executeQuery } from '#shared/models/DomainCollection/query/execute.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createYogaInstance } from './graphql/schema.ts'
import type { ChatRoutesOptions } from './handler/chat/mod.ts'
import { createHttpApp } from './handler/http.ts'
import type { VoiceRoutesOptions } from './handler/voice/mod.ts'
import { createWebSocketHandler } from './handler/websocket.ts'
import { createEntityDetector, type PathConfig } from './scanner/entities.ts'
import { createScanners } from './scanner/scan.ts'
import { scanDirectories, scanFiles } from './scanner/walkDirs.ts'
import { Store } from './store.ts'
import type { MarkdownStoreConfig } from './stores/mod.ts'

// In processes that never call configureLogging (tests boot this factory with
// fixture dirs), these loggers are silent no-ops.
const logServer = logger('server')
const logWatcher = logger('watcher')
const logMdStore = logger('markdownstore')

// Re-export PathConfig for consumers
export type { PathConfig } from './scanner/entities.ts'

/**
 * Options for creating a server instance.
 */
export interface ServerOptions {
  /** Port to listen on */
  port: number
  /** Directories containing markdown files to scan */
  markdownDirs: string[]
  /** Path configuration for entity detection */
  paths: PathConfig
  /** Store instance (creates new if not provided) */
  store?: Store
  /** Enable file watching for live updates (default: true) */
  enableFileWatcher?: boolean
  /** Custom route handlers */
  customRoutes?: Map<string, (req: Request) => Promise<Response>>
  /** The browser's chat host; absent, /chat is not served */
  chat?: ChatRoutesOptions
  /** The browser's voice host; absent, /voice is not served */
  voice?: VoiceRoutesOptions
  /** The user-data directory: day attachments and the media mirror of the notebook's directories */
  userDataDir?: string
  /** Reference date for recency calculations (for deterministic testing) */
  referenceDate?: PlainDate
  /** Configuration for MarkdownStore (enables rich document queries) */
  markdownStoreConfig?: MarkdownStoreConfig
}

/**
 * Server instance returned by createServer.
 */
export interface Server {
  /** Start the HTTP server */
  start(): Promise<void>
  /** Stop the HTTP server */
  stop(): void
  /** The store instance used by this server */
  store: Store
  /** MarkdownStore for rich document queries (null if not configured) */
  markdownStore: MarkdownStore | null
  /** The port the server is listening on (actual port after start, configured port before) */
  port: number
  /** Manually trigger a scan of all markdown directories */
  scan(): Promise<void>
  /** Rebuild entity/score stores from disk — applies file removals, which incremental scanning cannot */
  rebuildEntityStores(): Promise<void>
  /** Build/rebuild MarkdownStore (call after scan for fresh data) */
  buildMarkdownStore(): Promise<MarkdownStore | null>
  /** Entity detector for path-based type checks */
  entityDetector: ReturnType<typeof createEntityDetector>
  /** Scanner functions for processing files */
  scanners: ReturnType<typeof createScanners>
}

/**
 * Create a new server instance.
 *
 * @example
 * // Production usage
 * const server = createServer({
 *   port: 9999,
 *   markdownDirs: config.DIRS_MARKDOWN,
 *   paths: {
 *     people: config.DIR_PEOPLE,
 *     peopleOld: config.DIR_PEOPLE_OLD,
 *     orgs: config.DIR_ORGS,
 *     projects: config.DIR_PROJECTS,
 *     time: config.DIR_TIME,
 *   },
 * })
 * await server.start()
 *
 * @example
 * // Test usage with mock directories
 * const store = new Store()
 * const server = createServer({
 *   port: 0, // Let OS assign port
 *   markdownDirs: ['/tmp/test-data'],
 *   paths: {
 *     people: '/tmp/test-data/people',
 *     peopleOld: '/tmp/test-data/people-old',
 *     orgs: '/tmp/test-data/orgs',
 *     projects: '/tmp/test-data/projects',
 *     time: '/tmp/test-data/time',
 *   },
 *   store,
 *   enableFileWatcher: false,
 * })
 */
export function createServer(options: ServerOptions): Server {
  const {
    port,
    markdownDirs,
    paths,
    store = new Store(),
    enableFileWatcher = true,
    customRoutes,
    chat,
    voice,
    referenceDate,
    markdownStoreConfig,
  } = options

  let httpServer: ServerType | null = null
  let markdownStore: MarkdownStore | null = null
  let hasScanned = false

  // Entity detection using shared module
  const entityDetector = createEntityDetector(paths)

  // File scanning helpers using shared module
  const scanners = createScanners(store, { isTimeFile: entityDetector.isTimeFile }, { referenceDate })

  // Scan all markdown directories
  async function scan() {
    await scanDirectories({
      dirs: markdownDirs,
      store,
      entityDetector,
      scanners,
    })
    hasScanned = true
  }

  // Rebuild entity/score stores from disk. Scanners only ever add, so a
  // removed file's entities survive incremental updates — scan into a fresh
  // Store and swap the result into the live one (which emits update events).
  async function rebuildEntityStores() {
    const rebuild = beginEvent(logWatcher, 'entity-rebuild')
    const freshStore = new Store()
    const freshScanners = createScanners(freshStore, { isTimeFile: entityDetector.isTimeFile }, { referenceDate })
    await scanFiles({
      dirs: markdownDirs,
      store: freshStore,
      entityDetector,
      scanners: freshScanners,
    })
    store.replaceFrom(freshStore)
    rebuild.emit('ok', { people: store.people.size, orgs: store.organizations.size })
  }

  // Build MarkdownStore for rich document queries
  async function buildMarkdownStore(): Promise<MarkdownStore | null> {
    const build = beginEvent(logMdStore, 'build')
    const buildStarted = performance.now()
    markdownStore = markdownStoreConfig
      ? await MarkdownStore.build(markdownStoreConfig)
      : await MarkdownStore.buildFromAll()
    build.set({
      buildMs: Math.round(performance.now() - buildStarted),
      people: markdownStore.people.size,
      orgs: markdownStore.orgs.size,
      projects: markdownStore.projects.size,
    })
    // Pre-warm DomainCollection resolvers (builds Collection from all 20k docs, ~6s cold)
    const warmStarted = performance.now()
    await executeQuery('{ __typename }', markdownStore)
    build.emit('ok', { warmMs: Math.round(performance.now() - warmStarted) })
    return markdownStore
  }

  // The one path scope both write surfaces share: the REST content API and
  // the saveDocument mutation gate against the same base and allowlist.
  const markdownBaseDir = findCommonAncestor(markdownDirs.map((dir) => path.dirname(dir)))

  // Create Hono app (called after markdownStore is ready)
  function createApp() {
    const yoga = createYogaInstance(store, markdownStore, { baseDir: markdownBaseDir, dirs: markdownDirs })
    return createHttpApp({
      store,
      yoga,
      markdownStore,
      markdownBaseDir,
      markdownDirs,
      customRoutes,
      chat,
      voice,
      userDataDir: options.userDataDir ?? DIR_USER_DATA,
    })
  }

  let actualPort = port

  return {
    get port() {
      return actualPort
    },
    store,
    get markdownStore() {
      return markdownStore
    },
    scan,
    rebuildEntityStores,
    buildMarkdownStore,
    entityDetector,
    scanners,

    async start() {
      logServer.info('Server starting')
      if (!hasScanned) await scan()

      // Build MarkdownStore on startup
      // Tests pass markdownStoreConfig with fixture dirs; production omits it to use buildFromAll()
      await buildMarkdownStore()

      // Create Hono app after markdownStore is ready
      const app = createApp()

      // TODO: Add file watcher support when enableFileWatcher is true

      // Attach WebSocket handler to the node:http server's upgrade event
      const wsHandler = createWebSocketHandler(store)

      await new Promise<void>((resolve) => {
        httpServer = serve({ fetch: app.fetch, port }, () => {
          const addr = httpServer?.address()
          if (addr && typeof addr === 'object') {
            actualPort = addr.port
          }
          logServer.info('Server running at http://localhost:{port}/', { port: actualPort })
          resolve()
        })
        httpServer.on('upgrade', wsHandler.handleUpgrade)
      })
    },

    stop() {
      if (httpServer) {
        httpServer.close()
        httpServer = null
        logServer.info('Server stopped')
      }
    },
  }
}

function findCommonAncestor(paths: string[]): string {
  if (paths.length === 0) return path.resolve('.')

  const resolvedPaths = paths.map((value) => path.resolve(value))
  const root = path.parse(resolvedPaths[0]!).root
  let segments = resolvedPaths[0]!.slice(root.length).split(path.sep).filter(Boolean)

  for (const value of resolvedPaths.slice(1)) {
    const nextSegments = value.slice(root.length).split(path.sep).filter(Boolean)
    let idx = 0
    while (idx < segments.length && idx < nextSegments.length && segments[idx] === nextSegments[idx]) {
      idx++
    }
    segments = segments.slice(0, idx)
  }

  return segments.length === 0 ? root : path.join(root, ...segments)
}
