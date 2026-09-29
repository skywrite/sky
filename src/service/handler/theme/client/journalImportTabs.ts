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

export function openJournalFiles(files: string[]) {
  for (const file of new Set(files)) {
    const href = `/explorer/${file.split('/').map(encodeURIComponent).join('/')}`
    window.open(href, '_blank', 'noopener')
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
  // Mark before opening: SSE and the background poll can both report completion.
  opened.add(job.id)
  pending.delete(job.id)
  try {
    sessionStorage.setItem(key(job.id), 'opened')
  } catch {
    /* See above. */
  }
  openJournalFiles(job.result.files ?? [job.result.file])
}
