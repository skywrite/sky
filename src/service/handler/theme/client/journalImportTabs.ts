import type { ImportJob } from './import.tsx'

const pending = new Set<string>()
const opened = new Set<string>()
const key = (id: string) => `sky:journal-import:${id}`

/** Only the tab in which the person starts/accepts this import opens its results. */
export function expectJournalTabs(id: string) {
  pending.add(id)
  try {
    sessionStorage.setItem(key(id), 'pending')
  } catch {
    /* In-memory tracking still works. */
  }
}

export async function openJournalTabs(id: string, once = false): Promise<void> {
  const response = await fetch(`/import/${encodeURIComponent(id)}/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ once }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message ?? 'The journal tabs could not be opened.')
  }
}

export function openCompletedJournals(job: ImportJob) {
  if (job.fields?.kind !== 'journal' || job.state !== 'done' || !job.result || opened.has(job.id)) return
  let expected = pending.has(job.id)
  try {
    expected ||= sessionStorage.getItem(key(job.id)) === 'pending'
  } catch {
    /* See above. */
  }
  if (!expected) return
  // Mark the attempt before requesting: SSE and the background poll can both report completion.
  opened.add(job.id)
  pending.delete(job.id)
  try {
    sessionStorage.setItem(key(job.id), 'opening')
  } catch {
    /* See above. */
  }
  void openJournalTabs(job.id, true).then(
    () => {
      try {
        sessionStorage.setItem(key(job.id), 'opened')
      } catch {
        /* See above. */
      }
    },
    () => {
      // Keep the saved links and explicit Open journals action available after a failed attempt.
      try {
        sessionStorage.setItem(key(job.id), 'failed')
      } catch {
        /* See above. */
      }
    },
  )
}
