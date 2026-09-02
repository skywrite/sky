/**
 * A file added to a document from the rail: dropped on the Files section, or picked in a dialog
 * that shows what is beside the document already and can bring a file in from this Mac. For a
 * file brought in, the service looks for the original first and, finding it, moves it in beside
 * the document — nothing uploads; not found, the bytes go up and a copy lands. Either way the
 * name joins the document's `attachments:` list, the way every capture records its files.
 */

import { Button, Checkbox, Drawer, FileButton, Modal } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { type DragEvent, useEffect, useState } from 'react'
import { type ListedFile, type Locate, type Located, post, sizeLabel, uploadBytes } from '../keep.ts'

/** What adding did — the note's words, and what Undo reverses. */
export interface Attached {
  name: string
  moved: boolean
  moveId: string | null
  from: Located | null
  /** The file was beside the document already; only the list changed */
  already: boolean
}

function api(route: 'attach' | 'attach-locate' | 'attach-move', file: string): string {
  return `/docs/_api/${route}/${file.split('/').map(encodeURIComponent).join('/')}`
}

/** The files beside the document, as the service lists its directory. */
export async function listBeside(doc: string): Promise<ListedFile[]> {
  const r = await fetch(api('attach', doc))
  const body = (await r.json().catch(() => ({}))) as { files?: ListedFile[]; message?: string }
  if (!r.ok) throw new Error(body.message ?? `${r.status}`)
  return body.files ?? []
}

const NOT_FOUND: Locate = { token: '', match: null, ambiguous: [], already: false }

/**
 * The original moves in when the look finds it (the likelier folder when two hold it); otherwise
 * the bytes land as a copy. A file already beside the document stays as it is.
 */
export async function attachFile(file: File, doc: string, onProgress: (fraction: number) => void): Promise<Attached> {
  const locate = await post<Locate>(api('attach-locate', doc), {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
  }).catch(() => NOT_FOUND)
  if (locate.already) return listedOnly(file.name)
  const original = locate.match?.path ?? locate.ambiguous[0]?.path ?? null
  if (original) {
    const moved = await post<{ file: string; moveId: string; from: Located }>(api('attach-move', doc), {
      token: locate.token,
      path: original,
      name: file.name,
    })
    return { name: moved.file, moved: true, moveId: moved.moveId, from: moved.from, already: false }
  }
  const url = `${api('attach', doc)}?name=${encodeURIComponent(file.name)}`
  const copied = await uploadBytes<{ file: string }>(url, file, onProgress)
  return { name: copied.file, moved: false, moveId: null, from: null, already: false }
}

/** A file that was beside the document all along: nothing moved, the list gained its name. */
function listedOnly(name: string): Attached {
  return { name, moved: false, moveId: null, from: null, already: true }
}

/** Every move in the batch goes back where it came from. */
export async function undoAttach(attached: Attached[]): Promise<void> {
  for (const a of attached) if (a.moveId) await post('/docs/_api/attach-undo', { moveId: a.moveId })
}

/** The note's sentence for one file or a batch. */
export function attachedLine(attached: Attached[]): string {
  const first = attached[0]
  if (!first) return ''
  if (attached.length === 1) {
    if (first.already) return `Listed “${first.name}”`
    if (first.moved) return `Moved “${first.name}” here${first.from ? ` from ${first.from.where}` : ''}`
    return `Kept a copy of “${first.name}” here`
  }
  const moved = attached.filter((a) => a.moved).length
  const copied = attached.filter((a) => !a.moved && !a.already).length
  const listed = attached.filter((a) => a.already).length
  const files = (n: number) => `${n} file${n === 1 ? '' : 's'}`
  const parts: string[] = []
  if (moved > 0) parts.push(`moved ${files(moved)} here`)
  if (copied > 0) parts.push(`kept ${copied} cop${copied === 1 ? 'y' : 'ies'}`)
  if (listed > 0) parts.push(`listed ${files(listed)}`)
  const line = parts.join(', ')
  return line.charAt(0).toUpperCase() + line.slice(1)
}

/** The extension as a chip, or the kind when the extension says less. */
function extChip(file: ListedFile): string {
  const dot = file.name.lastIndexOf('.')
  const ext = dot > 0 ? file.name.slice(dot + 1).toUpperCase() : ''
  return ext.length > 0 && ext.length <= 5 ? ext : file.kind.toUpperCase()
}

/**
 * The dialog behind "choose files…": what is beside the document already, the listed ones
 * marked, the rest there to tick — and a way in from this Mac. A sheet on a phone.
 */
function AttachDialog({
  file,
  listed,
  opened,
  onClose,
  onPick,
  onBring,
}: {
  file: string
  /** The names the document lists already */
  listed: string[]
  opened: boolean
  onClose: () => void
  /** Names ticked in the dialog */
  onPick: (names: string[]) => void
  /** Files chosen from this Mac */
  onBring: (files: File[]) => void
}) {
  const phone = useMediaQuery('(max-width: 900px)') ?? false
  const [beside, setBeside] = useState<ListedFile[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!opened) return
    let alive = true
    setBeside(null)
    setPicked(new Set())
    setProblem(null)
    listBeside(file)
      .then((files) => alive && setBeside(files))
      .catch((err: Error) => {
        if (!alive) return
        setProblem(err.message)
        setBeside([])
      })
    return () => {
      alive = false
    }
  }, [opened, file])
  const toggle = (name: string) =>
    setPicked((previous) => {
      const next = new Set(previous)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  const body = (
    <div className={`sky-confirm sky-attach-dialog${phone ? ' sky-sheet' : ''}`}>
      {phone ? <div className="sky-sheet-handle" /> : null}
      <div className="sky-confirm-title">Add files</div>
      {beside === null ? (
        <p className="sky-attach-empty">Looking…</p>
      ) : beside.length === 0 ? (
        <p className="sky-attach-empty">Nothing beside the document yet.</p>
      ) : (
        <div className="sky-attach-list">
          {beside.map((f) => {
            const on = listed.includes(f.name)
            return (
              <label key={f.name} className="sky-attach-row" data-listed={on ? '' : undefined}>
                <Checkbox
                  checked={on || picked.has(f.name)}
                  disabled={on}
                  onChange={() => toggle(f.name)}
                  aria-label={f.name}
                />
                <span className="sky-file-ext">{extChip(f)}</span>
                <span className="sky-attach-name">{f.name}</span>
                <span className="sky-file-size">{on ? 'listed' : sizeLabel(f.size)}</span>
              </label>
            )
          })}
        </div>
      )}
      {problem ? <p className="sky-rail-problem">{problem}</p> : null}
      <div className="sky-confirm-actions">
        <FileButton onChange={onBring} multiple>
          {(props) => (
            <Button variant="subtle" {...props}>
              From this Mac…
            </Button>
          )}
        </FileButton>
        <Button variant="subtle" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={picked.size === 0} onClick={() => onPick([...picked])}>
          {picked.size > 1 ? `Add ${picked.size} files` : 'Add'}
        </Button>
      </div>
    </div>
  )
  if (phone) {
    return (
      <Drawer
        opened={opened}
        onClose={onClose}
        position="bottom"
        size="auto"
        withCloseButton={false}
        padding={20}
        radius="lg"
        styles={{
          inner: { alignItems: 'flex-end' },
          content: { height: 'auto', flex: '0 0 auto', maxHeight: '92dvh' },
        }}
      >
        {body}
      </Drawer>
    )
  }
  return (
    <Modal opened={opened} onClose={onClose} centered size={520} withCloseButton={false} padding={28} radius="xl">
      {body}
    </Modal>
  )
}

const NOTE_MS = 8000

/**
 * The pad under the document's files: drop on it, or open the dialog. While a file is on its way
 * the pad says so; after, a note says what happened and holds Undo for a moment.
 */
export function AttachFiles({
  file,
  listed,
  onAdd,
  onRemove,
}: {
  /** The document's notebook path */
  file: string
  /** The names the document lists already */
  listed: string[]
  /** A file is beside the document now: list it */
  onAdd: (name: string) => void
  /** A move was undone: unlist it */
  onRemove: (name: string) => void
}) {
  const [over, setOver] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [attached, setAttached] = useState<Attached[] | null>(null)
  const [dialog, setDialog] = useState(false)
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')

  useEffect(() => {
    if (!attached) return
    const timer = window.setTimeout(() => setAttached(null), NOTE_MS)
    return () => window.clearTimeout(timer)
  }, [attached])

  const take = async (files: File[]) => {
    if (files.length === 0 || busy) return
    setProblem(null)
    setAttached(null)
    const done: Attached[] = []
    try {
      for (const f of files) {
        setBusy(`Adding ${f.name}…`)
        const result = await attachFile(f, file, (fraction) =>
          setBusy(`Copying ${f.name} · ${Math.round(fraction * 100)}%`),
        )
        onAdd(result.name)
        done.push(result)
      }
    } catch (err) {
      setProblem((err as Error).message)
    } finally {
      setBusy(null)
    }
    if (done.length > 0) setAttached(done)
  }

  const pick = (names: string[]) => {
    setDialog(false)
    for (const name of names) onAdd(name)
    setAttached(names.map(listedOnly))
  }

  const bring = (files: File[]) => {
    setDialog(false)
    void take(files)
  }

  const undo = async () => {
    const items = attached ?? []
    setAttached(null)
    try {
      await undoAttach(items)
    } catch (err) {
      setProblem((err as Error).message)
      return
    }
    for (const a of items) if (a.moved) onRemove(a.name)
  }

  const drop = (event: DragEvent) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    setOver(0)
    void take(event.dataTransfer ? Array.from(event.dataTransfer.files) : [])
  }

  return (
    <div className="sky-rail-attach">
      <div
        className="sky-rail-pad"
        data-over={over > 0 ? '' : undefined}
        data-busy={busy ? '' : undefined}
        onDragEnter={(e) => hasFiles(e) && setOver((n) => n + 1)}
        onDragOver={(e) => hasFiles(e) && e.preventDefault()}
        onDragLeave={(e) => hasFiles(e) && setOver((n) => Math.max(0, n - 1))}
        onDrop={drop}
      >
        {busy ?? (
          <>
            <span className="sky-rail-drop-words">Drop a file here, or </span>
            <button type="button" className="sky-rail-choose" onClick={() => setDialog(true)}>
              choose files…
            </button>
          </>
        )}
      </div>
      {problem ? <p className="sky-rail-problem">{problem}</p> : null}
      {attached ? (
        <p className="sky-rail-note">
          <span>{attachedLine(attached)}</span>
          {attached.some((a) => a.moved) ? (
            <button type="button" className="sky-rail-undo" onClick={() => void undo()}>
              Undo
            </button>
          ) : null}
        </p>
      ) : null}
      <AttachDialog
        file={file}
        listed={listed}
        opened={dialog}
        onClose={() => setDialog(false)}
        onPick={pick}
        onBring={bring}
      />
    </div>
  )
}
