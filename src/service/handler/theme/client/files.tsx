import { Button } from '@mantine/core'
import { type DragEvent, Fragment, useEffect, useRef, useState } from 'react'

/**
 * A file kept with the day. A drop carries bytes, a name, a size and a
 * modified time — never a path — so keeping starts with the service
 * looking for the original on this Mac. Found, the file moves and nothing
 * uploads; not found, the bytes go up and a copy lands. The Files block
 * lists the day's directory as it is, so what the doors attach and what
 * the editor pastes show there too.
 */

// -----------------------------------------------------------------------------
// What the service says
// -----------------------------------------------------------------------------

export type FileKind = 'image' | 'audio' | 'video' | 'pdf' | 'text' | 'document' | 'archive' | 'file'

export interface DayFile {
  name: string
  size: number
  /** ISO */
  modified: string
  kind: FileKind
}

export interface Located {
  path: string
  /** "Desktop", "Downloads" — the folder, as a person says it */
  where: string
}

/** What the look for the original found. */
export interface Locate {
  token: string
  match: Located | null
  ambiguous: Located[]
  already: boolean
}

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

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

/** "3.9 MB", "12 KB" */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function dayFileHref(ymd: string, name: string): string {
  return `/day/${ymd}/files/${encodeURIComponent(name)}`
}

export async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await r.json().catch(() => ({}))) as T & { message?: string }
  if (!r.ok) throw new Error(data.message ?? `${r.status}`)
  return data
}

/** The look for the original, from the three facts the drop carries. */
export function locateFile(file: File, ymd: string): Promise<Locate> {
  return post<Locate>(`/day/${ymd}/files/locate`, { name: file.name, size: file.size, lastModified: file.lastModified })
}

/** The bytes PUT to a URL, with progress that is real: the one wait a copy has. The answer, parsed. */
export function uploadBytes<T>(url: string, file: File, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as T & { message?: string }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body)
        else reject(new Error(body.message ?? `Upload failed (${xhr.status})`))
      } catch {
        reject(new Error('Upload failed'))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed'))
    xhr.send(file)
  })
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
    (): Locate => ({ token: '', match: null, ambiguous: [], already: false }),
  )
  if (locate.already) return { ymd, name: file.name, moved: false, moveId: null, from: null, already: true }
  const path = locate.match?.path ?? locate.ambiguous[0]?.path ?? null
  return keepFile(file, locate, { name: file.name, ymd, path }, onProgress)
}

export async function removeDayFile(ymd: string, name: string): Promise<void> {
  await post(`/day/${ymd}/files/remove`, { name })
}

/** The day's files, re-read whenever `generation` moves. */
export function useDayFiles(ymd: string | null, generation = 0): { files: DayFile[]; refresh: () => void } {
  const [files, setFiles] = useState<DayFile[]>([])
  const [own, setOwn] = useState(0)
  useEffect(() => {
    if (!ymd) {
      setFiles([])
      return
    }
    let alive = true
    fetch(`/day/${ymd}/files`)
      .then((r) => (r.ok ? r.json() : { files: [] }))
      .then((body) => alive && setFiles((body as { files: DayFile[] }).files))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [ymd, generation, own])
  return { files, refresh: () => setOwn((n) => n + 1) }
}

/** "today" on today, else the day itself. */
export function dayWord(ymd: string, todayYmd: string | null): string {
  return ymd === todayYmd ? 'today' : ymd
}

// -----------------------------------------------------------------------------
// The Files block on the day, and the toast after a keep
// -----------------------------------------------------------------------------

const EXT_LABEL: Partial<Record<FileKind, string>> = { image: 'IMG', audio: 'AUD', video: 'VID', pdf: 'PDF' }

/** The chip beside a file: its extension, or the kind when the extension says less. */
function extChip(file: DayFile): string {
  const ext = extOf(file.name).slice(1).toUpperCase()
  return ext.length > 0 && ext.length <= 5 ? ext : (EXT_LABEL[file.kind] ?? 'FILE')
}

/** `HH:MM` from the file's own modified time, in the browser's zone. */
function modifiedClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/**
 * The Files panel: the drop pad, then the day's directory as it is. A file
 * dropped on the pad moves in without a question — the page's drop hook
 * leaves anything inside `data-drop-pad` to the pad.
 */
export function FilesPanel({
  ymd,
  files,
  onChanged,
  onKept,
}: {
  ymd: string
  files: DayFile[]
  onChanged: () => void
  /** Every file the pad just moved or copied, for the toast */
  onKept: (kept: Kept[]) => void
}) {
  const [over, setOver] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')
  const remove = async (name: string) => {
    setRemoving(name)
    try {
      await removeDayFile(ymd, name)
      onChanged()
    } finally {
      setRemoving(null)
    }
  }
  const drop = async (event: DragEvent) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    setOver(0)
    const dropped: File[] = event.dataTransfer ? Array.from(event.dataTransfer.files) : []
    if (dropped.length === 0 || busy) return
    const kept: Kept[] = []
    setProblem(null)
    try {
      for (const file of dropped) {
        setBusy(`Moving ${file.name}…`)
        kept.push(
          await moveIn(file, ymd, (fraction) => setBusy(`Copying ${file.name} · ${Math.round(fraction * 100)}%`)),
        )
        onChanged()
      }
    } catch (err) {
      setProblem((err as Error).message)
    } finally {
      setBusy(null)
    }
    if (kept.length > 0) onKept(kept)
  }
  return (
    <div
      className="sky-block sky-files"
      data-drop-pad=""
      data-over={over > 0 ? '' : undefined}
      onDragEnter={(e) => hasFiles(e) && setOver((n) => n + 1)}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDragLeave={(e) => hasFiles(e) && setOver((n) => Math.max(0, n - 1))}
      onDrop={(e) => void drop(e)}
    >
      <div className="sky-block-head sky-bhead">
        Files
        <span className="sky-spacer" />
        {files.length > 0 && <span className="sky-count">{files.length}</span>}
      </div>
      <div className="sky-block-pad">
        <div className="sky-pad" data-busy={busy ? '' : undefined}>
          {busy ?? 'Drop files here to move them into the day'}
        </div>
        {problem && <div className="sky-pad-problem">{problem}</div>}
        {files.map((f) => (
          <Fragment key={f.name}>
            <div className="sky-file" data-gone={removing === f.name ? '' : undefined}>
              <span className="sky-dat">{modifiedClock(f.modified)}</span>
              <span className="sky-file-ext">{extChip(f)}</span>
              <span className="sky-file-name">
                <a href={dayFileHref(ymd, f.name)} target="_blank" rel="noreferrer">
                  {f.name}
                </a>
              </span>
              <span className="sky-file-size">{sizeLabel(f.size)}</span>
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                onClick={() => void remove(f.name)}
                disabled={removing !== null}
              >
                Remove
              </Button>
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

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
