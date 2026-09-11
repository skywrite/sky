import { ActionIcon, Button, SegmentedControl, Switch, Textarea } from '@mantine/core'
import { Fragment, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { AutomationCommandStep } from '#shared/models/Automation/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { AutomationSetup } from '../../automations/configure.ts'
import { AutomationBuilder, automationRequest } from './automationBuilder.tsx'
import { fileHref } from './explorer.tsx'
import { RenderedHtml } from './renderedHtml.tsx'
import { renderStatic } from './wysiwyg/render.ts'
import './automations.css'

/**
 * Automations — the machine's own jobs.
 *
 * Three pages over one report. The overview is a row per charter — name, the
 * brief's first line, the schedule in words, what the last run amounted to,
 * and the on/off switch. A charter's own page is its brief in full, its
 * schedule, the run ledger, and "Edit automation". Describe a new automation,
 * then customize its proposed commands and conditions before saving. Direct
 * command selection also supports scheduling several commands together.
 * Charters that could not be read get their own block, because a charter
 * that never fires looks exactly like one that had nothing to do.
 *
 * The charter file stays the source of truth; every page says where it
 * lives, and every write is as narrow as the words on the button.
 */

// -----------------------------------------------------------------------------
// What the service knows about the automations
// -----------------------------------------------------------------------------

export interface AutomationLastRun {
  utc: string
  /** `YYYY-MM-DD HH:MM` on the charter's own clock */
  clock: string
  outcome: 'acted' | 'nothing' | 'failed'
  target?: string
  lateMinutes?: number
  message?: string
}

export interface AutomationRow {
  name: string
  kind?: 'personal' | 'system'
  run: string
  commands?: AutomationCommandStep[]
  /** As written: "every 5m", "EVERY-WEEKDAY 07:15", "06:00, 11:00" */
  trigger: string
  /** "elapsed" for every:, else "local" or an IANA zone */
  frame: string
  state: 'active' | 'paused' | 'expired'
  due: boolean
  brief: string
  unknownKeys: string[]
  /** The charter's path relative to the automations directory */
  file: string
  /** Recent runs, newest first */
  runs: AutomationLastRun[]
  lastRun?: AutomationLastRun
}

export interface AutomationsReport {
  rows: AutomationRow[]
  charterErrors: { path: string; error: string }[]
  stateError?: string
  dir: string
}

/** A write happened; every mounted hook instance re-reads at once. */
const CHANGED = 'sky-automations-changed'

/** The report, refreshed on focus, once a runner tick, and after any write. */
export function useAutomations(): { report: AutomationsReport | null; refresh: () => void } {
  const [report, setReport] = useState<AutomationsReport | null>(null)
  useEffect(() => {
    let alive = true
    const read = () =>
      fetch('/automations/_api/status')
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => alive && body && setReport(body as AutomationsReport))
        .catch(() => {})
    void read()
    window.addEventListener('focus', read)
    window.addEventListener(CHANGED, read)
    const timer = setInterval(read, 60_000)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', read)
      window.removeEventListener(CHANGED, read)
    }
  }, [])
  return { report, refresh: () => window.dispatchEvent(new Event(CHANGED)) }
}

async function postStatus(name: string, status: 'active' | 'paused'): Promise<boolean> {
  try {
    const response = await fetch(`/automations/_api/automation/${encodeURIComponent(name)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    return response.ok
  } catch {
    return false
  }
}

async function postRun(name: string): Promise<{ outcome: string; message?: string } | null> {
  try {
    const response = await fetch(`/automations/_api/automation/${encodeURIComponent(name)}/run`, { method: 'POST' })
    if (!response.ok) return null
    return (await response.json()) as { outcome: string; message?: string }
  } catch {
    return null
  }
}

/** A model-drafted charter, validated on the service and not yet written */
export interface DraftWire {
  name: string
  contents: string
  run: string
  commands?: AutomationCommandStep[]
  trigger: string
  frame: string
  brief: string
  revised: boolean
  args?: Record<string, unknown>
  until?: string
}

type DraftAnswer = { ok: true; draft: DraftWire; setup: AutomationSetup } | { ok: false; message: string }

async function postDraft(request: string, revise?: string): Promise<DraftAnswer> {
  try {
    const response = await fetch('/automations/_api/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(revise ? { request, revise } : { request }),
    })
    const body = (await response.json().catch(() => ({}))) as DraftWire & { setup: AutomationSetup; message?: string }
    if (!response.ok) return { ok: false, message: body.message ?? `The service answered ${response.status}.` }
    return { ok: true, draft: body, setup: body.setup }
  } catch {
    return { ok: false, message: "Couldn't reach sky — is the service running?" }
  }
}

async function postWrite(url: string, payload: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (response.ok) return { ok: true }
    const body = (await response.json().catch(() => ({}))) as { message?: string }
    return { ok: false, message: body.message ?? `The service answered ${response.status}.` }
  } catch {
    return { ok: false, message: "Couldn't reach sky — is the service running?" }
  }
}

const postCreate = (name: string, contents: string) => postWrite('/automations/_api/create', { name, contents })
const postSave = (name: string, contents: string) =>
  postWrite(`/automations/_api/automation/${encodeURIComponent(name)}/save`, { contents })

// -----------------------------------------------------------------------------
// Words — the wire carries the charter's own grammar; the page speaks person
// -----------------------------------------------------------------------------

/** "atlas-prices" reads as "Atlas prices" */
export function titleOf(name: string): string {
  const words = name.replace(/[-_]+/g, ' ').trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : name
}

const DAY_WORDS: Record<string, string> = {
  'EVERY-DAY': 'Every day',
  'EVERY-WEEKDAY': 'Weekdays',
  'EVERY-WEEKEND': 'Weekends',
  'EVERY-MON': 'Mondays',
  'EVERY-TUE': 'Tuesdays',
  'EVERY-WED': 'Wednesdays',
  'EVERY-THU': 'Thursdays',
  'EVERY-FRI': 'Fridays',
  'EVERY-SAT': 'Saturdays',
  'EVERY-SUN': 'Sundays',
}

const UNIT_WORDS: Record<string, [string, string]> = {
  s: ['second', 'seconds'],
  m: ['minute', 'minutes'],
  h: ['hour', 'hours'],
  d: ['day', 'days'],
  w: ['week', 'weeks'],
}

/** "06:05" → "6:05"; extended hours stay as filed */
function timeWords(time: string): string {
  return time.replace(/^0(\d:)/, '$1')
}

/** The zone's city — "America/New_York" → "New York" */
function zoneWords(zone: string): string {
  return zone.split('/').pop()?.replace(/_/g, ' ') ?? zone
}

type AtEntry = { pattern: string; time: string }

function atEntries(trigger: string): AtEntry[] {
  return trigger.split(', ').map((entry) => {
    const parts = entry.split(' ')
    if (parts.length === 1) return { pattern: 'EVERY-DAY', time: timeWords(parts[0]!) }
    return { pattern: parts[0]!, time: timeWords(parts[1]!) }
  })
}

/**
 * The trigger in words. Anything the small vocabulary here doesn't cover —
 * biweekly patterns, monthly days — shows as written, which is still words.
 */
export function scheduleWords(trigger: string, frame: string): string {
  if (trigger.startsWith('every ')) {
    const match = /^every (\d+)([a-z]+)$/.exec(trigger)
    const unit = match && UNIT_WORDS[match[2]!]
    const spoken = unit ? `every ${match[1]} ${Number(match[1]) === 1 ? unit[0] : unit[1]}` : trigger
    return spoken.replace(/^every 1 (\w+)$/, 'every $1')
  }

  const entries = atEntries(trigger)
  const patterns = new Set(entries.map((e) => e.pattern))
  const zone = frame !== 'local' && frame !== 'elapsed' ? ` · ${zoneWords(frame)}` : ''

  // One shared day: "Weekdays at 7:15", or "6:00 · 11:00 · 16:00 · 21:00" daily.
  if (patterns.size === 1) {
    const day = DAY_WORDS[entries[0]!.pattern] ?? entries[0]!.pattern
    const times = entries.map((e) => e.time).join(' · ')
    if (entries[0]!.pattern === 'EVERY-DAY' && entries.length > 1) return times + zone
    return `${day} at ${times}${zone}`
  }
  return entries.map((e) => `${DAY_WORDS[e.pattern] ?? e.pattern} ${e.time}`).join(' · ') + zone
}

/** The shortest true label for a sidebar row: "7:00", "4×/day", "5m", "paused" */
export function sidebarMeta(row: AutomationRow): string {
  if (row.state !== 'active') return row.state
  if (row.trigger.startsWith('every ')) return row.trigger.slice('every '.length)
  const entries = atEntries(row.trigger)
  if (entries.length === 1) return entries[0]!.time
  const daily = entries.every((e) => e.pattern === 'EVERY-DAY')
  return `${entries.length}×${daily ? '/day' : ''}`
}

/** "2026-08-31 16:00" → "today 16:00", against the viewer's calendar */
function whenWords(clock: string): string {
  const [date, time = ''] = clock.split(' ')
  const today = PlainDate.today()
  if (date === today.ymd) return `today ${timeWords(time)}`
  if (date === today.addDays(-1).ymd) return `yesterday ${timeWords(time)}`
  return `${date?.slice(5) ?? ''} ${timeWords(time)}`
}

function outcomeWords(run: AutomationLastRun): string {
  if (run.outcome === 'failed') return "couldn't run"
  if (run.outcome === 'nothing') return 'nothing to do'
  return 'ran'
}

function lastRunWords(run: AutomationLastRun): string {
  return `${whenWords(run.clock)} · ${outcomeWords(run)}`
}

/** A reply's markdown as HTML — null on any rendering failure, leaving the raw text to stand. */
function renderMarkdown(raw: string): string | null {
  try {
    return renderStatic(raw)
  } catch {
    return null
  }
}

// -----------------------------------------------------------------------------
// The overview
// -----------------------------------------------------------------------------

function dotTone(row: AutomationRow): string | undefined {
  if (row.state !== 'active') return undefined
  if (row.lastRun?.outcome === 'failed') return 'failed'
  return 'done'
}

/** The one direct control a row carries: on or off, written into the file. */
function StatusSwitch({ row, refresh }: { row: AutomationRow; refresh: () => void }) {
  const [busy, setBusy] = useState(false)
  const on = row.state !== 'paused'
  return (
    <Switch
      size="md"
      color="green"
      checked={on}
      disabled={busy}
      aria-label={`${titleOf(row.name)} ${on ? 'on' : 'off'}`}
      onChange={() => {
        setBusy(true)
        void postStatus(row.name, on ? 'paused' : 'active')
          .then(refresh)
          .finally(() => setBusy(false))
      }}
    />
  )
}

function Row({ row, onOpen, refresh }: { row: AutomationRow; onOpen: (name: string) => void; refresh: () => void }) {
  // The brief often opens with a markdown heading; its text is the line to show.
  const briefLine = (row.brief.split('\n').find((line) => line.trim()) ?? '').replace(/^#+\s*/, '')
  const lastTone = row.lastRun?.outcome === 'failed' ? 'failed' : undefined
  return (
    <div className="sky-auto-row">
      <span className="sky-run-dot">
        <span className="sky-dot" data-tone={dotTone(row)} />
      </span>
      <button type="button" className="sky-auto-txt" onClick={() => onOpen(row.name)}>
        <span className="sky-auto-name">
          {titleOf(row.name)}
          {row.kind === 'system' && <span className="sky-count"> · system</span>}
        </span>
        {briefLine && <span className="sky-auto-sub">{briefLine}</span>}
        {row.lastRun?.message && <span className="sky-auto-sub sky-auto-note">{row.lastRun.message}</span>}
        {row.unknownKeys.length > 0 && (
          <span className="sky-auto-sub sky-auto-warn">nothing reads: {row.unknownKeys.join(', ')}</span>
        )}
      </button>
      <span className="sky-auto-when">
        {row.state === 'active' ? scheduleWords(row.trigger, row.frame) : row.state}
        <span className="sky-auto-last" data-tone={lastTone}>
          {row.due ? 'due — runs within a minute' : row.lastRun ? lastRunWords(row.lastRun) : 'never run'}
        </span>
      </span>
      <StatusSwitch row={row} refresh={refresh} />
    </div>
  )
}

function CharterErrors({ report }: { report: AutomationsReport }) {
  if (!report.charterErrors.length) return null
  return (
    <section className="sky-block">
      <div className="sky-block-head">
        Couldn't be read
        <span className="sky-spacer" />
        <span className="sky-count">{report.charterErrors.length}</span>
      </div>
      <div className="sky-block-pad">
        {report.charterErrors.map((problem) => (
          <div key={problem.path} className="sky-auto-row">
            <span className="sky-run-dot">
              <span className="sky-dot" data-tone="failed" />
            </span>
            <span className="sky-auto-txt">
              <span className="sky-auto-name">{problem.path.split('/').pop()}</span>
              <span className="sky-auto-sub">{problem.error}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function Foot({ report }: { report: AutomationsReport }) {
  const shortDir = report.dir.replace(/^\/(Users|home)\/[^/]+/, '~')
  return (
    <div className="sky-auto-foot">
      <span>During quiet hours (22:00–04:00) sky may sleep — anything due then runs when it wakes.</span>
      <span>Each automation is a file in {shortDir} — edit one there and this page follows.</span>
    </div>
  )
}

export function AutomationsMain({
  back,
  onOpen,
  onNew,
}: {
  back: { label: string; onClick: () => void }
  onOpen: (name: string) => void
  onNew: () => void
}) {
  const { report, refresh } = useAutomations()
  const rows = report?.rows ?? []
  const on = rows.filter((row) => row.state === 'active').length
  const rest = rows.length - on

  return (
    <div className="sky-main">
      <header className="sky-head">
        <Button size="sm" onClick={back.onClick} style={{ marginLeft: -10 }}>
          ‹ {back.label}
        </Button>
        <span className="sky-title">Automations</span>
        <span className="sky-spacer" style={{ flex: 1 }} />
        <Button variant="primary" size="sm" onClick={onNew}>
          New automation
        </Button>
      </header>

      <div className="sky-scroll">
        <div className="sky-col sky-automations">
          <section className="sky-block">
            <div className="sky-block-head">
              Running for you
              <span className="sky-spacer" />
              {rows.length > 0 && (
                <span className="sky-count">
                  {on} on{rest > 0 ? ` · ${rest} off` : ''}
                </span>
              )}
            </div>
            <div className="sky-block-pad">
              {report === null ? (
                <div className="sky-auto-empty">…</div>
              ) : rows.length === 0 ? (
                <div className="sky-auto-empty">
                  Nothing declared yet. Charters live in {report.dir.replace(/^\/(Users|home)\/[^/]+/, '~')}.
                </div>
              ) : (
                rows.map((row) => (
                  <Fragment key={row.name}>
                    <Row row={row} onOpen={onOpen} refresh={refresh} />
                  </Fragment>
                ))
              )}
            </div>
          </section>

          {report && <CharterErrors report={report} />}

          {report?.stateError && (
            <div className="sky-condensed" data-tone="failed">
              — run-state unusable, so every charter reads as never run: {report.stateError} —
            </div>
          )}

          {report && <Foot report={report} />}
        </div>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Proposals — a drafted charter, shown whole before anything is written
// -----------------------------------------------------------------------------

/** The composer idiom: one line that grows, Enter asks, Shift+Enter breaks. */
function AskInput({ placeholder, busy, onAsk }: { placeholder: string; busy: boolean; onAsk: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const submit = () => {
    const text = ref.current?.value.trim()
    if (text && !busy) onAsk(text)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }
  return (
    <div className="sky-auto-ask">
      <div className="sky-input">
        <Textarea
          ref={ref}
          variant="unstyled"
          classNames={{ root: 'sky-input-root', input: 'sky-input-field' }}
          autosize
          minRows={1}
          maxRows={6}
          placeholder={placeholder}
          aria-label={placeholder}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
      </div>
      <ActionIcon variant="primary" aria-label="Ask sky" onClick={submit} disabled={busy}>
        ↑
      </ActionIcon>
    </div>
  )
}

function ProposalCard({
  draft,
  accept,
  busy,
  error,
  onAccept,
  onDiscard,
  onCustomize,
  onBack,
}: {
  draft: DraftWire
  accept: string
  busy: boolean
  error: string | null
  onAccept: () => void
  onDiscard?: () => void
  onCustomize?: () => void
  onBack?: () => void
}) {
  const [fileOpen, setFileOpen] = useState(false)
  const briefHtml = useMemo(() => renderMarkdown(draft.brief), [draft.brief])
  return (
    <section className="sky-block">
      <div className="sky-block-head">
        {titleOf(draft.name)}
        <span className="sky-spacer" />
        <span className="sky-mini">→ automations/{draft.name}.md</span>
      </div>
      <div className="sky-block-pad">
        <div className="sky-auto-spec">
          <span className="sky-auto-spec-key">When</span>
          <span>{scheduleWords(draft.trigger, draft.frame)}</span>
        </div>
        <div className="sky-auto-spec">
          <span className="sky-auto-spec-key">Runs</span>
          <ol className="sky-auto-command-list">
            {(draft.commands ?? [{ run: draft.run, args: draft.args ?? {} }]).map((command, index) => (
              <li key={`${index}-${command.run}`}>
                <span>{command.run}</span>
                {draft.commands && draft.commands.length > 1 && command.args.day !== undefined && (
                  <small>{command.args.day === 'yesterday' ? 'Previous day' : String(command.args.day)}</small>
                )}
              </li>
            ))}
          </ol>
        </div>
        {draft.args?.day !== undefined && (
          <div className="sky-auto-spec">
            <span className="sky-auto-spec-key">Day</span>
            <span>
              {draft.args.day === 'yesterday' ? 'Previous day, worked out at each run' : String(draft.args.day)}
            </span>
          </div>
        )}
        {draft.until && (
          <div className="sky-auto-spec">
            <span className="sky-auto-spec-key">Until</span>
            <span>{draft.until}</span>
          </div>
        )}
        <div className="sky-auto-spec" data-last="true">
          <span className="sky-auto-spec-key">Why</span>
          {briefHtml ? (
            <RenderedHtml className="sky-body sky-rendered sky-auto-brief" html={briefHtml} />
          ) : (
            <span style={{ whiteSpace: 'pre-wrap' }}>{draft.brief}</span>
          )}
        </div>

        <button type="button" className="sky-showlink" onClick={() => setFileOpen((open) => !open)}>
          {fileOpen ? '▾' : '▸'} The whole file
        </button>
        {fileOpen && <pre className="sky-auto-file">{draft.contents.trimEnd()}</pre>}

        {error && (
          <div className="sky-auto-problem" role="alert">
            {error}
          </div>
        )}
        <div className={`sky-auto-actions${onBack ? ' sky-auto-wizard-actions' : ''}`}>
          {onBack && (
            <Button onClick={onBack} disabled={busy}>
              Back
            </Button>
          )}
          <Button variant="primary" onClick={onAccept} disabled={busy}>
            {busy ? 'Writing…' : accept}
          </Button>
          {onCustomize && (
            <Button onClick={onCustomize} disabled={busy}>
              Customize
            </Button>
          )}
          {onDiscard && (
            <Button onClick={onDiscard} disabled={busy}>
              Discard
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}

// -----------------------------------------------------------------------------
// New automation — describe it, customize the proposal, then turn it on
// -----------------------------------------------------------------------------

const CREATION_STEPS = [
  {
    id: 'describe',
    label: 'Describe',
    title: 'What should Sky take care of?',
    description: 'Tell Sky what to do and when. You can adjust the details before turning it on.',
  },
  {
    id: 'configure',
    label: 'Configure',
    title: 'Set up your automation',
    description: 'Choose what runs and when, then review your automation.',
  },
  {
    id: 'review',
    label: 'Review',
    title: 'Ready to turn it on?',
    description: 'Check the commands and schedule. Go back to make any changes.',
  },
] as const
type CreationStep = (typeof CREATION_STEPS)[number]['id']

export function NewAutomation({
  back,
  onCreated,
}: {
  back: { label: string; onClick: () => void }
  onCreated: (name: string) => void
}) {
  const [request, setRequest] = useState('')
  const [draftedRequest, setDraftedRequest] = useState('')
  const [step, setStep] = useState<CreationStep>('describe')
  const [builderOpened, setBuilderOpened] = useState(false)
  const [initialSetup, setInitialSetup] = useState<AutomationSetup>()
  const [drafting, setDrafting] = useState(false)
  const [draft, setDraft] = useState<DraftWire | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [writeProblem, setWriteProblem] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const busy = drafting || writing
  const stepIndex = CREATION_STEPS.findIndex((entry) => entry.id === step)
  const currentStep = CREATION_STEPS[stepIndex]!

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    headingRef.current?.focus({ preventScroll: true })
  }, [step])

  const clearPreview = () => {
    setDraft(null)
    setWriteProblem(null)
    setProblem(null)
  }
  const goTo = (next: CreationStep) => {
    if (busy) return
    clearPreview()
    setStep(next)
  }
  const configure = () => {
    setBuilderOpened(true)
    goTo('configure')
  }
  const ask = () => {
    if (!request.trim() || busy) return
    if (request.trim() === draftedRequest) {
      configure()
      return
    }
    setDrafting(true)
    clearPreview()
    void postDraft(request.trim()).then((answer) => {
      setDrafting(false)
      if (answer.ok) {
        setDraftedRequest(request.trim())
        setInitialSetup(answer.setup)
        setBuilderOpened(true)
        setStep('configure')
      } else setProblem(answer.message)
    })
  }
  const preview = (setup: AutomationSetup) => {
    if (busy) return
    setDrafting(true)
    clearPreview()
    void automationRequest<DraftWire>('preview', setup)
      .then((proposal) => {
        setDraft(proposal)
        setStep('review')
      })
      .catch((error: unknown) =>
        setProblem(error instanceof Error ? error.message : 'Could not prepare the automation.'),
      )
      .finally(() => setDrafting(false))
  }
  const turnOn = () => {
    if (!draft || writing) return
    setWriting(true)
    setWriteProblem(null)
    void postCreate(draft.name, draft.contents).then((outcome) => {
      setWriting(false)
      if (outcome.ok) {
        window.dispatchEvent(new Event(CHANGED))
        onCreated(draft.name)
      } else setWriteProblem(outcome.message)
    })
  }

  return (
    <div className="sky-main">
      <header className="sky-head sky-auto-detail-head">
        <Button size="sm" className="sky-auto-back" onClick={back.onClick} disabled={busy}>
          ‹ {back.label}
        </Button>
        <span className="sky-title">New automation</span>
      </header>
      <div className="sky-scroll" ref={scrollRef}>
        <div className="sky-col sky-automations sky-auto-wizard">
          <nav aria-label="Automation creation">
            <ol className="sky-auto-steps">
              {CREATION_STEPS.map((entry, index) => (
                <li key={entry.id} aria-current={step === entry.id ? 'step' : undefined}>
                  {index < stepIndex ? (
                    <Button size="sm" className="sky-auto-step" disabled={busy} onClick={() => goTo(entry.id)}>
                      <span className="sky-auto-step-number" aria-hidden="true">
                        ✓
                      </span>
                      {entry.label}
                    </Button>
                  ) : (
                    <span className="sky-auto-step">
                      <span className="sky-auto-step-number" aria-hidden="true">
                        {index + 1}
                      </span>
                      {entry.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          <div>
            <h2 className="sky-auto-hero" ref={headingRef} tabIndex={-1}>
              {currentStep.title}
            </h2>
            <p className="sky-auto-herosub">{currentStep.description}</p>
          </div>
          <div hidden={step !== 'describe'}>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                ask()
              }}
            >
              <div className="sky-input">
                <Textarea
                  variant="unstyled"
                  classNames={{ root: 'sky-input-root', input: 'sky-input-field' }}
                  autosize
                  minRows={3}
                  maxRows={6}
                  placeholder="Every weekday at 7…"
                  aria-label="Describe your automation"
                  value={request}
                  onChange={(event) => setRequest(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      ask()
                    }
                  }}
                  disabled={busy}
                />
              </div>
              <div className="sky-auto-actions sky-auto-wizard-actions">
                <Button size="sm" variant="primary-quiet" onClick={configure} disabled={busy}>
                  Choose commands instead
                </Button>
                <Button type="submit" variant="primary" disabled={busy || !request.trim()}>
                  {drafting ? 'Preparing…' : 'Continue'}
                </Button>
              </div>
            </form>
          </div>
          {/* Keep the builder mounted so Back preserves every unfinished field. */}
          <div hidden={step !== 'configure'}>
            {builderOpened && (
              <AutomationBuilder
                initialSetup={initialSetup}
                busy={busy}
                onPreview={preview}
                onChange={clearPreview}
                onBack={() => goTo('describe')}
              />
            )}
          </div>
          {drafting && (
            <div className="sky-condensed" role="status">
              Preparing your automation…
            </div>
          )}
          {problem && (
            <div className="sky-auto-problem" role="alert">
              {problem}
            </div>
          )}
          {step === 'review' && draft && (
            <ProposalCard
              draft={draft}
              accept="Turn it on"
              busy={writing}
              error={writeProblem}
              onAccept={turnOn}
              onBack={() => goTo('configure')}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// One automation
// -----------------------------------------------------------------------------

const RUNS_FOLDED = 10

/** Direct settings and written requests both become a proposal before saving. */
function ChangeIt({ name, onSaved }: { name: string; onSaved: (note: string) => void }) {
  const [mode, setMode] = useState('commands')
  const [initialSetup, setInitialSetup] = useState<AutomationSetup>()
  const [drafting, setDrafting] = useState(false)
  const [draft, setDraft] = useState<DraftWire | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [writeProblem, setWriteProblem] = useState<string | null>(null)

  const preview = (setup: AutomationSetup) => {
    setDrafting(true)
    setDraft(null)
    setProblem(null)
    setWriteProblem(null)
    void automationRequest<DraftWire>('preview', setup)
      .then(setDraft)
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : 'Could not prepare the changes.'))
      .finally(() => setDrafting(false))
  }

  const ask = (request: string) => {
    setDrafting(true)
    setProblem(null)
    setDraft(null)
    setWriteProblem(null)
    void postDraft(request, name).then((answer) => {
      setDrafting(false)
      if (answer.ok) {
        setDraft(answer.draft)
        setInitialSetup(answer.setup)
      } else setProblem(answer.message)
    })
  }

  const apply = () => {
    if (!draft) return
    setWriting(true)
    setWriteProblem(null)
    void postSave(name, draft.contents).then((outcome) => {
      setWriting(false)
      if (outcome.ok) {
        setDraft(null)
        onSaved('updated — file rewritten')
      } else setWriteProblem(outcome.message)
    })
  }

  return (
    <section className="sky-block">
      <div className="sky-block-head">Edit automation</div>
      <div className="sky-block-pad">
        <SegmentedControl
          aria-label="Edit automation"
          fullWidth
          classNames={{ label: 'sky-auto-mode-label' }}
          value={mode}
          disabled={drafting || writing}
          data={[
            { value: 'commands', label: 'Commands & conditions' },
            { value: 'describe', label: 'Describe a change' },
          ]}
          onChange={(value) => {
            setMode(value)
            setProblem(null)
            setWriteProblem(null)
          }}
        />
        <div style={{ marginTop: 20 }}>
          <div hidden={mode !== 'commands'}>
            <Fragment key={name}>
              <AutomationBuilder
                revise={name}
                initialSetup={initialSetup}
                busy={drafting || writing}
                onPreview={preview}
                onChange={() => {
                  setDraft(null)
                  setProblem(null)
                  setWriteProblem(null)
                }}
              />
            </Fragment>
          </div>
          <div hidden={mode !== 'describe'}>
            <AskInput
              placeholder="Tell sky what to change — “run at 8 instead”, “skip fridays”…"
              busy={drafting || writing}
              onAsk={ask}
            />
          </div>
        </div>
        {drafting && (
          <div className="sky-condensed" style={{ marginTop: 10 }}>
            — sky is rewriting the charter… —
          </div>
        )}
        {problem && (
          <div className="sky-condensed" data-tone="failed" style={{ marginTop: 10 }}>
            — {problem} —
          </div>
        )}
        {draft && (
          <div style={{ marginTop: 14 }}>
            <ProposalCard
              draft={draft}
              accept="Apply"
              busy={writing}
              error={writeProblem}
              onAccept={apply}
              onDiscard={() => setDraft(null)}
              onCustomize={mode === 'describe' ? () => setMode('commands') : undefined}
            />
          </div>
        )}
      </div>
    </section>
  )
}

function RunLine({ run }: { run: AutomationLastRun }) {
  const late = run.lateMinutes && run.lateMinutes > 0 ? ` · +${run.lateMinutes}m` : ''
  return (
    <div className="sky-auto-runline" data-tone={run.outcome}>
      <span className="sky-auto-at">{whenWords(run.clock)}</span>
      <span className="sky-auto-runtxt">
        <span className="sky-auto-outcome">{outcomeWords(run)}</span>
        {run.message ? ` — ${run.message}` : ''}
        {late}
      </span>
    </div>
  )
}

export function AutomationDetail({ name, back }: { name: string; back: { label: string; onClick: () => void } }) {
  const editRef = useRef<HTMLDivElement>(null)
  const { report, refresh } = useAutomations()
  const row = report?.rows.find((candidate) => candidate.name === name) ?? null
  const [allRuns, setAllRuns] = useState(false)
  const [running, setRunning] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const briefHtml = useMemo(() => (row?.brief ? renderMarkdown(row.brief) : null), [row?.brief])

  // The outcome note stands long enough to read, then steps aside.
  useEffect(() => {
    if (!note) return
    const timer = setTimeout(() => setNote(null), 8_000)
    return () => clearTimeout(timer)
  }, [note])

  const runNow = () => {
    setRunning(true)
    setNote(null)
    void postRun(name)
      .then((outcome) => {
        if (!outcome) setNote("couldn't reach sky")
        else if (outcome.outcome === 'failed') setNote(`couldn't run${outcome.message ? ` — ${outcome.message}` : ''}`)
        else if (outcome.outcome === 'nothing') setNote('ran — nothing to do')
        else setNote(`ran${outcome.message ? ` — ${outcome.message}` : ''}`)
        refresh()
      })
      .finally(() => setRunning(false))
  }

  const runs = row?.runs ?? []
  const shown = allRuns ? runs : runs.slice(0, RUNS_FOLDED)

  return (
    <div className="sky-main">
      <header className="sky-head sky-auto-detail-head">
        <Button size="sm" onClick={back.onClick} className="sky-auto-back">
          ‹ {back.label}
        </Button>
        <span className="sky-title">{titleOf(name)}</span>
        <span className="sky-spacer" style={{ flex: 1 }} />
        {row && (
          <div className="sky-auto-detail-actions">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                editRef.current?.scrollIntoView({ block: 'start' })
                const input = editRef.current?.querySelector<HTMLInputElement>('input[role="combobox"]')
                input?.focus({ preventScroll: true })
                input?.select()
              }}
            >
              Edit automation
            </Button>
            <Button size="sm" onClick={runNow} disabled={running}>
              {running ? 'Running…' : 'Run now'}
            </Button>
            <StatusSwitch row={row} refresh={refresh} />
          </div>
        )}
      </header>

      <div className="sky-scroll">
        <div className="sky-col sky-automations">
          {report && !row && (
            <div className="sky-auto-empty">
              There is no automation named “{name}”. The overview lists what's declared.
            </div>
          )}

          {row && (
            <>
              {note && (
                <div className="sky-auto-run-note" role="status">
                  {note}
                </div>
              )}
              <section className="sky-block">
                <div className="sky-block-head">
                  What it does
                  <span className="sky-spacer" />
                  <span className="sky-count">
                    {row.commands && row.commands.length > 1 ? `${row.commands.length} commands` : `runs ${row.run}`}
                  </span>
                </div>
                <div className="sky-block-pad">
                  {row.brief ? (
                    briefHtml ? (
                      <RenderedHtml className="sky-body sky-rendered sky-auto-brief" html={briefHtml} />
                    ) : (
                      <p className="sky-auto-briefraw">{row.brief}</p>
                    )
                  ) : (
                    <div className="sky-auto-empty">The charter has no brief — the file is frontmatter only.</div>
                  )}
                </div>
              </section>

              <section className="sky-block">
                <div className="sky-block-head">When</div>
                <div className="sky-block-pad">
                  <div className="sky-auto-schedule">{scheduleWords(row.trigger, row.frame)}</div>
                  {row.due && <div className="sky-auto-due">due — runs within a minute</div>}
                  {row.unknownKeys.length > 0 && (
                    <div className="sky-auto-sub sky-auto-warn" style={{ marginTop: 6 }}>
                      nothing reads: {row.unknownKeys.join(', ')} — probably a typo in the file
                    </div>
                  )}
                </div>
              </section>

              <div ref={editRef} className="sky-auto-edit">
                <Fragment key={name}>
                  <ChangeIt
                    name={name}
                    onSaved={(saved) => {
                      setNote(saved)
                      refresh()
                    }}
                  />
                </Fragment>
              </div>

              <div>
                <p className="sky-rec-label">Runs</p>
                {runs.length === 0 ? (
                  <div className="sky-auto-empty">No runs recorded yet.</div>
                ) : (
                  <>
                    {shown.map((run, index) => (
                      <Fragment key={`${run.utc}-${index}`}>
                        <RunLine run={run} />
                      </Fragment>
                    ))}
                    {runs.length > RUNS_FOLDED && !allRuns && (
                      <button type="button" className="sky-showlink" onClick={() => setAllRuns(true)}>
                        Show all {runs.length}
                      </button>
                    )}
                  </>
                )}
              </div>

              <div className="sky-auto-foot">
                <span>
                  a file: automations/{row.file} · <a href={fileHref(`automations/${row.file}`)}>View file</a> — edit it
                  by hand any time; this page reads whatever the file says
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** The sidebar's automation rows — the overview's roster, one row a page. */
export function AutomationsSideNav({
  activeName,
  onOverview,
  onOpen,
  overviewActive,
}: {
  activeName: string | null
  onOverview: () => void
  onOpen: (name: string) => void
  overviewActive: boolean
}) {
  const { report } = useAutomations()
  return (
    <>
      <button type="button" className="sky-thread" data-active={overviewActive} onClick={onOverview}>
        <span>Overview</span>
      </button>
      {(report?.rows ?? []).map((row) => (
        <button
          key={row.name}
          type="button"
          className="sky-thread"
          data-active={row.name === activeName}
          onClick={() => onOpen(row.name)}
        >
          <span>{titleOf(row.name)}</span>
          <span className="sky-meta">{sidebarMeta(row)}</span>
        </button>
      ))}
    </>
  )
}
