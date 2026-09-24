/**
 * Google's own page under Connections. Connecting is: sign in, tick the
 * boxes — Sky sets up the Google Cloud side itself in the window and the
 * page reads its checklist as it goes (lib/google/cloudSetup). Every
 * account gets that, its own private connection: the pair one account
 * granted to may be shut to another (a work client is often restricted to
 * its organization), and the page cannot tell in advance. A connected
 * account shows what it covers and names a box left unticked; Connect again
 * signs in with the pair that already served it. Pasting a client of your
 * own stays, under Advanced, and signs in with it at once. Each account
 * says which side of the day its saved mail is filed under: Professional,
 * as before, or Personal.
 */

import { Button, PasswordInput, SegmentedControl, Switch, TextInput } from '@mantine/core'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { saveSetting, type SettingsData } from './settings.tsx'
import { Block, refusalOf, Row, UNREACHABLE } from './settingsBlocks.tsx'
import { ConnectionPage } from './settingsConnectionPage.tsx'
import { API, type ConnectionsData, postJson, useConnections, useTypeSafe } from './settingsConnections.tsx'

// ── What the service answers (mirrors handler/settings/connections.ts) ──

type ConnectState = { status: 'waiting' } | { status: 'done'; email: string } | { status: 'failed'; message: string }

type SetupStep = { key: string; label: string; state: 'todo' | 'doing' | 'done' }

type SetupState = {
  status: 'running' | 'done' | 'failed'
  steps: SetupStep[]
  needsYou?: { step: string; message: string; instruction?: string }
  projectId?: string
  /** The account being connected, once the console has shown it */
  account?: string
  email?: string
  message?: string
}

/** The run is asked after this often while the page is open. */
const POLL_MS = 1000

const TERMS_URL = 'https://cloud.google.com/terms'
const DATA_POLICY_URL = 'https://developers.google.com/terms/api-services-user-data-policy'

/** A day, the way the page says it: "22 Sep". */
function dayLabel(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

// ── The automated setup, polled ─────────────────────────────────────

function useGoogleSetup(onDone: (email: string) => void) {
  const [run, setRun] = useState<{ id: string; state: SetupState } | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  const stop = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current)
    timer.current = null
  }, [])
  useEffect(() => stop, [stop])

  const follow = useCallback(
    (id: string) => {
      stop()
      timer.current = window.setInterval(async () => {
        const res = await fetch(`${API}/google/setup/${id}`).catch(() => null)
        if (!res?.ok) return
        const state = (await res.json()) as SetupState
        setRun({ id, state })
        if (state.status === 'running') return
        stop()
        if (state.status === 'done' && state.email) onDone(state.email)
      }, POLL_MS)
    },
    [onDone, stop],
  )

  const start = useCallback(
    async (only?: 'tidy') => {
      setWarn(null)
      const r = await postJson(`${API}/google/setup`, only === 'tidy' ? { tidy: true } : {})
      const refusal = await refusalOf(r)
      if (refusal || !r) {
        setWarn(refusal ?? UNREACHABLE)
        return
      }
      const { id } = (await r.json()) as { id: string }
      const first = await fetch(`${API}/google/setup/${id}`).catch(() => null)
      if (first?.ok) setRun({ id, state: (await first.json()) as SetupState })
      follow(id)
    },
    [follow],
  )

  const act = useCallback(
    async (what: 'continue' | 'cancel') => {
      if (!run) return
      const refusal = await refusalOf(await postJson(`${API}/google/setup/${run.id}/${what}`, {}))
      if (refusal) setWarn(refusal)
    },
    [run],
  )

  const clear = useCallback(() => {
    stop()
    setRun(null)
    setWarn(null)
  }, [stop])

  return { run, warn, start, continue: () => act('continue'), cancel: () => act('cancel'), clear }
}

/** A row of its own, the way an account has one: the new connection, before and while it is made. */
const NEW_ACCOUNT = 'New account'

/** What the person agrees to before the window opens, then Start. */
function StartRow({ onStart, onCancel }: { onStart: () => void; onCancel: () => void }) {
  return (
    <Row
      label={NEW_ACCOUNT}
      sub={
        <>
          <span className="sky-set-line">
            Sky sets up a private connection inside your own Google account. About two minutes — Sky does the clicking.
          </span>
          <ol className="sky-set-steps">
            <li>A window opens. Sign in to Google there.</li>
            <li>Sky sets things up.</li>
            <li>Google asks what Sky may see. Tick every box, then Continue.</li>
          </ol>
          <span className="sky-set-line">
            Google may email you about a new sign-in — that is this window. On your behalf Sky agrees to{' '}
            <a href={TERMS_URL} target="_blank" rel="noreferrer">
              Google Cloud&rsquo;s terms
            </a>{' '}
            and the{' '}
            <a href={DATA_POLICY_URL} target="_blank" rel="noreferrer">
              API user data policy
            </a>
            .
          </span>
        </>
      }
      last
    >
      <Button size="compact-sm" variant="primary" onClick={onStart}>
        Start
      </Button>
      <Button size="compact-sm" onClick={onCancel}>
        Cancel
      </Button>
    </Row>
  )
}

/** The run as it goes: the checklist, and the line for the person when the window needs them. */
function SetupRow({
  state,
  onContinue,
  onCancel,
  onClose,
}: {
  state: SetupState
  onContinue: () => void
  onCancel: () => void
  onClose: () => void
}) {
  const wait = state.needsYou
  return (
    <Row
      label={state.email ?? state.account ?? NEW_ACCOUNT}
      sub={
        <div aria-live="polite">
          <ul className="sky-set-list sky-set-checklist">
            {state.steps.map((step) => (
              <li key={step.key} data-state={step.state}>
                <span aria-hidden="true">{step.state === 'done' ? '✓' : step.state === 'doing' ? '·' : ' '}</span>{' '}
                {step.label}
              </li>
            ))}
          </ul>
          {state.status === 'running' && wait && (
            <p className="sky-set-needs-you" role="status">
              <strong>{wait.message}</strong>
              {wait.instruction && <span className="sky-set-sub sky-set-line">How: {wait.instruction}</span>}
            </p>
          )}
          {state.status === 'failed' && (
            <p className="sky-set-warn" role="alert">
              {state.message}
            </p>
          )}
        </div>
      }
      last
    >
      {state.status === 'running' && wait?.instruction && (
        <Button size="compact-sm" variant="primary" onClick={onContinue}>
          Done — continue
        </Button>
      )}
      {state.status === 'running' ? (
        <Button size="compact-sm" onClick={onCancel}>
          Cancel
        </Button>
      ) : (
        <Button size="compact-sm" onClick={onClose}>
          {state.status === 'failed' ? 'Close' : 'Done'}
        </Button>
      )}
    </Row>
  )
}

// ── A plain sign-in, for another account or one connecting again ────

function useGoogleSignIn(onDone: (email: string) => void) {
  const [waiting, setWaiting] = useState<{ id: string; url: string } | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  const stop = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current)
    timer.current = null
    setWaiting(null)
  }, [])

  useEffect(() => stop, [stop])

  const start = useCallback(
    async (email?: string) => {
      setWarn(null)
      // The tab opens on the click itself; after the round trip a browser may refuse to.
      const tab = window.open('', '_blank')
      const r = await postJson(`${API}/google/connect`, email ? { email } : {})
      const refusal = await refusalOf(r)
      if (refusal || !r) {
        tab?.close()
        setWarn(refusal ?? UNREACHABLE)
        return
      }
      const started = (await r.json()) as { id: string; url: string }
      if (tab) tab.location.href = started.url
      setWaiting(started)
      timer.current = window.setInterval(async () => {
        const res = await fetch(`${API}/google/connect/${started.id}`).catch(() => null)
        if (!res?.ok) return
        const state = (await res.json()) as ConnectState
        if (state.status === 'waiting') return
        stop()
        if (state.status === 'done') onDone(state.email)
        else setWarn(state.message)
      }, POLL_MS)
    },
    [onDone, stop],
  )

  return { waiting, warn, start, cancel: stop }
}

/** A client of your own, pasted — the developer's path. */
function ClientForm({ steps, onSaved, onCancel }: { steps: string[]; onSaved: () => void; onCancel: () => void }) {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [warn, setWarn] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    const refusal = await refusalOf(await postJson(`${API}/google/client`, { clientId, clientSecret }))
    setBusy(false)
    if (refusal) setWarn(refusal)
    else onSaved()
  }

  return (
    <div className="sky-set-form">
      <p className="sky-set-sub">Sky signs in to Google as an app of your own. Making one by hand, once:</p>
      <ol className="sky-set-steps">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="sky-set-form-grid">
        <TextInput
          size="sm"
          label="Client ID"
          value={clientId}
          onChange={(e) => setClientId(e.currentTarget.value)}
          placeholder="…apps.googleusercontent.com"
          classNames={{ input: 'sky-set-mono-input' }}
        />
        <PasswordInput
          size="sm"
          label="Client secret"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.currentTarget.value)}
        />
      </div>
      {warn && <p className="sky-set-warn">{warn}</p>}
      <div className="sky-set-form-foot">
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !clientId.trim() || !clientSecret.trim()}
          onClick={() => void save()}
        >
          Save to keychain
        </Button>
        <Button size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ── The page ────────────────────────────────────────────────────────

function AccountsBlock({
  data,
  reload,
  setup,
  signIn,
  starting,
  setStarting,
}: {
  data: ConnectionsData
  reload: () => void
  setup: ReturnType<typeof useGoogleSetup>
  signIn: ReturnType<typeof useGoogleSignIn>
  /** The start panel is open */
  starting: boolean
  setStarting: (open: boolean) => void
}) {
  const { google } = data
  const [hint, setHint] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const remove = async (email: string) => {
    setConfirming(null)
    const refusal = await refusalOf(
      await fetch(`${API}/secret/google/${encodeURIComponent(email)}`, { method: 'DELETE' }).catch(() => null),
    )
    setHint(refusal ?? `Removed ${email}. To revoke the grant itself: myaccount.google.com/permissions.`)
    reload()
  }

  const running = setup.run !== null
  const connected = google.accounts.length > 0

  return (
    <div className="sky-set-google">
      <Block head="Google account">
        {!connected && !running && !starting && (
          <Row label="Google" sub="Mail, Calendar, Drive and Docs." last>
            <span className="sky-set-off">Not connected</span>
          </Row>
        )}
        {google.accounts.map((account, index) => (
          <Fragment key={account.email}>
            <Row
              label={account.email}
              sub={
                <>
                  {account.grants.length > 0 && (
                    <span className="sky-set-chips">
                      {account.grants.map((grant) => (
                        <span key={grant} className="sky-set-chip">
                          {grant}
                        </span>
                      ))}
                    </span>
                  )}
                  {account.missing.length > 0 && (
                    <span className="sky-set-line sky-set-warn">
                      {account.missing.join(' and ')} {account.missing.length === 1 ? "wasn't" : "weren't"} ticked.
                      Connect again and tick every box.
                    </span>
                  )}
                  {account.setup && (
                    <span className="sky-set-line">
                      Set up by Sky on {dayLabel(account.setup.at)} in Google Cloud project {account.setup.projectId}.
                    </span>
                  )}
                </>
              }
              last={index === google.accounts.length - 1 && !running && !starting}
            >
              {account.missing.length > 0 ? (
                <Button size="compact-sm" variant="primary" onClick={() => void signIn.start(account.email)}>
                  Connect again
                </Button>
              ) : (
                <span className="sky-set-status">Connected</span>
              )}
              {confirming === account.email ? (
                <Button size="compact-sm" variant="danger" onClick={() => void remove(account.email)}>
                  Really remove
                </Button>
              ) : (
                <Button size="compact-sm" onClick={() => setConfirming(account.email)}>
                  Remove
                </Button>
              )}
            </Row>
          </Fragment>
        ))}

        {starting && !running && (
          <StartRow
            onStart={() => {
              setStarting(false)
              setHint(null)
              void setup.start()
            }}
            onCancel={() => setStarting(false)}
          />
        )}
        {setup.run && (
          <SetupRow
            state={setup.run.state}
            onContinue={() => void setup.continue()}
            onCancel={() => void setup.cancel()}
            onClose={setup.clear}
          />
        )}
        {!running && !starting && signIn.waiting && (
          <div className="sky-set-foot sky-set-wait">
            <span>
              Finish signing in, in the tab that opened.{' '}
              <a href={signIn.waiting.url} target="_blank" rel="noreferrer">
                Open the Google page
              </a>
            </span>
            <Button size="compact-sm" onClick={signIn.cancel}>
              Cancel
            </Button>
          </div>
        )}
        {!running && !starting && !signIn.waiting && (
          <div className="sky-set-foot">
            <Button size="sm" variant="primary" onClick={() => setStarting(true)}>
              {connected ? '＋ Add another account' : 'Connect Google'}
            </Button>
          </div>
        )}
        {(setup.warn || signIn.warn) && (
          <p className="sky-set-warn" role="alert">
            {setup.warn ?? signIn.warn}
          </p>
        )}
        {hint && (
          <p className="sky-set-note" role="status">
            {hint}
          </p>
        )}
      </Block>
    </div>
  )
}

function AdvancedBlock({
  data,
  reload,
  signIn,
  onTidy,
}: {
  data: ConnectionsData
  reload: () => void
  signIn: ReturnType<typeof useGoogleSignIn>
  onTidy: () => void
}) {
  const [clientForm, setClientForm] = useState(false)
  const leftovers = data.google.leftovers.length
  return (
    <Block head="Advanced">
      {leftovers > 0 && (
        <Row
          label="Leftovers from earlier tries"
          sub={`${leftovers} Google Cloud ${leftovers === 1 ? 'project' : 'projects'} Sky made that no account uses. Removing opens a window to sign in, then shuts them down.`}
        >
          <Button size="compact-sm" onClick={onTidy}>
            Remove
          </Button>
        </Row>
      )}
      <Row
        label="Your own client"
        sub="Paste a client ID and secret from a Google Cloud project you made yourself, then sign in with it. Replaces the shared pair."
        last={!clientForm}
      >
        <Button size="compact-sm" onClick={() => setClientForm((open) => !open)}>
          {clientForm ? 'Close' : 'Paste'}
        </Button>
      </Row>
      {clientForm && (
        <ClientForm
          steps={data.google.setup}
          onSaved={() => {
            setClientForm(false)
            reload()
            // The pasted pair signs in at once — the page has no other use for it.
            void signIn.start()
          }}
          onCancel={() => setClientForm(false)}
        />
      )}
    </Block>
  )
}

type AccountCategory = 'Professional' | 'Personal'

const CATEGORIES: Array<{ value: AccountCategory; label: string }> = [
  { value: 'Professional', label: 'Professional' },
  { value: 'Personal', label: 'Personal' },
]

/** Each account's side of the day: where the mail Sky saves from it is filed. */
function CategoryBlock({
  data,
  settings,
  onChanged,
}: {
  data: ConnectionsData
  settings: SettingsData | null
  onChanged: () => void
}) {
  // The choice being saved shows at once; the page's settings catch up when the file has it.
  const [saving, setSaving] = useState<{ email: string; category: AccountCategory } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const accounts = data.google.accounts
  if (accounts.length === 0) return null
  const chosen = (email: string): AccountCategory =>
    saving?.email === email
      ? saving.category
      : (settings?.google?.accountCategories[email.toLowerCase()] ?? 'Professional')
  const save = async (email: string, category: AccountCategory) => {
    setSaving({ email, category })
    setError(null)
    const refusal = await refusalOf(await postJson('/settings/_api/google/category', { email, category }))
    if (refusal) setError(refusal)
    else await onChanged()
    setSaving(null)
  }
  return (
    <div className="sky-set-google">
      <Block
        head="Professional or personal"
        note="Mail Sky saves from an account is filed under this side of your day."
      >
        {accounts.map((account, index) => (
          <Fragment key={account.email}>
            <Row label={account.email} last={index === accounts.length - 1}>
              <SegmentedControl
                aria-label={`Side of the day for ${account.email}`}
                value={chosen(account.email)}
                disabled={!settings || saving !== null}
                onChange={(value) => void save(account.email, value as AccountCategory)}
                data={CATEGORIES}
              />
            </Row>
          </Fragment>
        ))}
        {error && (
          <p className="sky-set-warn" role="alert">
            {error}
          </p>
        )}
      </Block>
    </div>
  )
}

function CalendarBlock({ settings, onChanged }: { settings: SettingsData | null; onChanged: () => void }) {
  const { status, warn } = useTypeSafe()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const enabled = settings?.calendar?.classifyEvents === true
  const ready = status?.connected && !status.refused && !status.error
  const save = async (on: boolean) => {
    setBusy(true)
    setError(null)
    const refusal = await saveSetting('calendar.classifyEvents', String(on))
    if (refusal) setError(refusal)
    else await onChanged()
    setBusy(false)
  }
  return (
    <Block head="Calendar">
      <Row
        label="Hide family notifications and reminders"
        sub={
          <>
            Automatically identify family notifications and reminders and hide them from the day sidebar. Turn off to
            show them again.
            {!ready && (
              <span className="sky-set-line">
                {status || warn ? (
                  <>
                    Needs a working TypeSafe API key. <a href="/settings/connections">Set up TypeSafe</a>.
                  </>
                ) : (
                  'Checking the TypeSafe connection…'
                )}
              </span>
            )}
          </>
        }
        last
      >
        <Switch
          aria-label="Hide family notifications and reminders"
          checked={enabled}
          disabled={busy || !settings || (!enabled && !ready)}
          onChange={(event) => void save(event.currentTarget.checked)}
        />
      </Row>
      {error && (
        <p className="sky-set-warn" role="alert">
          {error}
        </p>
      )}
    </Block>
  )
}

export function GoogleMain({
  navigate,
  settings,
  onSettingsChanged,
}: {
  navigate: (to: string) => void
  settings: SettingsData | null
  onSettingsChanged: () => void
}) {
  const { data, note, reload } = useConnections()
  const [hint, setHint] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const done = useCallback(
    (email: string) => {
      setHint(`Connected ${email}.`)
      reload()
    },
    [reload],
  )
  const setup = useGoogleSetup(done)
  const signIn = useGoogleSignIn(done)
  return (
    <ConnectionPage
      name="Google"
      gives="Mail, Calendar, Drive and Docs: Sky reads what arrives, keeps your meetings in the day, and works in your documents."
      navigate={navigate}
    >
      {note && (
        <p className="sky-set-warn" role="alert">
          {note}
        </p>
      )}
      {hint && (
        <p className="sky-set-success" role="status">
          {hint}
        </p>
      )}
      {data && (
        <AccountsBlock
          data={data}
          reload={reload}
          setup={setup}
          signIn={signIn}
          starting={starting}
          setStarting={setStarting}
        />
      )}
      {data && <CategoryBlock data={data} settings={settings} onChanged={onSettingsChanged} />}
      <CalendarBlock settings={settings} onChanged={onSettingsChanged} />
      {data && (
        <AdvancedBlock
          data={data}
          reload={reload}
          signIn={signIn}
          onTidy={() => {
            setHint(null)
            void setup.start('tidy')
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        />
      )}
    </ConnectionPage>
  )
}
