import * as path from 'node:path'
import { readJson, withProcessLock, writeJson } from '#lib/jobs/files.ts'
import { hash } from '#lib/outbox/files.ts'
import { Instant, instantNow, PlainDate } from '#universal/dates/nbdt/mod.ts'
import { scanCapturedConversations } from './captures.ts'
import { type GmailInboxClient, scanGmailInbox } from './gmailInbox.ts'
import {
  computeNeedsResponsePriority,
  isNeedsResponseExpired,
  NEEDS_RESPONSE_EXPIRY_DAYS,
  passesNeedsResponseScreen,
  sortNeedsResponseItems,
} from './score.ts'
import { isSenderEligible, resolveSender, type SenderLookup } from './sender.ts'
import type {
  NeedsResponseCandidate,
  NeedsResponseItem,
  NeedsResponseScanReport,
  NeedsResponseScreen,
  NeedsResponseStateFile,
  StoredNeedsResponseEntry,
} from './types.ts'

const STATE_VERSION = 1
const CACHE_RETENTION_DAYS = 14
const STALE_SCAN_MS = 5 * 60_000

export interface NeedsResponseHostOptions {
  stateDir: string
  markdownBaseDir: string
  timeDir: string
  slackDmsDir?: string
  slackFollowActiveDir?: string
  getOwnerNames: () => Promise<string[]>
  getOwnerAddresses?: () => Promise<string[]>
  getSenderLookup: () => SenderLookup
  getTimezone: () => string
  now?: () => Instant
  today?: () => PlainDate
  /** Optional live Gmail Inbox scanner (read-only across authorized accounts). */
  gmail?: GmailInboxClient | null
  /** Jev screening adapter; when absent, scans cannot classify uncached candidates. */
  createScreen?: () => Promise<NeedsResponseScreen | null>
  /** Open a Beeper Desktop chat when the user clicks a Beeper row. */
  openBeeper?: (chatId: string) => Promise<void>
  expiryDays?: number
}

export interface NeedsResponseHost {
  list: () => Promise<{ items: NeedsResponseItem[]; lastScanAt: string | null }>
  scan: () => Promise<NeedsResponseScanReport>
  dismiss: (id: string, version: string) => Promise<{ items: NeedsResponseItem[]; lastScanAt: string | null }>
  undismiss: (id: string) => Promise<{ items: NeedsResponseItem[]; lastScanAt: string | null }>
  openInApp: (id: string) => Promise<void>
  /** Trigger a non-blocking refresh when no scan has happened within the 5-minute freshness window. */
  refreshIfStale: () => void
}

function emptyState(): NeedsResponseStateFile {
  return {
    version: STATE_VERSION,
    lastScanAt: null,
    items: {},
    dismissed: {},
    screens: {},
    gmailThreads: {},
  }
}

async function readStateSafely(file: string): Promise<NeedsResponseStateFile> {
  try {
    const raw = await readJson<NeedsResponseStateFile>(file)
    if (!raw || raw.version !== STATE_VERSION || typeof raw.items !== 'object') return emptyState()
    return {
      version: STATE_VERSION,
      lastScanAt: typeof raw.lastScanAt === 'string' ? raw.lastScanAt : null,
      items: raw.items ?? {},
      dismissed: raw.dismissed ?? {},
      screens: raw.screens ?? {},
      gmailThreads: raw.gmailThreads ?? {},
    }
  } catch {
    return emptyState()
  }
}

function screenCacheKey(candidate: NeedsResponseCandidate, screenVersion: string): string {
  return hash(JSON.stringify([candidate.id, candidate.version, screenVersion])).slice(0, 24)
}

function toPublicItem(entry: StoredNeedsResponseEntry, nowMs: number, lookup: SenderLookup): NeedsResponseItem {
  const receivedMs = Instant.from(entry.receivedAt).epochMilliseconds
  const ageHours = Math.max(0, (nowMs - receivedMs) / 3_600_000)
  const resolved = resolveSender({ name: entry.senderName, email: entry.senderEmail, phone: entry.senderPhone }, lookup)
  const priority = computeNeedsResponsePriority({
    personScore: resolved.personScore,
    ageHours,
    kind: entry.kind,
    inMacContacts: resolved.inMacContacts,
  })
  const href =
    entry.target?.medium === 'Slack' ? entry.target.link : entry.target?.medium === 'Email' ? entry.target.link : null
  return {
    id: entry.id,
    version: entry.version,
    source: entry.source,
    kind: entry.kind,
    sender: resolved.displayName,
    ...(entry.contextLabel ? { contextLabel: entry.contextLabel } : {}),
    summary: entry.summary,
    receivedAt: entry.receivedAt,
    receivedLocal: entry.receivedLocal,
    ageHours: Math.round(ageHours * 10) / 10,
    personScore: Math.round(resolved.personScore * 10) / 10,
    ...(resolved.inMacContacts ? { inMacContacts: true } : {}),
    priority,
    href,
    ...(entry.target?.medium === 'Beeper' ? { openInApp: 'beeper' as const } : {}),
    ...(entry.savedPath ? { savedPath: entry.savedPath } : {}),
  }
}

export function createNeedsResponseHost(options: NeedsResponseHostOptions): NeedsResponseHost {
  const statePath = path.join(options.stateDir, 'state.json')
  const lockPath = path.join(options.stateDir, 'state.lock')
  const expiryDays = options.expiryDays ?? NEEDS_RESPONSE_EXPIRY_DAYS
  const nowFn = options.now ?? (() => Instant.from(instantNow()))
  const todayFn = options.today ?? (() => PlainDate.today())

  let activeScan: Promise<NeedsResponseScanReport> | null = null
  let lastScanMs = 0

  const projectItems = (state: NeedsResponseStateFile): NeedsResponseItem[] => {
    const nowMs = nowFn().epochMilliseconds
    const lookup = options.getSenderLookup()
    const visible: NeedsResponseItem[] = []

    for (const entry of Object.values(state.items)) {
      const dismissed = state.dismissed[entry.id]
      if (dismissed && dismissed.version === entry.version) continue

      let receivedMs: number
      try {
        receivedMs = Instant.from(entry.receivedAt).epochMilliseconds
      } catch {
        continue
      }
      const ageHours = Math.max(0, (nowMs - receivedMs) / 3_600_000)
      if (isNeedsResponseExpired(ageHours, expiryDays)) continue

      const resolved = resolveSender(
        { name: entry.senderName, email: entry.senderEmail, phone: entry.senderPhone },
        lookup,
      )
      if (
        !isSenderEligible({
          registered: resolved.registered,
          ownerParticipated: entry.ownerParticipated,
          hasPriorHistory: entry.hasPriorHistory,
          resolvedBeeperName: entry.resolvedBeeperName,
        })
      ) {
        continue
      }

      visible.push(toPublicItem(entry, nowMs, lookup))
    }

    return sortNeedsResponseItems(visible)
  }

  const list = async () => {
    const state = await readStateSafely(statePath)
    if (state.lastScanAt) {
      try {
        lastScanMs = Math.max(lastScanMs, Instant.from(state.lastScanAt).epochMilliseconds)
      } catch {
        // Ignore bad timestamp
      }
    }
    return { items: projectItems(state), lastScanAt: state.lastScanAt }
  }

  const performScan = async (): Promise<NeedsResponseScanReport> => {
    const now = nowFn()
    const today = todayFn()
    const timezone = options.getTimezone()
    const [ownerNames, ownerAddresses] = await Promise.all([
      options.getOwnerNames().catch(() => [] as string[]),
      options.getOwnerAddresses?.().catch(() => [] as string[]) ?? Promise.resolve([] as string[]),
    ])
    const senderLookup = options.getSenderLookup()
    const initialState = await readStateSafely(statePath)
    const errors: string[] = []

    // 1. Scan captured Slack & Beeper conversations in actions/messages/.
    let captureCandidates: NeedsResponseCandidate[] = []
    try {
      captureCandidates = await scanCapturedConversations({
        markdownBaseDir: options.markdownBaseDir,
        timeDir: options.timeDir,
        slackDmsDir: options.slackDmsDir,
        slackFollowActiveDir: options.slackFollowActiveDir,
        today,
        now,
        timezone,
        ownerNames,
        ownerAddresses,
        lookbackDays: expiryDays,
      })
    } catch (error) {
      errors.push(`Captures: ${error instanceof Error ? error.message : String(error)}`)
    }

    // 2. Scan live Gmail Inbox directly (read-only, no sky/follow label needed).
    let gmailCandidates: NeedsResponseCandidate[] = []
    let nextGmailCache = initialState.gmailThreads
    let gmailThreadsChecked = 0
    if (options.gmail) {
      const gmailResult = await scanGmailInbox({
        client: options.gmail,
        previousCache: initialState.gmailThreads,
        now,
        timezone,
        ownerNames,
        ownerAddresses,
        senderLookup,
        lookbackDays: expiryDays,
      })
      gmailCandidates = gmailResult.candidates
      nextGmailCache = gmailResult.nextCache
      gmailThreadsChecked = gmailResult.threadsChecked
      errors.push(...gmailResult.errors)
    }

    // 3. Combine candidates (deduped by canonical id) and apply the sender registration gate.
    const candidateById = new Map<string, NeedsResponseCandidate>()
    for (const candidate of [...captureCandidates, ...gmailCandidates]) {
      const resolved = resolveSender(
        { name: candidate.senderName, email: candidate.senderEmail, phone: candidate.senderPhone },
        senderLookup,
      )
      if (
        !isSenderEligible({
          registered: resolved.registered,
          ownerParticipated: candidate.ownerParticipated,
          hasPriorHistory: candidate.hasPriorHistory,
          resolvedBeeperName: candidate.resolvedBeeperName,
        })
      ) {
        continue
      }
      candidateById.set(candidate.id, candidate)
    }

    // 4. Screen candidates with Jev, reusing cached verdicts for unchanged versions.
    const screen = options.createScreen ? await options.createScreen() : null
    const ownerName = ownerNames[0] ?? 'Owner'
    const nowStr = now.toString()
    const pruneBeforeMs = now.epochMilliseconds - CACHE_RETENTION_DAYS * 24 * 3_600_000
    const nextScreens: Record<string, { needsResponse: number; ownerAddressed: number; checkedAt: string }> = {}
    for (const [key, receipt] of Object.entries(initialState.screens)) {
      try {
        if (Instant.from(receipt.checkedAt).epochMilliseconds >= pruneBeforeMs) {
          nextScreens[key] = receipt
        }
      } catch {
        // Drop malformed entries
      }
    }

    const nextItems: Record<string, StoredNeedsResponseEntry> = {}
    let screenedCount = 0

    for (const candidate of candidateById.values()) {
      // Preserve an existing screened item if Jev is temporarily unreachable and the version didn't change.
      const priorItem = initialState.items[candidate.id]
      let verdict: { needsResponse: number; ownerAddressed: number } | null = null

      if (screen) {
        const key = screenCacheKey(candidate, screen.version)
        const cached = nextScreens[key]
        if (cached) {
          verdict = { needsResponse: cached.needsResponse, ownerAddressed: cached.ownerAddressed }
        } else {
          screenedCount++
          const fresh = await screen.assess({ candidate, ownerName, today: today.ymd })
          if (fresh) {
            verdict = fresh
            nextScreens[key] = { ...fresh, checkedAt: nowStr }
          } else if (priorItem && priorItem.version === candidate.version) {
            verdict = priorItem.screen
          }
        }
      } else if (priorItem && priorItem.version === candidate.version) {
        verdict = priorItem.screen
      }

      if (!verdict || !passesNeedsResponseScreen(verdict)) continue

      nextItems[candidate.id] = {
        id: candidate.id,
        version: candidate.version,
        source: candidate.source,
        medium: candidate.medium,
        kind: candidate.kind,
        senderName: candidate.senderName,
        ...(candidate.senderEmail ? { senderEmail: candidate.senderEmail } : {}),
        ...(candidate.senderPhone ? { senderPhone: candidate.senderPhone } : {}),
        ...(candidate.contextLabel ? { contextLabel: candidate.contextLabel } : {}),
        summary: candidate.summary,
        receivedAt: candidate.receivedAt,
        receivedLocal: candidate.receivedLocal,
        ownerParticipated: candidate.ownerParticipated,
        ...(candidate.hasPriorHistory ? { hasPriorHistory: true } : {}),
        ...(candidate.resolvedBeeperName ? { resolvedBeeperName: true } : {}),
        target: candidate.target,
        ...(candidate.savedPath ? { savedPath: candidate.savedPath } : {}),
        screen: verdict,
      }
    }

    // 5. Commit updated state atomically while preserving any concurrent dismissals made during the scan.
    await withProcessLock(lockPath, async () => {
      const latest = await readStateSafely(statePath)
      const dismissed: NeedsResponseStateFile['dismissed'] = {}
      for (const [id, entry] of Object.entries(latest.dismissed)) {
        try {
          if (Instant.from(entry.dismissedAt).epochMilliseconds >= pruneBeforeMs) {
            dismissed[id] = entry
          }
        } catch {
          // Drop malformed entries
        }
      }
      await writeJson(
        statePath,
        {
          version: STATE_VERSION,
          lastScanAt: nowStr,
          items: nextItems,
          dismissed,
          screens: nextScreens,
          gmailThreads: nextGmailCache,
        } satisfies NeedsResponseStateFile,
        2,
      )
    })

    lastScanMs = now.epochMilliseconds
    return {
      scannedAt: nowStr,
      capturesFound: captureCandidates.length,
      gmailThreadsChecked,
      screened: screenedCount,
      active: Object.keys(nextItems).length,
      errors,
    }
  }

  const scan = async (): Promise<NeedsResponseScanReport> => {
    if (!activeScan) {
      activeScan = performScan().finally(() => {
        activeScan = null
      })
    }
    return activeScan
  }

  const dismiss = async (id: string, version: string) => {
    const state = await withProcessLock(lockPath, async () => {
      const current = await readStateSafely(statePath)
      current.dismissed[id] = { version, dismissedAt: nowFn().toString() }
      await writeJson(statePath, current, 2)
      return current
    })
    return { items: projectItems(state), lastScanAt: state.lastScanAt }
  }

  const undismiss = async (id: string) => {
    const state = await withProcessLock(lockPath, async () => {
      const current = await readStateSafely(statePath)
      delete current.dismissed[id]
      await writeJson(statePath, current, 2)
      return current
    })
    return { items: projectItems(state), lastScanAt: state.lastScanAt }
  }

  const openInApp = async (id: string) => {
    const state = await readStateSafely(statePath)
    const entry = state.items[id]
    if (!entry || entry.target?.medium !== 'Beeper') {
      throw new Error('This conversation cannot be opened directly in Beeper.')
    }
    if (!options.openBeeper) {
      throw new Error('Beeper is not connected.')
    }
    await options.openBeeper(entry.target.chat)
  }

  const refreshIfStale = () => {
    if (activeScan) return
    if (nowFn().epochMilliseconds - lastScanMs < STALE_SCAN_MS) return
    void scan().catch(() => {})
  }

  return { list, scan, dismiss, undismiss, openInApp, refreshIfStale }
}
