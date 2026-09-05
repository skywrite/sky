import './import.css'
import { Button, Drawer, Modal, Popover } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import {
  type DragEvent,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import {
  dayLabel,
  normalizeClock,
  type PlaceWhen,
  placeLabel,
  placeWhere,
  restOfWeek,
  shortDate,
  weekdayName,
} from '#universal/dates/whenLabel/mod.ts'
import { fileHref } from './explorer.tsx'
import { sizeLabel } from './files.tsx'
import { DocumentRail } from './frontmatter/Rail.tsx'
import { useFrontmatter } from './frontmatter/useFrontmatter.ts'
import { renderStatic } from './wysiwyg/render.ts'

/**
 * Meeting from a file. A transcript, a recording, a screenshot or a video's
 * .srt dropped on the day becomes an import: the dialog says what sky read
 * in it and settles what it is and when; the Running block shows it working;
 * its own page shows the work as it happens and the questions it stops to
 * ask.
 */

// -----------------------------------------------------------------------------
// What the service says
// -----------------------------------------------------------------------------

export type ImportKind = 'meeting' | 'journal' | 'note' | 'message' | 'event' | 'video'
export type ImportState = 'new' | 'running' | 'needs-you' | 'done' | 'failed' | 'cancelled'

export interface ImportJob {
  id: string
  file: { name: string; size: number; lastModified: number | null }
  readback: {
    source: 'transcript' | 'srt' | 'text' | 'audio' | 'image'
    kinds: ImportKind[]
    summary: string
    detail: string | null
    durationMinutes: number | null
    speakers: string[]
    refusal: string | null
  }
  listen: { kind: ImportKind; opening: string; guess: string } | null
  calendar: {
    title: string
    start: string
    end: string | null
    who: string[]
    relation: 'matches' | 'just-after'
  } | null
  suggestedWhen: string
  /** What an earlier run of the same file left to pick up, when there is one */
  resume: { step: string; started: string } | null
  fields: { kind: ImportKind; when: string; category: 'Professional' | 'Personal'; journalType: string | null } | null
  state: ImportState
  /** The steps the command announced, in the words a person reads */
  plan: PlanStep[] | null
  stage: Stage | null
  tick: Tick | null
  line: string | null
  title: string
  result: { file: string } | null
  error: string | null
  created: string
  when: string
}

export interface ImportOptions {
  journalTypes: string[]
}

interface PlanStep {
  id: string
  label: string
}

interface Stage {
  id: string
  label: string
  detail: string | null
}

interface Tick {
  done: number
  total: number | null
  unit: string | null
}

interface PromptOption {
  value: string
  label: string
  hint?: string
}

interface FormItem {
  id: string
  label: string
  problem: string
  contexts: string[]
  occurrences: number
  suggestion?: string
  alternatives: string[]
}

type FormAnswer = { action: 'accept'; value: string } | { action: 'custom'; value: string } | { action: 'skip' }

interface PlaceItem {
  value: string
  label: string
  hint?: string
  mine: boolean
  when: PlaceWhen
}

/** Accept some items and say when each one happens — see commands/lib/prompt/Prompter.ts */
interface PlacePrompt {
  message: string
  items: PlaceItem[]
  initial: string[]
  today: string
  createdThrough: string | null
  fallback: PlaceWhen
  waiting: number
}

type PlaceAnswer = { value: string; when: PlaceWhen }[]

type PromptOnWire = { id: string } & (
  | { kind: 'text'; prompt: { message: string; placeholder?: string; hint?: string[]; initial?: string } }
  | { kind: 'confirm'; prompt: { message: string; initial?: boolean } }
  | { kind: 'select'; prompt: { message: string; options: PromptOption[]; initial?: string } }
  | { kind: 'multiselect'; prompt: { message: string; options: PromptOption[]; initial?: string[] } }
  | { kind: 'place'; prompt: PlacePrompt }
  | { kind: 'form'; prompt: { title: string; intro?: string; items: FormItem[] } }
)

type ImportEvent = { seq: number } & (
  | { type: 'listen'; listen: NonNullable<ImportJob['listen']> }
  | { type: 'calendar'; calendar: NonNullable<ImportJob['calendar']> }
  | { type: 'plan'; steps: PlanStep[] }
  | { type: 'stage'; stage: Stage }
  | { type: 'tick'; tick: Tick }
  | { type: 'line'; text: string; level: 'log' | 'error' }
  | { type: 'text'; text: string }
  | { type: 'prompt'; prompt: PromptOnWire }
  | { type: 'answered'; id: string; answer?: unknown }
  | { type: 'state'; state: ImportState; line: string | null; result: { file: string } | null; error: string | null }
)

const SETTLED: ReadonlySet<ImportState> = new Set(['done', 'failed', 'cancelled'])

export const KIND_LABEL: Record<ImportKind, string> = {
  meeting: 'Meeting',
  journal: 'Journal',
  note: 'Note',
  message: 'Message',
  event: 'Event',
  video: 'Video',
}

/** What a row says a running import is doing, by the command inside. */
// -----------------------------------------------------------------------------
// Talking to the service
// -----------------------------------------------------------------------------

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await r.json().catch(() => ({}))) as T & { message?: string }
  if (!r.ok) throw new Error(data.message ?? `${r.status}`)
  return data
}

/** The rows for Running and the sidebar, re-read every few seconds like the threads. */
export function useImports(): ImportJob[] {
  const [imports, setImports] = useState<ImportJob[]>([])
  useEffect(() => {
    let alive = true
    const read = () =>
      fetch('/import')
        .then((r) => (r.ok ? r.json() : { imports: [] }))
        .then((body) => alive && setImports((body as { imports: ImportJob[] }).imports))
        .catch(() => {})
    void read()
    const timer = setInterval(read, 2500)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return imports
}

/** The upload, with its bytes as progress — the one bar whose math is real. */
export function uploadImport(
  file: File,
  onProgress: (fraction: number) => void,
): Promise<{ job: ImportJob; options: ImportOptions }> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file, file.name)
    if (file.lastModified) form.append('lastModified', String(file.lastModified))
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/import')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as { job?: ImportJob; options?: ImportOptions; message?: string }
        if (xhr.status >= 200 && xhr.status < 300 && body.job && body.options)
          resolve({ job: body.job, options: body.options })
        else reject(new Error(body.message ?? `Upload failed (${xhr.status})`))
      } catch {
        reject(new Error('Upload failed'))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed'))
    xhr.send(form)
  })
}

interface ImportFeed {
  job: ImportJob | null
  options: ImportOptions | null
  events: ImportEvent[]
  /** The snapshot could not be read — no such import */
  missing: boolean
  refresh: () => void
}

/** One import: its snapshot, and everything it says, live. */
export function useImportFeed(id: string | null): ImportFeed {
  const [job, setJob] = useState<ImportJob | null>(null)
  const [options, setOptions] = useState<ImportOptions | null>(null)
  const [events, setEvents] = useState<ImportEvent[]>([])
  const [missing, setMissing] = useState(false)
  const [generation, setGeneration] = useState(0)
  const refresh = useCallback(() => setGeneration((g) => g + 1), [])

  useEffect(() => {
    if (!id) return
    let alive = true
    setJob(null)
    setEvents([])
    setMissing(false)
    fetch(`/import/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body) => {
        if (!alive) return
        const b = body as { job: ImportJob; options: ImportOptions }
        setJob(b.job)
        setOptions(b.options)
      })
      .catch(() => alive && setMissing(true))

    // The stream replays from the start on every connection; seq keeps it one list.
    const source = new EventSource(`/import/${id}/events`)
    const seen = new Set<number>()
    const onEvent = (raw: MessageEvent) => {
      const event = JSON.parse(raw.data as string) as ImportEvent
      if (seen.has(event.seq)) return
      seen.add(event.seq)
      setEvents((prev) => (prev.some((e) => e.seq === event.seq) ? prev : [...prev, event]))
      if (event.type === 'state') {
        setJob((prev) =>
          prev ? { ...prev, state: event.state, line: event.line, result: event.result, error: event.error } : prev,
        )
        if (SETTLED.has(event.state)) source.close()
      } else if (event.type === 'listen') {
        setJob((prev) => (prev ? { ...prev, listen: event.listen } : prev))
      } else if (event.type === 'calendar') {
        setJob((prev) => (prev ? { ...prev, calendar: event.calendar } : prev))
      } else if (event.type === 'plan') {
        setJob((prev) => (prev ? { ...prev, plan: event.steps } : prev))
      } else if (event.type === 'stage') {
        setJob((prev) => (prev ? { ...prev, stage: event.stage, tick: null } : prev))
      } else if (event.type === 'tick') {
        setJob((prev) => (prev ? { ...prev, tick: event.tick } : prev))
      }
    }
    for (const type of ['listen', 'calendar', 'plan', 'stage', 'tick', 'line', 'text', 'prompt', 'answered', 'state']) {
      source.addEventListener(type, onEvent as EventListener)
    }
    return () => {
      alive = false
      source.close()
    }
  }, [id, generation])

  return { job, options, events, missing, refresh }
}

// -----------------------------------------------------------------------------
// The drop and the picker
// -----------------------------------------------------------------------------

const RECORDING_EXTS = ['.m4a', '.mp3', '.wav', '.aac', '.ogg', '.flac', '.webm', '.mp4', '.caf']
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.heif']
/** The transcriber takes at most this much per request: the read-back's cap, so the sentence below is its sentence. */
const TRANSCRIBE_CAP = 25 * 1024 * 1024
/** The vision model takes 10 MB of base64 per image: this much file. The read-back's cap, and its sentence. */
const IMAGE_CAP = 7.5 * 1024 * 1024

export function acceptsImports(): string {
  return ['.vtt', '.srt', '.txt', ...RECORDING_EXTS, ...IMAGE_EXTS, 'audio/*', 'image/*'].join(',')
}

/** A recording or a screenshot over its cap is refused before its bytes go up, in the read-back's words. */
function refusedBeforeUpload(file: File): string | null {
  const dot = file.name.lastIndexOf('.')
  const ext = dot > 0 ? file.name.slice(dot).toLowerCase() : ''
  const mb = (file.size / 1024 / 1024).toFixed(0)
  const recording = RECORDING_EXTS.includes(ext) || file.type.startsWith('audio/')
  if (recording && file.size > TRANSCRIBE_CAP) {
    return `The recording is ${mb} MB, over the 25 MB limit. Trim it, or record shorter parts.`
  }
  const image = IMAGE_EXTS.includes(ext) || file.type.startsWith('image/')
  if (image && file.size > IMAGE_CAP) {
    return `The screenshot is ${mb} MB, over the 7.5 MB limit. Crop it, or save it as a JPEG.`
  }
  return null
}

/** Drag-and-drop over a whole page: true while files are held over it. The Files pad handles its own drops. */
export function useFileDrop(enabled: boolean, onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')
  const onDragEnter = (event: DragEvent) => {
    if (!enabled || !hasFiles(event)) return
    event.preventDefault()
    depth.current += 1
    setDragging(true)
  }
  const onDragOver = (event: DragEvent) => {
    if (!enabled || !hasFiles(event)) return
    event.preventDefault()
  }
  const onDragLeave = (event: DragEvent) => {
    if (!enabled || !hasFiles(event)) return
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setDragging(false)
  }
  const onDrop = (event: DragEvent) => {
    if (!enabled || !hasFiles(event)) return
    event.preventDefault()
    depth.current = 0
    setDragging(false)
    // A drop on the Files pad is the pad's: it moves the file in on its own.
    if (event.target instanceof Element && event.target.closest('[data-drop-pad]')) return
    const list = event.dataTransfer?.files
    const files: File[] = list ? Array.from(list) : []
    if (files.length > 0) onFiles(files)
  }
  return { dragging: enabled && dragging, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}

export function DropOverlay() {
  return (
    <div className="sky-drop" aria-hidden="true">
      <div className="sky-drop-inner">
        <div className="sky-drop-icon">
          <svg width="46" height="46" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 16V5M12 5L7.5 9.5M12 5l4.5 4.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 15v2.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V15"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div className="sky-drop-title">Drop it on the day</div>
        <div className="sky-drop-sub">
          Sky files it: a transcript (.vtt), a video's transcript (.srt), a voice memo, a notetaker's text (.txt), or a
          screenshot of a conversation. To keep a file with the day as it is, open Files and drop it on the pad.
        </div>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// The confirm: upload, read-back, what and when, Start
// -----------------------------------------------------------------------------

interface Pending {
  key: string
  file: File
  fraction: number
  job: ImportJob | null
  options: ImportOptions | null
  error: string | null
}

/**
 * Files arrive one at a time: each is uploaded, confirmed in the dialog,
 * started (or dropped), then the next comes up.
 */
export function useImportQueue(onStarted: (job: ImportJob) => void) {
  const [queue, setQueue] = useState<File[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [again, setAgain] = useState<ImportJob | null>(null)

  /** Every file dropped on the day is an import; the Files pad keeps files on its own. */
  const take = (files: File[]) => setQueue((q) => [...q, ...files])

  useEffect(() => {
    if (pending || again || queue.length === 0) return
    const [file, ...rest] = queue
    setQueue(rest)
    const key = crypto.randomUUID()
    const refusal = refusedBeforeUpload(file)
    setPending({ key, file, fraction: 0, job: null, options: null, error: refusal })
    if (refusal) return
    const patch = (change: (p: Pending) => Pending) => setPending((p) => (p && p.key === key ? change(p) : p))
    uploadImport(file, (fraction) => patch((p) => ({ ...p, fraction })))
      .then(({ job, options }) => patch((p) => ({ ...p, fraction: 1, job, options })))
      .catch((err: Error) => patch((p) => ({ ...p, error: err.message })))
  }, [queue, pending, again])

  const close = () => {
    setPending(null)
    setAgain(null)
  }

  return {
    take,
    pending,
    again,
    /** Bring a failed import back to the dialog */
    startAgain: (job: ImportJob) => setAgain(job),
    onStarted: (job: ImportJob) => {
      close()
      onStarted(job)
    },
    onDismiss: close,
  }
}

type Fields = {
  kind: ImportKind
  when: string
  category: 'Professional' | 'Personal'
  journalType: string
  /** Start over rather than pick up an earlier run of the file */
  fresh: boolean
}

function Pills<T extends string>({
  label,
  options,
  value,
  onChange,
  inline = true,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
  inline?: boolean
}) {
  const pills = (
    <div className="sky-pills">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="sky-pill"
          data-on={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
  return inline ? (
    <div className="sky-choice-inline">
      <span className="sky-choice-label">{label}</span>
      {pills}
    </div>
  ) : (
    <div className="sky-choice">
      <span className="sky-choice-label">{label}</span>
      {pills}
    </div>
  )
}

/** Under When: where the proposal came from and what wins, or that the person's own wins. */
function whenNote(source: ImportJob['readback']['source'], proposed: boolean, label: string): string {
  switch (source) {
    case 'audio':
      return proposed
        ? `when the memo was recorded · ${label} · a time you say in it wins`
        : 'yours · wins over what the memo says'
    case 'image':
      return proposed
        ? `when the screenshot was taken · ${label} · a time it shows wins`
        : 'yours · wins over what the screenshot shows'
    default:
      return proposed
        ? `from the file's time and length · ${label} · a time it states wins`
        : 'yours · wins over what the transcript states'
  }
}

/** `2026-09-01 09:31` reads as `Today 9:31` on today, else the date and time. */
function whenLabel(when: string, todayYmd: string | null): string {
  const [ymd, hhmm] = when.split(' ')
  const time = (hhmm ?? '').replace(/^0/, '')
  if (ymd === todayYmd) return `Today ${time}`
  return `${ymd} ${time}`
}

function nextLine(kind: ImportKind, source: ImportJob['readback']['source'], journalType: string): string {
  if (source === 'image') {
    return 'Sky reads the conversation off the screenshot, checks what it read with you, and files it as a message under the day.'
  }
  const heard =
    source === 'audio'
      ? 'Sky transcribes it, checks unsure names with you'
      : 'Sky cleans the transcript, checks unsure names with you'
  switch (kind) {
    case 'meeting':
      return `${heard}, writes the meeting up, and files it under the day with its action items.`
    case 'journal':
      return `${heard}, and files it as a ${journalType} journal under the day.`
    case 'note':
      return `${heard}, and files it as a note under the day, transcript and all.`
    case 'message':
      return `${heard}, and files it as a message under the day.`
    case 'event':
      return `${heard}, and files it as an event under the day.`
    case 'video':
      return `${heard}, writes the video up, and files it under the day with the transcript.`
  }
}

function ConfirmBody({
  pending,
  job,
  options,
  todayYmd,
  onStart,
  onCancel,
  phone,
}: {
  pending: Pending | null
  job: ImportJob | null
  options: ImportOptions | null
  todayYmd: string | null
  onStart: (fields: Fields) => void
  onCancel: () => void
  phone: boolean
}) {
  const feed = useImportFeed(job?.id ?? null)
  const live = feed.job ?? job
  const kinds = live?.readback.kinds ?? []
  const [touched, setTouched] = useState(false)
  const [fields, setFields] = useState<Fields>({
    kind: kinds[0] ?? 'meeting',
    when: live?.suggestedWhen ?? '',
    category: 'Professional',
    journalType: options?.journalTypes[0] ?? 'Reflection',
    fresh: false,
  })
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The read-back lands once the upload finishes; sky's guess a little later. Neither overrides a hand.
  useEffect(() => {
    if (!live) return
    setFields((f) => ({
      ...f,
      when: f.when || live.suggestedWhen,
      kind: touched
        ? f.kind
        : (live.listen?.kind ?? (live.readback.kinds.includes(f.kind) ? f.kind : (live.readback.kinds[0] ?? f.kind))),
    }))
  }, [live, touched])

  const uploading = pending && !pending.job && !pending.error
  const refusal = live?.readback.refusal ?? pending?.error ?? null
  const source = live?.readback.source ?? 'audio'
  const sourceWord =
    source === 'audio'
      ? 'a voice memo'
      : source === 'text'
        ? 'a text file'
        : source === 'image'
          ? 'a screenshot'
          : 'a transcript'
  // The title says what this makes — "New meeting from a transcript" — and follows the choice below.
  const title = refusal
    ? 'Sky cannot take this file'
    : uploading
      ? 'New from a file'
      : `New ${KIND_LABEL[fields.kind].toLowerCase()} from ${sourceWord}`

  const start = async () => {
    if (!live || starting) return
    setStarting(true)
    setError(null)
    try {
      await post(`/import/${live.id}/start`, {
        kind: fields.kind,
        when: fields.when.trim(),
        category: fields.category,
        journalType: fields.kind === 'journal' ? fields.journalType : undefined,
        fresh: fields.fresh,
      })
      onStart(fields)
    } catch (err) {
      setError((err as Error).message)
      setStarting(false)
    }
  }

  const fileName = live?.file.name ?? pending?.file.name ?? ''
  const size = live?.file.size ?? pending?.file.size ?? 0
  const calendar = live?.calendar

  return (
    <div className={`sky-confirm${phone ? ' sky-sheet' : ''}`}>
      {phone && <div className="sky-sheet-handle" />}
      <div className="sky-confirm-title">{title}</div>
      <div className="sky-confirm-file">
        {fileName} · {sizeLabel(size)}
      </div>
      {uploading && <div className="sky-confirm-read">Uploading · {Math.round((pending?.fraction ?? 0) * 100)}%</div>}
      {refusal && <div className="sky-confirm-read">{refusal}</div>}
      {live && !refusal && (
        <>
          <div className="sky-confirm-read">{live.readback.summary}</div>
          {live.readback.detail && <div className="sky-lead">{live.readback.detail}</div>}
          {source === 'audio' && !live.listen && (
            <div className="sky-confirm-guess">Listening to the first minute…</div>
          )}
          {live.listen && (
            <>
              <div className="sky-confirm-opening">Starts: “{live.listen.opening}”</div>
              <div className="sky-confirm-guess">{live.listen.guess}</div>
            </>
          )}
          <Pills
            label={kinds.length > 1 ? 'What is it?' : 'This becomes'}
            inline={false}
            options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
            value={fields.kind}
            onChange={(kind) => {
              setTouched(true)
              setFields((f) => ({ ...f, kind }))
            }}
          />
          <div className="sky-choice-inline">
            <span className="sky-choice-label">When</span>
            <input
              className="sky-when-input"
              value={fields.when}
              aria-label="When"
              onChange={(e) => setFields((f) => ({ ...f, when: e.target.value }))}
            />
            <span className="sky-when-note">
              {whenNote(source, fields.when === live.suggestedWhen, whenLabel(live.suggestedWhen, todayYmd))}
            </span>
          </div>
          {calendar && (
            <div className="sky-when-cal">
              {calendar.relation === 'matches' ? 'Matches' : 'Just after'} “{calendar.title}” on your calendar
              {calendar.relation === 'just-after'
                ? `, ${calendar.start.replace(/^0/, '')}${calendar.end ? ` – ${calendar.end.replace(/^0/, '')}` : ''}`
                : ''}
              {calendar.who.length > 0 ? ` · ${calendar.who.join(', ')}` : ''}
            </div>
          )}
          {fields.kind === 'journal' ? (
            <Pills
              label="Type"
              options={(options?.journalTypes ?? []).map((t) => ({ value: t, label: t }))}
              value={fields.journalType}
              onChange={(journalType) => setFields((f) => ({ ...f, journalType }))}
            />
          ) : (
            <Pills
              label="Category"
              options={[
                { value: 'Professional', label: 'Professional' },
                { value: 'Personal', label: 'Personal' },
              ]}
              value={fields.category}
              onChange={(category) => setFields((f) => ({ ...f, category }))}
            />
          )}
          <div className="sky-confirm-next">{nextLine(fields.kind, source, fields.journalType)}</div>
          {live.resume && (
            <div className="sky-confirm-resume">
              {fields.fresh
                ? `Starts over. The run from ${whenLabel(live.resume.started, todayYmd)} is forgotten.`
                : `Picks up where the run from ${whenLabel(live.resume.started, todayYmd)} stopped, at ${live.resume.step}.`}{' '}
              <button
                type="button"
                className="sky-confirm-link"
                onClick={() => setFields((f) => ({ ...f, fresh: !f.fresh }))}
              >
                {fields.fresh ? 'Pick up instead' : 'Start over'}
              </button>
            </div>
          )}
        </>
      )}
      {error && <div className="sky-confirm-read">{error}</div>}
      <div className="sky-confirm-actions">
        <Button onClick={onCancel}>{refusal ? 'Remove' : 'Cancel'}</Button>
        {!refusal && (
          <Button variant="light" color="blue" onClick={() => void start()} disabled={!live || starting}>
            {starting ? 'Starting…' : 'Start'}
          </Button>
        )}
      </div>
    </div>
  )
}

/** The confirm as a dialog on a desk and a sheet from the bottom on a phone. */
export function ImportDialog({
  pending,
  again,
  todayYmd,
  onStarted,
  onDismiss,
}: {
  pending: Pending | null
  again: ImportJob | null
  todayYmd: string | null
  onStarted: (job: ImportJob) => void
  onDismiss: () => void
}) {
  const phone = useMediaQuery('(max-width: 900px)') ?? false
  const job = again ?? pending?.job ?? null
  const options = pending?.options ?? null
  const [againOptions, setAgainOptions] = useState<ImportOptions | null>(null)
  useEffect(() => {
    if (!again) return
    fetch(`/import/${again.id}`)
      .then((r) => r.json())
      .then((b) => setAgainOptions((b as { options: ImportOptions }).options))
      .catch(() => {})
  }, [again])
  const opened = pending !== null || again !== null

  const cancel = () => {
    // A file that never started, or was refused, leaves with the dialog.
    if (job && (job.state === 'new' || job.readback.refusal)) void post(`/import/${job.id}/remove`, {}).catch(() => {})
    onDismiss()
  }
  const started = () => {
    if (job) onStarted(job)
  }
  // Keyed by the file: the next one up starts with its own fields.
  const body = (
    <Fragment key={pending?.key ?? again?.id ?? 'none'}>
      <ConfirmBody
        pending={pending}
        job={job}
        options={options ?? againOptions}
        todayYmd={todayYmd}
        onStart={started}
        onCancel={cancel}
        phone={phone}
      />
    </Fragment>
  )

  if (phone) {
    return (
      <Drawer
        opened={opened}
        onClose={cancel}
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
    <Modal opened={opened} onClose={cancel} centered size={560} withCloseButton={false} padding={28} radius="xl">
      {body}
    </Modal>
  )
}

// -----------------------------------------------------------------------------
// The rows
// -----------------------------------------------------------------------------

export type RowTone = 'quiet' | 'live' | 'need' | 'done' | 'failed'

export function importTone(job: ImportJob): RowTone {
  switch (job.state) {
    case 'running':
      return 'live'
    case 'needs-you':
      return 'need'
    case 'done':
      return 'done'
    case 'failed':
      return 'failed'
    default:
      return 'quiet'
  }
}

/** What the sidebar says beside an import. */
export function importStateWord(job: ImportJob): string {
  switch (job.state) {
    case 'running':
      return job.stage ? job.stage.label.toLowerCase() : 'working'
    case 'needs-you':
      return 'needs you'
    case 'done':
      return 'done'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    default:
      return ''
  }
}

export function ImportRow({ job, onOpen }: { job: ImportJob; onOpen: (id: string) => void }) {
  const tone = importTone(job)
  const line = job.state === 'needs-you' ? job.line : job.state === 'running' ? job.line : job.line
  return (
    <div className="sky-run">
      <span className="sky-run-dot">
        <span className="sky-dot" data-tone={tone} />
      </span>
      <span className="sky-run-txt">
        {job.title}
        {line && (
          <span className="sky-run-line" data-tone={tone === 'need' || tone === 'failed' ? tone : undefined}>
            {line}
          </span>
        )}
      </span>
      <span className="sky-run-at">{job.when}</span>
      {job.state === 'needs-you' ? (
        <Button variant="light" color="blue" onClick={() => onOpen(job.id)}>
          Review
        </Button>
      ) : (
        <Button onClick={() => onOpen(job.id)}>Open</Button>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// The import's own page
// -----------------------------------------------------------------------------

interface Derived {
  plan: PlanStep[] | null
  /** The step running now, as last reported */
  stage: Stage | null
  tick: Tick | null
  /** Streamed text, by the step it streamed under */
  text: Record<string, string>
  lines: string[]
  pending: PromptOnWire | null
  /** The last "Extracted Metadata" box the write-up printed */
  fields: { key: string; value: string }[]
  /** The action items as they were placed, once the question is answered */
  placed: { prompt: Extract<PromptOnWire, { kind: 'place' }>; answer: PlaceAnswer } | null
}

function derive(events: ImportEvent[]): Derived {
  let plan: PlanStep[] | null = null
  let stage: Stage | null = null
  let tick: Tick | null = null
  const text: Record<string, string> = {}
  const lines: string[] = []
  const answered = new Set<string>()
  let pending: PromptOnWire | null = null
  let box: string[] | null = null
  let fields: Derived['fields'] = []
  let placed: Derived['placed'] = null
  for (const event of events) {
    if (event.type === 'plan') {
      plan ??= event.steps
    } else if (event.type === 'stage') {
      stage = event.stage
      tick = null
    } else if (event.type === 'tick') {
      tick = event.tick
    } else if (event.type === 'text') {
      const under = stage?.id ?? 'root'
      text[under] = (text[under] ?? '') + event.text
    } else if (event.type === 'line') {
      lines.push(event.text)
      const flat = event.text.trim()
      // The box a door prints before its check: "─── Extracted Metadata ───", "─── Extracted ───"
      if (/^─+ Extracted\b.*─+$/.test(flat)) box = []
      else if (box && /^─+$/.test(flat)) {
        fields = box
          .map((l) => l.match(/^([A-Za-z ]+):\s*(.*)$/))
          .filter((m): m is RegExpMatchArray => m !== null)
          .map((m) => ({ key: m[1].trim().toLowerCase(), value: m[2].trim() }))
        box = null
      } else if (box) box.push(flat)
    } else if (event.type === 'prompt') {
      pending = event.prompt
    } else if (event.type === 'answered') {
      answered.add(event.id)
      if (pending?.id === event.id) {
        if (pending.kind === 'place' && Array.isArray(event.answer)) {
          placed = { prompt: pending, answer: event.answer as PlaceAnswer }
        }
        pending = null
      }
    }
  }
  if (pending && answered.has(pending.id)) pending = null
  return { plan, stage, tick, text, lines, pending, fields, placed }
}

type StepState = 'done' | 'live' | 'need' | 'next'

/**
 * The ladder: Received, then the command's own plan. The step being
 * reported is live, or amber when a question is waiting; the ones before
 * it are done. A step the plan never named joins at its place in time.
 */
function ladder(job: ImportJob, d: Derived): { label: string; state: StepState }[] {
  const plan = d.plan ?? job.plan ?? []
  const current = d.stage ?? job.stage
  const settledDone = job.state === 'done'
  const steps: { id: string; label: string }[] = [...plan]
  if (current && !steps.some((s) => s.id === current.id)) steps.push({ id: current.id, label: current.label })
  const at = current ? steps.findIndex((s) => s.id === current.id) : -1
  const detail = current?.detail ? ` · ${current.detail}` : ''
  return [
    { label: 'Received', state: 'done' as StepState },
    ...steps.map((s, i) => {
      if (settledDone || i < at) return { label: s.label, state: 'done' as StepState }
      if (i === at) return { label: `${s.label}${detail}`, state: (d.pending ? 'need' : 'live') as StepState }
      return { label: s.label, state: 'next' as StepState }
    }),
  ]
}

function Ladder({ steps }: { steps: { label: string; state: StepState }[] }) {
  return (
    <div className="sky-ladder">
      {steps.map((s) => (
        <span key={s.label} className="sky-step" data-state={s.state}>
          <span
            className="sky-dot"
            data-tone={s.state === 'done' ? 'done' : s.state === 'live' ? 'live' : s.state === 'need' ? 'need' : 'next'}
          />
          {s.label}
        </span>
      ))}
    </div>
  )
}

function Block({ head, mini, children }: { head: string; mini?: ReactNode; children: ReactNode }) {
  return (
    <div className="sky-block">
      <div className="sky-block-head sky-bhead">
        {head}
        <span className="sky-spacer" />
        {mini && <span className="sky-count">{mini}</span>}
      </div>
      <div className="sky-block-pad">{children}</div>
    </div>
  )
}

/** Seconds since something last happened, ticking. */
function useElapsed(since: number | null): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return since ? Math.max(0, Math.floor((now - since) / 1000)) : 0
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function LiveBlock({ job, d, startedAt }: { job: ImportJob; d: Derived; startedAt: number | null }) {
  const elapsed = useElapsed(startedAt)
  const stage = d.stage ?? job.stage
  const tick = d.tick ?? job.tick
  const head = stage ? `${stage.label}${stage.detail ? ` · ${stage.detail}` : ''}` : 'Working'
  const streamed = stage ? d.text[stage.id] : undefined
  const length = job.readback.durationMinutes ? ` · ${Math.round(job.readback.durationMinutes)} min of audio` : ''
  const count = tick
    ? ` · ${tick.done}${tick.total !== null ? ` of ${tick.total}` : ''}${tick.unit ? ` ${tick.unit}` : ''}`
    : ''
  const [showLog, setShowLog] = useState(false)
  return (
    <>
      <Block head={head} mini={`${clock(elapsed)} elapsed${stage?.id === 'transcribe' ? length : ''}${count}`}>
        {streamed ? (
          <div className="sky-live">
            {streamed}
            <span className="sky-caret" />
          </div>
        ) : (
          <div className="sky-lead">{job.line ?? 'Starting…'}</div>
        )}
        {d.lines.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <button type="button" className="sky-showlink" onClick={() => setShowLog((v) => !v)}>
              {showLog ? 'Hide the log' : 'Show the log'}
            </button>
            {showLog && (
              <div className="sky-log" style={{ marginTop: 8 }}>
                {d.lines.join('\n')}
              </div>
            )}
          </div>
        )}
      </Block>
      <div className="sky-dim">
        Leave the page if you like — this keeps running. Sky asks when it isn't sure of something.
      </div>
    </>
  )
}

// --- the questions ----------------------------------------------------------

function markProblem(context: string, problem: string): ReactNode {
  const at = problem ? context.indexOf(problem) : -1
  if (at < 0) return context
  return (
    <>
      {context.slice(0, at)}
      <mark>{problem}</mark>
      {context.slice(at + problem.length)}
    </>
  )
}

function ReviewForm({
  prompt,
  onAnswer,
}: {
  prompt: Extract<PromptOnWire, { kind: 'form' }>
  onAnswer: (answer: unknown) => void
}) {
  const items = prompt.prompt.items
  const initial = useMemo(() => {
    const out: Record<string, FormAnswer> = {}
    for (const item of items)
      out[item.id] = item.suggestion ? { action: 'accept', value: item.suggestion } : { action: 'skip' }
    return out
  }, [items])
  const [answers, setAnswers] = useState<Record<string, FormAnswer>>(initial)
  const [custom, setCustom] = useState<Record<string, string>>({})
  const applied = (Object.values(answers) as FormAnswer[]).filter((a) => a.action !== 'skip').length
  const choose = (id: string, answer: FormAnswer) => setAnswers((a) => ({ ...a, [id]: answer }))
  const submit = () => {
    const out: Record<string, FormAnswer> = {}
    for (const item of items) {
      const a = answers[item.id]
      out[item.id] =
        a.action === 'custom'
          ? custom[item.id]?.trim()
            ? { action: 'custom', value: custom[item.id].trim() }
            : { action: 'skip' }
          : a
    }
    onAnswer(out)
  }
  return (
    <Block
      head={
        prompt.prompt.title === 'Interactive Review'
          ? `Check ${items.length} name${items.length === 1 ? '' : 's'} and terms`
          : prompt.prompt.title
      }
      mini="your answers are remembered"
    >
      <div className="sky-lead" style={{ marginBottom: 4 }}>
        Sky wasn't sure about these. Each one comes with the sentences around it. Pick the right one — next time it
        won't ask.
      </div>
      {items.map((item) => {
        const a = answers[item.id]
        const options = [item.suggestion, ...item.alternatives].filter(
          (v, i, all): v is string => Boolean(v) && all.indexOf(v) === i,
        )
        return (
          <div key={item.id} className="sky-issue">
            <div className="sky-issue-kind">
              {item.label} · heard{' '}
              {item.occurrences === 1 ? 'once' : item.occurrences === 2 ? 'twice' : `${item.occurrences} times`}
            </div>
            <div className="sky-issue-ctxs">
              {(item.contexts.length > 0 ? item.contexts : [item.problem]).map((c, i) => (
                <div key={i} className="sky-issue-ctx">
                  “{markProblem(c, item.problem)}”
                </div>
              ))}
            </div>
            <div className="sky-pills">
              {options.map((o) => (
                <button
                  key={o}
                  type="button"
                  className="sky-pill"
                  data-on={a.action === 'accept' && a.value === o}
                  onClick={() => choose(item.id, { action: 'accept', value: o })}
                >
                  {o}
                </button>
              ))}
              <button
                type="button"
                className="sky-pill"
                data-on={a.action === 'custom'}
                onClick={() => choose(item.id, { action: 'custom', value: custom[item.id] ?? '' })}
              >
                Type it…
              </button>
              {a.action === 'custom' && (
                <input
                  className="sky-issue-custom"
                  autoFocus
                  placeholder={item.suggestion ?? item.problem}
                  value={custom[item.id] ?? ''}
                  onChange={(e) => setCustom((c) => ({ ...c, [item.id]: e.target.value }))}
                />
              )}
              <button
                type="button"
                className="sky-pill"
                data-on={a.action === 'skip'}
                onClick={() => choose(item.id, { action: 'skip' })}
              >
                Leave as heard
              </button>
            </div>
          </div>
        )
      })}
      <div className="sky-form-foot">
        <Button variant="light" color="blue" onClick={submit}>
          Apply {applied}
        </Button>
        <Button onClick={() => onAnswer(Object.fromEntries(items.map((i) => [i.id, { action: 'skip' }])))}>
          Leave all as heard
        </Button>
        <span className="sky-dim">Skipped ones stay as heard.</span>
      </div>
    </Block>
  )
}

/** The write-up as a document once it has finished streaming; the raw text while it streams. */
function Markdown({ raw }: { raw: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => {
    try {
      return renderStatic(raw)
    } catch {
      return null
    }
  }, [raw])
  useLayoutEffect(() => {
    if (ref.current && html !== null) ref.current.innerHTML = html
  }, [html])
  if (html === null) return <div className="sky-live">{raw}</div>
  return <div className="sky-doc-body" ref={ref} />
}

function Fields({ fields }: { fields: Derived['fields'] }) {
  if (fields.length === 0) return null
  return (
    <div className="sky-fields">
      {fields.map((f) => (
        <div key={f.key} className="sky-field">
          <span className="sky-field-key">{f.key}</span>
          <span>{f.value}</span>
        </div>
      ))}
    </div>
  )
}

function CorrectionsExchange({
  prompt,
  d,
  job,
  history,
  onAnswer,
}: {
  prompt: Extract<PromptOnWire, { kind: 'text' }>
  d: Derived
  job: ImportJob
  history: { question: string; answer: string }[]
  onAnswer: (answer: string) => void
}) {
  const [value, setValue] = useState('')
  // What the door streamed under the step it is checking: the write-up, or the conversation read off a screenshot.
  const writeup = d.text[(d.stage ?? job.stage)?.id ?? 'writeup'] ?? d.text['writeup']
  const conversation = job.readback.source === 'image'
  const send = (text: string) => onAnswer(text)
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send(value.trim())
    }
  }
  return (
    <>
      <Block head={conversation ? 'Check the conversation' : 'Check the write-up'} mini="what sky read out of it">
        <div className="sky-lead" style={{ marginBottom: 8 }}>
          Read it over. Then say what's wrong, in your own words or by field.
        </div>
        <Fields fields={d.fields} />
        {writeup && (
          <div style={{ marginTop: 18 }}>
            <Markdown raw={writeup} />
          </div>
        )}
      </Block>
      <div className="sky-exchange">
        {history.map((h, i) => (
          <Fragment key={i}>
            <div>
              <div className="sky-say-who">sky</div>
              <div className="sky-say">{h.question}</div>
            </div>
            <div className="sky-say-user">{h.answer || 'Looks right'}</div>
          </Fragment>
        ))}
        <div>
          <div className="sky-say-who">sky</div>
          <div className="sky-say">{prompt.prompt.message.replace(/\s*\(.*\)\s*$/, '')}</div>
          {prompt.prompt.hint && prompt.prompt.hint.length > 0 && (
            <div className="sky-say-ex">{prompt.prompt.hint.join(' · ')}</div>
          )}
        </div>
        <div className="sky-exchange-input">
          <div className="sky-input">
            <textarea
              className="sky-input-field"
              style={{
                width: '100%',
                background: 'transparent',
                border: 0,
                outline: 0,
                font: 'inherit',
                color: 'inherit',
                resize: 'none',
              }}
              rows={1}
              placeholder={prompt.prompt.placeholder ?? 'What to change…'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKeyDown}
              autoFocus
            />
          </div>
          <Button variant="light" color="blue" onClick={() => send(value.trim())}>
            {value.trim() ? 'Apply' : 'Looks right'}
          </Button>
        </div>
      </div>
    </>
  )
}

function ActionItems({
  prompt,
  onAnswer,
}: {
  prompt: Extract<PromptOnWire, { kind: 'multiselect' }>
  onAnswer: (answer: string[]) => void
}) {
  const options = prompt.prompt.options
  const [picked, setPicked] = useState<Set<string>>(() => new Set(prompt.prompt.initial ?? []))
  const toggle = (value: string) =>
    setPicked((p) => {
      const next = new Set(p)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  return (
    <Block head="Action items" mini={`${options.length} from the summary`}>
      <div className="sky-lead" style={{ marginBottom: 6 }}>
        {prompt.prompt.message.replace(/\s*\(.*\)\s*$/, '')}
      </div>
      {options.map((o) => {
        const on = picked.has(o.value)
        const [mine, dest] =
          (o.hint ?? '').split(' · ').length > 1 ? [true, (o.hint ?? '').split(' · ')[1]] : [false, o.hint ?? '']
        return (
          <div key={o.value} className="sky-action">
            <button
              type="button"
              className="sky-check"
              aria-label={on ? 'Accepted' : 'Accept'}
              onClick={() => toggle(o.value)}
            >
              <span className="sky-check-box" data-on={on}>
                {on && (
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path
                      d="M2.5 7.5L5.5 10.5L11.5 3.5"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
            </button>
            <span style={{ flex: 1, minWidth: 0 }}>{o.label}</span>
            {mine && <span className="sky-action-me">me</span>}
            {dest && <span className="sky-action-dest">{dest}</span>}
          </div>
        )
      })}
      <div className="sky-form-foot">
        <Button variant="light" color="blue" onClick={() => onAnswer([...picked])}>
          Accept {picked.size}
        </Button>
        <Button onClick={() => onAnswer([])}>None</Button>
      </div>
    </Block>
  )
}

// --- action items: accept and place ------------------------------------------------

const Tick = (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path
      d="M2.5 7.5L5.5 10.5L11.5 3.5"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

function sameWhen(a: PlaceWhen, b: PlaceWhen): boolean {
  return a.date === b.date && a.time === b.time
}

/**
 * Every action item the summary found, the person's own ticked, each with a
 * chip saying when it happens. The chip in the lead sentence moves every
 * row that has not been set on its own; a row's own chip sets just that row.
 * A date or time the words named arrives set (it wins over the default).
 */
function PlaceItems({
  prompt,
  onAnswer,
}: {
  prompt: Extract<PromptOnWire, { kind: 'place' }>
  onAnswer: (answer: PlaceAnswer) => void
}) {
  const p = prompt.prompt
  const [picked, setPicked] = useState<Set<string>>(() => new Set(p.initial))
  const [fallback, setFallback] = useState<PlaceWhen>(p.fallback)
  const [chosen, setChosen] = useState<Map<string, PlaceWhen>>(() => {
    const set = new Map<string, PlaceWhen>()
    for (const item of p.items) if (!sameWhen(item.when, p.fallback)) set.set(item.value, item.when)
    return set
  })
  const whenOf = (item: PlaceItem) => chosen.get(item.value) ?? fallback
  const toggle = (value: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  const choose = (value: string, when: PlaceWhen) => setChosen((prev) => new Map(prev).set(value, when))

  const ticked = p.items.filter((item) => picked.has(item.value))
  const tally = new Map<string, { label: string; count: number }>()
  for (const item of ticked) {
    const when = whenOf(item)
    const key = when.date ?? '~'
    const label = when.date === null ? 'Next' : dayLabel(when.date, p.today)
    tally.set(key, { label, count: (tally.get(key)?.count ?? 0) + 1 })
  }
  const tallied = [...tally.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, t]) => t)
  const shared = { today: p.today, createdThrough: p.createdThrough, waiting: p.waiting }

  return (
    <Block head="Action items" mini={`${p.items.length} from the summary`}>
      <div
        className="sky-lead"
        style={{ marginBottom: 6, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 8px' }}
      >
        <span>Tick what you'll own. Ticked items go to</span>
        <WhenChip when={fallback} lead onChange={setFallback} {...shared} />
        <span>unless a row says otherwise.</span>
      </div>
      {p.items.map((item) => {
        const on = picked.has(item.value)
        return (
          <div key={item.value} className="sky-action sky-action-place">
            <button
              type="button"
              className="sky-check"
              aria-label={on ? 'Accepted' : 'Accept'}
              onClick={() => toggle(item.value)}
            >
              <span className="sky-check-box" data-on={on}>
                {on && Tick}
              </span>
            </button>
            <span className="sky-action-text" style={{ color: on ? undefined : 'var(--sky-text-2)' }}>
              {item.label}
            </span>
            {item.mine && <span className="sky-action-me">me</span>}
            <WhenChip
              when={whenOf(item)}
              quiet={!chosen.has(item.value)}
              off={!on}
              itemText={item.label}
              onChange={(when) => choose(item.value, when)}
              {...shared}
            />
          </div>
        )
      })}
      <div className="sky-form-foot">
        <Button
          variant="light"
          color="blue"
          onClick={() => onAnswer(ticked.map((item) => ({ value: item.value, when: whenOf(item) })))}
        >
          Accept {ticked.length}
        </Button>
        <Button onClick={() => onAnswer([])}>None</Button>
        {tallied.length > 0 && (
          <span className="sky-dim">{tallied.map((t) => `${t.label} ${t.count}`).join(' · ')}</span>
        )}
      </div>
    </Block>
  )
}

/** The chip that says when an item happens; a menu under it on a desk, a sheet on a phone. */
function WhenChip({
  when,
  today,
  createdThrough,
  waiting,
  quiet = false,
  off = false,
  lead = false,
  itemText,
  onChange,
}: {
  when: PlaceWhen
  today: string
  createdThrough: string | null
  waiting: number
  quiet?: boolean
  off?: boolean
  lead?: boolean
  itemText?: string
  onChange: (when: PlaceWhen) => void
}) {
  const [open, setOpen] = useState(false)
  const phone = useMediaQuery('(max-width: 900px)') ?? false
  const day = when.date === null ? 'Next' : dayLabel(when.date, today)
  const button = (
    <button
      type="button"
      className={`sky-place-chip${lead ? ' sky-place-chip-lead' : ''}`}
      data-quiet={quiet || undefined}
      data-off={off || undefined}
      data-open={open || undefined}
      aria-label={`When: ${placeLabel(when, today)}`}
      onClick={() => setOpen((o) => !o)}
    >
      {day}
      {when.time && <span className="sky-place-chip-sub">· {when.time}</span>}
      <svg className="sky-place-chip-chev" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path
          d="M3 4.5L6 7.5L9 4.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
  const menu = (
    <WhenMenu
      when={when}
      today={today}
      createdThrough={createdThrough}
      waiting={waiting}
      onChange={onChange}
      onDone={() => setOpen(false)}
    />
  )
  if (phone) {
    return (
      <>
        {button}
        <Drawer
          opened={open}
          onClose={() => setOpen(false)}
          position="bottom"
          size="auto"
          withCloseButton={false}
          padding={12}
          radius="lg"
          styles={{
            inner: { alignItems: 'flex-end' },
            content: { height: 'auto', flex: '0 0 auto', maxHeight: '92dvh' },
          }}
        >
          <div className="sky-sheet">
            <div className="sky-sheet-handle" />
            {itemText && <div className="sky-sheet-for">{itemText}</div>}
            {menu}
          </div>
        </Drawer>
      </>
    )
  }
  return (
    <Popover
      opened={open}
      onChange={setOpen}
      position="bottom-end"
      offset={6}
      withinPortal
      shadow="none"
      styles={{
        dropdown: {
          padding: 0,
          border: '1px solid var(--sky-border-soft)',
          borderRadius: 11,
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.12)',
          background: 'var(--sky-card)',
        },
      }}
    >
      <Popover.Target>{button}</Popover.Target>
      <Popover.Dropdown>{menu}</Popover.Dropdown>
    </Popover>
  )
}

const MenuTick = (
  <svg className="sky-place-menu-tick" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * Today, Tomorrow, the rest of this week by name, another day, a time, and
 * Next. Picking a day keeps the time the item had; a time makes the day a
 * Commitment; Next drops both.
 */
function WhenMenu({
  when,
  today,
  createdThrough,
  waiting,
  onChange,
  onDone,
}: {
  when: PlaceWhen
  today: string
  createdThrough: string | null
  waiting: number
  onChange: (when: PlaceWhen) => void
  onDone: () => void
}) {
  const tomorrow = new PlainDate(today).addDays(1).ymd
  const named = new Set([today, tomorrow, ...restOfWeek(today)])
  const [otherDay, setOtherDay] = useState(when.date !== null && !named.has(when.date))
  const [atTime, setAtTime] = useState(when.time !== null)
  const [timeText, setTimeText] = useState(when.time ?? '')
  const days = [
    { date: today, label: 'Today', sub: shortDate(today) },
    { date: tomorrow, label: 'Tomorrow', sub: shortDate(tomorrow) },
    ...restOfWeek(today).map((date) => ({ date, label: weekdayName(date), sub: shortDate(date).slice(4) })),
  ]
  const pickDay = (date: string) => {
    onChange({ date, time: when.time })
    onDone()
  }
  const commitTime = () => {
    const time = normalizeClock(timeText)
    if (time && when.date !== null) onChange({ date: when.date, time })
    else setTimeText(when.time ?? '')
  }
  const beyond = when.date !== null && (createdThrough === null || when.date > createdThrough)

  return (
    <div className="sky-place-menu">
      {days.map((d) => (
        <button
          key={d.date}
          type="button"
          className="sky-place-menu-row"
          data-on={when.date === d.date}
          onClick={() => pickDay(d.date)}
        >
          {d.label}
          {when.date === d.date && MenuTick}
          <span className="sky-place-menu-sub">{d.sub}</span>
        </button>
      ))}
      {otherDay ? (
        <div className="sky-place-menu-field">
          <span>On</span>
          <input
            type="date"
            className="sky-when-input"
            min={today}
            value={when.date ?? ''}
            onChange={(e) => e.target.value && onChange({ date: e.target.value, time: when.time })}
          />
          {beyond && (
            <span className="sky-place-menu-hint">Its week isn't created yet. It lands on the day when it is.</span>
          )}
        </div>
      ) : (
        <button type="button" className="sky-place-menu-row" onClick={() => setOtherDay(true)}>
          Another day…
        </button>
      )}
      {when.date !== null &&
        (atTime ? (
          <div className="sky-place-menu-field">
            <span>At</span>
            <input
              className="sky-when-input"
              placeholder="9:30"
              value={timeText}
              autoFocus={when.time === null}
              onChange={(e) => setTimeText(e.target.value)}
              onBlur={commitTime}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commitTime()
                  onDone()
                }
              }}
            />
            <button
              type="button"
              className="sky-place-menu-clear"
              onClick={() => {
                onChange({ date: when.date, time: null })
                setTimeText('')
                setAtTime(false)
              }}
            >
              clear
            </button>
            <span className="sky-place-menu-hint">
              A time makes it a Commitment on that day. Without one it's a Todo.
            </span>
          </div>
        ) : (
          <button type="button" className="sky-place-menu-row" onClick={() => setAtTime(true)}>
            At a time…<span className="sky-place-menu-sub">makes it a Commitment</span>
          </button>
        ))}
      <div className="sky-place-menu-sep" />
      <button
        type="button"
        className="sky-place-menu-row"
        data-on={when.date === null}
        data-dim
        onClick={() => {
          onChange({ date: null, time: null })
          onDone()
        }}
      >
        Next
        {when.date === null && MenuTick}
        <span className="sky-place-menu-sub">the list · {waiting} waiting</span>
      </button>
    </div>
  )
}

/** Where the accepted items went, grouped by day, with the failures the ledger reported. */
function Placed({ placed, lines }: { placed: NonNullable<Derived['placed']>; lines: string[] }) {
  const p = placed.prompt.prompt
  const items = new Map(p.items.map((item) => [item.value, item]))
  const failed = new Map<string, string>()
  for (const line of lines) {
    const m = line.trim().match(/^✗ (.+?) — (.+)$/)
    if (m) failed.set(m[1], m[2])
  }
  interface Group {
    key: string
    when: PlaceWhen
    rows: { text: string; time: string | null; problem: string | null }[]
  }
  const groups = new Map<string, Group>()
  for (const a of placed.answer) {
    const item = items.get(a.value)
    if (!item) continue
    const key = a.when.date ?? 'next'
    const group = groups.get(key) ?? { key, when: { date: a.when.date, time: null }, rows: [] }
    group.rows.push({ text: item.label, time: a.when.time, problem: failed.get(item.label) ?? null })
    groups.set(key, group)
  }
  const ordered = [...groups.values()].sort((a, b) => (a.when.date ?? '9').localeCompare(b.when.date ?? '9'))
  const nextCount = groups.get('next')?.rows.length ?? 0
  const declined = p.items.length - placed.answer.length

  const describe = (g: Group): { label: string; sub: string; href: string; open: string } => {
    if (g.when.date === null) {
      return {
        label: 'Next',
        sub: `the list · now ${p.waiting + nextCount} waiting`,
        href: fileHref('time/next-professional.md'),
        open: 'Open the list',
      }
    }
    const where = placeWhere({ date: g.when.date, time: g.rows[0]?.time ?? null }, p.createdThrough)
    if (where === 'schedule') {
      return {
        label: dayLabel(g.when.date, p.today),
        sub: "its week isn't created yet · lands on the day when it is",
        href: fileHref('time/schedule-professional.md'),
        open: 'See the schedule',
      }
    }
    const lists = new Set(g.rows.map((r) => (r.time ? 'Commitments' : 'Todos')))
    const which = lists.size === 2 ? 'Todos and Commitments' : [...lists][0]
    const label = dayLabel(g.when.date, p.today)
    return {
      label,
      // "Today · Wed 11 Mar · Todos"; a named day already says its date
      sub: label === 'Today' || label === 'Tomorrow' ? `${shortDate(g.when.date)} · ${which}` : which,
      href: g.when.date === p.today ? '/' : `/${g.when.date}`,
      open: g.when.date === p.today ? 'Open the day' : `Open ${weekdayName(g.when.date)}`,
    }
  }

  return (
    <Block head="Action items" mini={`${placed.answer.length} placed · ${declined} stay in the write-up`}>
      <div className="sky-placed">
        {ordered.map((g) => {
          const d = describe(g)
          return (
            <div key={g.key} className="sky-placed-group">
              <div className="sky-placed-head">
                {d.label}
                <span className="sky-placed-sub">{d.sub}</span>
                <a className="sky-placed-open" href={d.href}>
                  {d.open} ›
                </a>
              </div>
              {g.rows.map((row) => (
                <div key={row.text} className="sky-placed-item">
                  <span className="sky-check-box" data-on={row.problem === null}>
                    {row.problem === null && Tick}
                  </span>
                  <span>
                    {row.time && <span className="sky-placed-time">{row.time} › </span>}
                    {row.text}
                    {row.problem && <span className="sky-placed-fail"> · didn't land: {row.problem}</span>}
                  </span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </Block>
  )
}

function Choice({
  prompt,
  onAnswer,
}: {
  prompt: Extract<PromptOnWire, { kind: 'select' | 'confirm' }>
  onAnswer: (answer: unknown) => void
}) {
  return (
    <Block head={prompt.prompt.message}>
      <div className="sky-pills">
        {prompt.kind === 'confirm' ? (
          <>
            <Button variant="light" color="blue" onClick={() => onAnswer(true)}>
              Yes
            </Button>
            <Button onClick={() => onAnswer(false)}>No</Button>
          </>
        ) : (
          prompt.prompt.options.map((o) => (
            <Button key={o.value} onClick={() => onAnswer(o.value)}>
              {o.label}
            </Button>
          ))
        )}
      </div>
    </Block>
  )
}

// --- what was filed ------------------------------------------------------------

/** The filed document's front matter, editable through the explorer's own rail. */
function FiledDetails({ file }: { file: string }) {
  const [doc, setDoc] = useState<{ content: string; version: number } | null>(null)
  const encoded = file.split('/').map(encodeURIComponent).join('/')
  useEffect(() => {
    fetch(`/docs/_api/content/${encoded}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setDoc(b as { content: string; version: number }))
      .catch(() => {})
  }, [encoded])
  const split = useMemo(() => splitFrontmatter(doc?.content ?? ''), [doc?.content])
  const save = async (text: string | null) => {
    if (!doc) return
    const content = joinFrontmatter(text, split.body)
    const r = await fetch(`/docs/_api/content/${encoded}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, version: doc.version }),
    })
    const b = (await r.json().catch(() => ({}))) as { version?: number }
    setDoc({ content, version: b.version ?? doc.version + 1 })
  }
  const state = useFrontmatter(doc ? split.frontmatter : null, file, doc ? (text) => void save(text) : undefined)
  if (!doc) return null
  return (
    <Block head="Details" mini="the file's front matter">
      <div className="sky-lead" style={{ marginBottom: 8 }}>
        Fix what the transcript got wrong. Changes write to the file.
      </div>
      <DocumentRail state={state} file={file} outline={[]} />
    </Block>
  )
}

function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  if (!content.startsWith('---\n')) return { frontmatter: null, body: content }
  const end = content.indexOf('\n---', 4)
  if (end < 0) return { frontmatter: null, body: content }
  const after = content.indexOf('\n', end + 1)
  return { frontmatter: content.slice(4, end), body: after < 0 ? '' : content.slice(after + 1) }
}

function joinFrontmatter(frontmatter: string | null, body: string): string {
  if (frontmatter === null || frontmatter.trim() === '') return body
  return `---\n${frontmatter.replace(/\n?$/, '\n')}---\n${body}`
}

/** The filed document, rendered the way the explorer renders it. */
function FiledDoc({ file }: { file: string }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    fetch(`/explorer/_api/doc?path=${encodeURIComponent(file)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setHtml((b as { html: string }).html))
      .catch(() => {})
  }, [file])
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (ref.current && html !== null) ref.current.innerHTML = html
  }, [html])
  if (html === null) return null
  return (
    <div className="sky-filed-doc sky-doc">
      <div className="sky-doc-body" ref={ref} />
    </div>
  )
}

export function ImportMain({
  id,
  back,
  onStartAgain,
}: {
  id: string
  back: { label: string; onClick: () => void }
  onStartAgain: (job: ImportJob) => void
}) {
  const { job, events, missing, refresh } = useImportFeed(id)
  const d = useMemo(() => derive(events), [events])
  const [history, setHistory] = useState<{ question: string; answer: string }[]>([])
  const startedAt = useMemo(() => {
    const last = events.at(-1)
    return last ? Date.now() : null
    // The clock restarts with every event: it measures the current silence.
  }, [events])
  const scrollRef = useRef<HTMLDivElement>(null)

  const answer = async (prompt: PromptOnWire, value: unknown) => {
    if (prompt.kind === 'text') {
      setHistory((h) => [
        ...h,
        { question: prompt.prompt.message.replace(/\s*\(.*\)\s*$/, ''), answer: String(value ?? '') },
      ])
    }
    await post(`/import/${id}/answer`, { promptId: prompt.id, answer: value }).catch(() => refresh())
  }
  const cancel = () => void post(`/import/${id}/cancel`, {}).catch(() => {})
  const remove = () =>
    void post(`/import/${id}/remove`, {})
      .then(() => back.onClick())
      .catch(() => {})

  if (missing) {
    return (
      <div className="sky-main sky-import">
        <header className="sky-head">
          <Button size="sm" onClick={back.onClick}>
            ‹ {back.label}
          </Button>
          <span className="sky-title">Import</span>
        </header>
        <div className="sky-scroll">
          <div className="sky-col">
            <div className="sky-blank" style={{ height: 'auto', padding: '24px 0' }}>
              <p>There is no import here any more.</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const steps = job && job.state !== 'new' ? ladder(job, d) : null
  const pending = job && job.state === 'needs-you' ? d.pending : null
  const busy = job?.state === 'running' || job?.state === 'needs-you'

  return (
    <div className="sky-main sky-import">
      <header className="sky-head">
        <Button size="sm" onClick={back.onClick}>
          ‹ {back.label}
        </Button>
        <span className="sky-title">{job?.title ?? 'Import'}</span>
        <nav className="sky-tabs">
          {busy && (
            <Button size="sm" onClick={cancel}>
              Cancel
            </Button>
          )}
          {job?.state === 'done' && job.result && (
            <Button size="sm" variant="light" color="blue" component="a" href={fileHref(job.result.file)}>
              Open it
            </Button>
          )}
          {(job?.state === 'failed' || job?.state === 'cancelled') && (
            <>
              {!job.readback.refusal && (
                <Button size="sm" variant="light" color="blue" onClick={() => onStartAgain(job)}>
                  Start again
                </Button>
              )}
              <Button size="sm" onClick={remove}>
                Remove
              </Button>
            </>
          )}
        </nav>
      </header>
      <div className="sky-scroll" ref={scrollRef}>
        <div className="sky-col" style={{ gap: 26 }}>
          {job && steps && <Ladder steps={steps} />}
          {job?.state === 'new' && (
            <Block head="Not started" mini={job.readback.summary}>
              <div className="sky-lead">This file is waiting for a Start.</div>
              <div className="sky-form-foot">
                <Button variant="light" color="blue" onClick={() => onStartAgain(job)}>
                  Start
                </Button>
                <Button onClick={remove}>Remove</Button>
              </div>
            </Block>
          )}
          {pending?.kind === 'form' && <ReviewForm prompt={pending} onAnswer={(a) => void answer(pending, a)} />}
          {pending?.kind === 'text' && job && (
            <CorrectionsExchange
              prompt={pending}
              d={d}
              job={job}
              history={history}
              onAnswer={(a) => void answer(pending, a)}
            />
          )}
          {pending?.kind === 'multiselect' && (
            <ActionItems prompt={pending} onAnswer={(a) => void answer(pending, a)} />
          )}
          {pending?.kind === 'place' && <PlaceItems prompt={pending} onAnswer={(a) => void answer(pending, a)} />}
          {(pending?.kind === 'select' || pending?.kind === 'confirm') && (
            <Choice prompt={pending} onAnswer={(a) => void answer(pending, a)} />
          )}
          {job && job.state === 'running' && <LiveBlock job={job} d={d} startedAt={startedAt} />}
          {job && job.state === 'needs-you' && !pending && <LiveBlock job={job} d={d} startedAt={startedAt} />}
          {job?.state === 'done' && (
            <>
              <div className="sky-condensed" data-tone="done">
                — filed{job.result ? ` · ${job.result.file}` : ''} —
              </div>
              {d.placed && <Placed placed={d.placed} lines={d.lines} />}
              {job.result && <FiledDetails file={job.result.file} />}
              {job.result && <FiledDoc file={job.result.file} />}
              {!job.result && <div className="sky-lead">Filed. The day has it.</div>}
            </>
          )}
          {(job?.state === 'failed' || job?.state === 'cancelled') && (
            <Block head={job.state === 'failed' ? "It didn't finish" : 'Cancelled'}>
              <div className="sky-lead">{job.error ?? job.line}</div>
              {d.lines.length > 0 && (
                <div className="sky-log" style={{ marginTop: 12 }}>
                  {d.lines.slice(-12).join('\n')}
                </div>
              )}
            </Block>
          )}
        </div>
      </div>
    </div>
  )
}
