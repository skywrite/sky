import {
  ensureLabel,
  getThread,
  GoogleApiError,
  listLabels,
  modifyThread,
  threadIdFromDecimal,
} from '#lib/google/mod.ts'
import type { GoogleClient } from '#lib/google/mod.ts'
import type EmailFollowRegistry from '#shared/models/Follow/EmailFollowRegistry.ts'
import { archivedLabelName } from './followLabels.ts'

export type BackfillResult = {
  candidates: number
  labeled: number
  wouldLabel: number
  alreadyLabeled: number
  skipped: number
  errors: string[]
}

/** Repair historical markers only. Never change INBOX, read status, captures, or watches. */
export async function backfillArchivedFollows(opts: {
  client: GoogleClient
  registry: EmailFollowRegistry
  label: string
  apply: boolean
  sleep?: (ms: number) => Promise<void>
  onProgress?: (result: Readonly<BackfillResult>) => void
}): Promise<BackfillResult> {
  const { client, registry, label, apply } = opts
  if (registry.errors.length > 0)
    throw new Error('Some follow records could not be read; repair them before backfilling labels.')
  const result: BackfillResult = { candidates: 0, labeled: 0, wouldLabel: 0, alreadyLabeled: 0, skipped: 0, errors: [] }
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  // A history repair shares the user's quota with the regular heartbeat.
  // Gmail also reports rate limits as 403, which the shared client doesn't retry.
  const request = async <T>(run: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      await sleep(250)
      try {
        return await run()
      } catch (error) {
        if (!isQuotaError(error) || attempt >= 5) throw error
        await sleep(Math.min(30_000, 5_000 * 2 ** attempt))
      }
    }
  }
  const labels = await request(() => listLabels(client))
  const name = archivedLabelName(label)
  let archived = labels.find((l) => l.name.toLowerCase() === name.toLowerCase())
  const entryIds = new Set(
    labels
      .filter((l) => [label.toLowerCase(), `${label}/Now`.toLowerCase()].includes(l.name.toLowerCase()))
      .map((l) => l.id),
  )
  const ids = new Set(
    registry
      .getAll()
      .filter(
        ({ follow }) =>
          follow.status === 'closed' &&
          follow.messages.length > 0 &&
          follow.ref.account?.toLowerCase() === client.email.toLowerCase() &&
          follow.ref.label?.toLowerCase() === label.toLowerCase(),
      )
      .map(({ follow }) => follow.ref.threadId)
      .filter(Boolean),
  )

  for (const threadId of ids) {
    // A duplicate old archive must never mark a current watch as closed.
    if (registry.findByThreadId(threadId, client.email)?.follow.status !== 'closed') {
      result.skipped++
      continue
    }
    result.candidates++
    try {
      const apiId = threadIdFromDecimal(threadId)
      const messages = await request(() => getThread(client, apiId))
      if (messages.length === 0 || messages.some((m) => m.labelIds.some((id) => entryIds.has(id)))) {
        result.skipped++
        continue
      }
      // One labeled message is enough to associate the marker with the thread.
      // A later reply is not evidence that the marker needs to be reapplied.
      const archivedId = archived?.id
      if (archivedId && messages.some((m) => m.labelIds.includes(archivedId))) {
        result.alreadyLabeled++
        continue
      }
      if (!apply) {
        result.wouldLabel++
        continue
      }
      archived ??= await request(() => ensureLabel(client, name))
      const addLabelIds = [archived.id]
      await request(() => modifyThread(client, apiId, { addLabelIds }))
      result.labeled++
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 404) result.skipped++
      else {
        result.errors.push(`${threadId}: ${error instanceof Error ? error.message : String(error)}`)
        if (isQuotaError(error)) break
      }
    } finally {
      opts.onProgress?.(result)
    }
  }
  return result
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof GoogleApiError &&
    (error.status === 429 || (error.status === 403 && /quota|rate.?limit/i.test(error.message)))
  )
}
