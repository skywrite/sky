import { ensureLabel, listLabels, modifyThread } from '#lib/google/mod.ts'
import type { GoogleClient } from '#lib/google/mod.ts'

export function archivedLabelName(label: string): string {
  return label.endsWith('/Follow') ? `${label.slice(0, -'/Follow'.length)}/Archived` : `${label}/Archived`
}

/** Closing a saved watch leaves evidence in Gmail. Unsaved threads get no archive marker. */
export async function retireGmailThread(opts: {
  client: GoogleClient
  threadId: string
  label: string
  saved: boolean
}): Promise<void> {
  const { client, threadId, label, saved } = opts
  const labels = await listLabels(client)
  const retiringNames = new Set([label.toLowerCase(), `${label}/Now`.toLowerCase()])
  const removeLabelIds = labels.filter((l) => retiringNames.has(l.name.toLowerCase())).map((l) => l.id)
  const archived = saved ? await ensureLabel(client, archivedLabelName(label)) : undefined
  await modifyThread(client, threadId, {
    addLabelIds: archived ? [archived.id] : [],
    removeLabelIds: [...removeLabelIds, 'INBOX'],
  })
}
