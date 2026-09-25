import { useEffect } from 'react'
import { Cross } from './day.tsx'
import { shortName } from './dayFiles.tsx'

/**
 * Delete, from the ⋯ menu of a file open in the explorer: the file goes to the
 * Trash, the day that listed it lets go of the line, and the toast holds Undo
 * for a moment. The tree hears that a directory changed through a window
 * event, the way the automations page hears about its own, and lists it again.
 */

const CHANGED = 'sky-explorer-changed'

/** The toast holds Undo this long — the same moment the day's Files page gives. */
export const TOAST_MS = 8000

/** Tell the tree a directory's entries changed. */
export function announceChanged(dir: string): void {
  window.dispatchEvent(new CustomEvent<string>(CHANGED, { detail: dir }))
}

/** The tree listening for that. */
export function useDirChanges(relist: (dir: string) => void): void {
  useEffect(() => {
    const onChanged = (event: Event) => relist((event as CustomEvent<string>).detail)
    window.addEventListener(CHANGED, onChanged)
    return () => window.removeEventListener(CHANGED, onChanged)
  }, [relist])
}

/** The day that let go of its line, as the service names it. */
export interface RemovedDay {
  ymd: string
  label: string
  lines: number
}

export interface Removed {
  /** Quotes the delete to undo it, for a while */
  moveId: string
  /** The notebook path the file had */
  file: string
  day: RemovedDay | null
}

/** What the column shows after a delete: the sentence, and the handle while Undo is still offered. */
export interface RemoveToast {
  key: number
  text: string
  file: string
  moveId: string | null
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const answer = (await r.json().catch(() => ({}))) as T & { message?: string }
  if (!r.ok) throw new Error(answer.message ?? `The service answered ${r.status}`)
  return answer
}

export async function removeFile(file: string): Promise<Removed> {
  const answer = await post<{ moveId: string; day: RemovedDay | null }>('/explorer/_api/remove', { path: file })
  return { moveId: answer.moveId, file, day: answer.day }
}

export async function undoRemove(moveId: string): Promise<void> {
  await post('/explorer/_api/undo', { moveId })
}

/** The toast's sentence: where the file went, and the day that no longer lists it. */
export function removedLine(file: string, day: RemovedDay | null): string {
  const name = shortName(file.split('/').pop()?.replace(/\.md$/i, '') ?? file)
  return day ? `Moved “${name}” to the Trash, and off ${day.label}` : `Moved “${name}” to the Trash`
}

export function RemovedToast({ toast, onUndo }: { toast: RemoveToast; onUndo: () => void }) {
  return (
    <div className="sky-undo sky-doc-undo" data-failed={toast.moveId === null ? 'true' : undefined}>
      <span className="sky-undo-tick" data-how="deleted">
        <Cross />
      </span>
      <span className="sky-undo-text">{toast.text}</span>
      {toast.moveId && (
        <button type="button" className="sky-undo-btn" onClick={onUndo}>
          Undo
        </button>
      )}
      <span className="sky-undo-track">
        <span className="sky-undo-fill" />
      </span>
    </div>
  )
}
