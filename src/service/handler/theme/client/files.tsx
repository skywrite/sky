import { useEffect, useRef } from 'react'
import { type ListedFile, type Locate, type Located, post, uploadBytes } from './keep.ts'

export { sizeLabel } from './keep.ts'

/**
 * A file kept with the day. A drop carries bytes, a name, a size and a
 * modified time — never a path — so keeping starts with the service
 * looking for the original on this Mac. Found, the file moves and nothing
 * uploads; not found, the bytes go up and a copy lands. The pad that takes
 * the drop sits at the foot of the day's rail (dayRail.tsx); this file is
 * the keep itself and the toast that says what happened.
 */

// -----------------------------------------------------------------------------
// What the service says
// -----------------------------------------------------------------------------

/** A file in the day's directory, as the service lists it. */
export type DayFile = ListedFile

/** What keeping did — the toast's words, and what Undo reverses. */
export interface Kept {
  ymd: string
  name: string
  moved: boolean
  moveId: string | null
  from: Located | null
  /** The file was already among the day's files; nothing happened */
  already?: boolean
}

/** The name, the day, and — when there is one to move — which original. */
export interface KeepChoice {
  name: string
  ymd: string
  path: string | null
}

/** The look for the original, from the three facts the drop carries. */
export function locateFile(file: File, ymd: string): Promise<Locate> {
  return post<Locate>(`/day/${ymd}/files/locate`, { name: file.name, size: file.size, lastModified: file.lastModified })
}

/** A copy into the day's files. */
async function uploadFile(
  file: File,
  ymd: string,
  name: string,
  onProgress: (fraction: number) => void,
): Promise<DayFile> {
  const url = `/day/${ymd}/files?name=${encodeURIComponent(name)}`
  return (await uploadBytes<{ file: DayFile }>(url, file, onProgress)).file
}

/** Keep the file with the day: the original moves when the look found it, else a copy lands. */
async function keepFile(
  file: File,
  locate: Locate | null,
  choice: KeepChoice,
  onProgress: (fraction: number) => void,
): Promise<Kept> {
  const name = choice.name.trim()
  if (locate && choice.path) {
    const moved = await post<{ file: DayFile; moveId: string; from: Located }>(`/day/${choice.ymd}/files/move`, {
      token: locate.token,
      path: choice.path,
      name,
    })
    return { ymd: choice.ymd, name: moved.file.name, moved: true, moveId: moved.moveId, from: moved.from }
  }
  const copied = await uploadFile(file, choice.ymd, name, onProgress)
  return { ymd: choice.ymd, name: copied.name, moved: false, moveId: null, from: null }
}

export async function undoKeep(kept: Kept[]): Promise<void> {
  for (const k of kept) if (k.moveId) await post(`/day/${k.ymd}/files/undo`, { moveId: k.moveId })
}

/**
 * The pad's move: no questions. The original moves under its own name when
 * the look finds it (the likelier folder when two hold it); otherwise the
 * bytes land as a copy. A file already in the day stays as it is.
 */
export async function moveIn(file: File, ymd: string, onProgress: (fraction: number) => void): Promise<Kept> {
  const locate = await locateFile(file, ymd).catch(
    (): Locate => ({
      token: '',
      match: null,
      ambiguous: [],
      already: false,
    }),
  )
  if (locate.already) return { ymd, name: file.name, moved: false, moveId: null, from: null, already: true }
  const path = locate.match?.path ?? locate.ambiguous[0]?.path ?? null
  return keepFile(file, locate, { name: file.name, ymd, path }, onProgress)
}

/** "today" on today, else the day itself. */
export function dayWord(ymd: string, todayYmd: string | null): string {
  return ymd === todayYmd ? 'today' : ymd
}

// -----------------------------------------------------------------------------
// The toast after a keep
// -----------------------------------------------------------------------------

const TOAST_MS = 8000

/** "Moved report.pdf to today · Undo" — the door held for eight seconds, like a checked box. */
/** The toast's sentence for one keep or a batch. */
export function keptLine(kept: Kept[], todayYmd: string | null): string {
  const first = kept[0]
  if (!first) return ''
  const day = dayWord(first.ymd, todayYmd)
  if (kept.length === 1) {
    if (first.already) return `“${first.name}” is already among ${day}’s files`
    return first.moved
      ? `Moved “${first.name}” to ${day}${first.from ? ` from ${first.from.where}` : ''}`
      : `Kept a copy of “${first.name}” with ${day}`
  }
  const moved = kept.filter((k) => k.moved).length
  const copied = kept.filter((k) => !k.moved && !k.already).length
  const parts: string[] = []
  if (moved > 0) parts.push(`Moved ${moved} file${moved === 1 ? '' : 's'} to ${day}`)
  if (copied > 0) parts.push(`${moved > 0 ? 'kept' : 'Kept'} ${copied} cop${copied === 1 ? 'y' : 'ies'}`)
  return parts.join(', ')
}

export function KeptToast({
  kept,
  todayYmd,
  onUndo,
  onDone,
}: {
  kept: Kept[]
  todayYmd: string | null
  onUndo: () => void
  onDone: () => void
}) {
  // The timer runs per keep; a parent's re-render must not restart it.
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    const timer = window.setTimeout(() => done.current(), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [kept])
  const undoable = kept.some((k) => k.moved)
  return (
    <div className="sky-undo">
      <span className="sky-undo-text">{keptLine(kept, todayYmd)}</span>
      {undoable && (
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
