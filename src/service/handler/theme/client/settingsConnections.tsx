/**
 * Connections — the accounts and keys Sky signs in with, as a page.
 *
 * The page sees presence only: which keychain entries exist, and for whom.
 * A value goes in through a form and never comes back out — a key shows its
 * last four characters, so two keys can be told apart. A Google account
 * signs in here the way `sky google:auth` does in the terminal: the consent
 * page opens in a tab, and Sky's service receives the redirect on this
 * machine. Slack is agent-slack's: its test is shown, a re-import offered.
 */

import { Button, PasswordInput, SegmentedControl, TextInput } from '@mantine/core'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { SECRET_FIELDS, secretFieldError, type SecretField } from '../../settings/secretValidation.ts'
import { Block, mono, refusalOf, Row, UNREACHABLE } from './settingsBlocks.tsx'

// ── What the service answers (mirrors handler/settings/connections.ts) ──

interface GoogleAccountRow {
  email: string
  grants: string[]
}

interface SecretRow {
  category: string
  name: string
  type: 'login' | 'secret'
  label: string
  sub: string
  tail?: string
}

export interface ConnectionsData {
  google: { client: boolean; accounts: GoogleAccountRow[]; setup: string[] }
  secrets: SecretRow[]
}

type SlackStatus =
  | { installed: false }
  | { installed: true; ok: true; workspace: string | null; team: string | null; user: string | null }
  | { installed: true; ok: false; error: string }

type ConnectState = { status: 'waiting' } | { status: 'done'; email: string } | { status: 'failed'; message: string }

const API = '/settings/_api/connections'

/** The sign-in is asked after this often while the tab is open. */
const SIGN_IN_POLL_MS = 1500

// ── Talking to the service ──────────────────────────────────────────

function postJson(url: string, body: unknown): Promise<Response | null> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null)
}

/** One keychain entry, gone. Resolves to null, or to what went wrong. */
function removeSecret(category: string, name: string): Promise<string | null> {
  return fetch(`${API}/secret/${encodeURIComponent(category)}/${encodeURIComponent(name)}`, { method: 'DELETE' })
    .catch(() => null)
    .then(refusalOf)
}

function useConnections() {
  const [data, setData] = useState<ConnectionsData | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const reload = useCallback(() => {
    fetch(API)
      .then(async (r) => {
        if (r.ok) {
          setData((await r.json()) as ConnectionsData)
          setNote(null)
        } else {
          setNote(await refusalOf(r))
        }
      })
      .catch(() => setNote(UNREACHABLE))
  }, [])

  useEffect(reload, [reload])

  return { data, note, reload }
}

// ── Slack: agent-slack's test, and a re-import when it fails ────────

function useSlack() {
  const [status, setStatus] = useState<SlackStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [warn, setWarn] = useState<string | null>(null)

  const ask = useCallback((how: 'status' | 'reconnect') => {
    setBusy(true)
    setWarn(null)
    const answer = how === 'status' ? fetch(`${API}/slack`).catch(() => null) : postJson(`${API}/slack/reconnect`, {})
    void answer
      .then(async (r) => {
        if (r?.ok) setStatus((await r.json()) as SlackStatus)
        else setWarn(await refusalOf(r))
      })
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => ask('status'), [ask])

  return { status, busy, warn, check: () => ask('status'), reconnect: () => ask('reconnect') }
}

function SlackRow() {
  const { status, busy, warn, check, reconnect } = useSlack()
  const sub = !status
    ? 'Checking…'
    : !status.installed
      ? 'Sky talks to Slack through agent-slack, which this Mac does not have.'
      : status.ok
        ? [status.team, status.workspace?.replace(/^https?:\/\//, '').replace(/\/$/, '')].filter(Boolean).join(' · ') ||
          'Connected'
        : 'Sign in to Slack in Brave, then reconnect.'
  const trouble = warn ?? (status?.installed && !status.ok ? status.error : null)

  return (
    <>
      <Row label="Slack" sub={sub}>
        {status?.installed && status.ok && <span className="sky-set-status">Connected</span>}
        {status?.installed && !status.ok && <span className="sky-set-off">Not connected</span>}
        {status?.installed &&
          (status.ok ? (
            <Button size="compact-sm" disabled={busy} onClick={check}>
              {busy ? 'Checking…' : 'Check'}
            </Button>
          ) : (
            <Button size="compact-sm" variant="light" color="blue" disabled={busy} onClick={reconnect}>
              {busy ? 'Reconnecting…' : 'Reconnect'}
            </Button>
          ))}
      </Row>
      {trouble && <p className="sky-set-warn">{trouble}</p>}
    </>
  )
}

// ── Google: the sign-in, run from here ──────────────────────────────

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

  const start = useCallback(async () => {
    setWarn(null)
    // The tab opens on the click itself; after the round trip a browser may refuse to.
    const tab = window.open('', '_blank')
    const r = await postJson(`${API}/google/connect`, {})
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
    }, SIGN_IN_POLL_MS)
  }, [onDone, stop])

  return { waiting, warn, start, cancel: stop }
}

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
      <p className="sky-set-sub">
        Sky signs in to Google as an app of your own. Making one takes about ten minutes, once:
      </p>
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
          variant="light"
          color="blue"
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

function AccountsBlock({ data, reload }: { data: ConnectionsData; reload: () => void }) {
  const { google } = data
  const [hint, setHint] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  /** `add` saves the client, then signs in; `change` only saves */
  const [clientForm, setClientForm] = useState<'add' | 'change' | null>(null)
  const signIn = useGoogleSignIn(
    useCallback(
      (email: string) => {
        setHint(`Connected ${email}.`)
        reload()
      },
      [reload],
    ),
  )

  const add = () => {
    setHint(null)
    if (google.client) void signIn.start()
    else setClientForm('add')
  }

  const remove = async (email: string) => {
    setConfirming(null)
    const refusal = await removeSecret('google', email)
    setHint(refusal ?? `Removed ${email}. To revoke the grant itself: myaccount.google.com/permissions.`)
    reload()
  }

  const clientSaved = () => {
    const then = clientForm
    setClientForm(null)
    reload()
    if (then === 'add') void signIn.start()
  }

  return (
    <Block head="Accounts">
      <SlackRow />
      {google.accounts.length === 0 && (
        <Row label="Google" sub="Mail, Calendar, Drive and Docs.">
          <span className="sky-set-off">Not connected</span>
        </Row>
      )}
      {google.accounts.map((account) => (
        <Fragment key={account.email}>
          <Row
            label="Google"
            sub={
              <>
                {account.email}
                {account.grants.length > 0 && (
                  <span className="sky-set-chips">
                    {account.grants.map((grant) => (
                      <span key={grant} className="sky-set-chip">
                        {grant}
                      </span>
                    ))}
                  </span>
                )}
              </>
            }
          >
            <span className="sky-set-status">Connected</span>
            {confirming === account.email ? (
              <Button size="compact-sm" color="red" variant="light" onClick={() => void remove(account.email)}>
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
      <Row label="Google Cloud client" sub="The app Sky signs in as. Set once." last>
        {google.client ? <span className="sky-set-status">Set</span> : <span className="sky-set-off">Not set</span>}
        <Button size="compact-sm" onClick={() => setClientForm(clientForm ? null : 'change')}>
          {google.client ? 'Change' : 'Add'}
        </Button>
      </Row>
      {clientForm && <ClientForm steps={google.setup} onSaved={clientSaved} onCancel={() => setClientForm(null)} />}
      {signIn.waiting ? (
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
      ) : (
        <div className="sky-set-foot">
          <Button size="sm" variant="light" color="blue" onClick={add}>
            ＋ Add Google account
          </Button>
        </div>
      )}
      {signIn.warn && <p className="sky-set-warn">{signIn.warn}</p>}
      {hint && <p className="sky-set-note">{hint}</p>}
    </Block>
  )
}

// ── A keychain entry, written ───────────────────────────────────────

function SecretForm({
  category,
  name,
  type,
  valueLabel,
  onDone,
  onCancel,
}: {
  /** With `name`, the entry is fixed — the form only takes its value */
  category?: string
  name?: string
  /** Fixed, the form offers no choice of type */
  type?: 'secret' | 'login'
  valueLabel?: string
  onDone: () => void
  onCancel: () => void
}) {
  const fixed = Boolean(category && name)
  const [cat, setCat] = useState(category ?? '')
  const [which, setWhich] = useState(name ?? '')
  const [kind, setKind] = useState<'secret' | 'login'>(type ?? 'secret')
  const [value, setValue] = useState('')
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [warn, setWarn] = useState<string | null>(null)
  const [invalid, setInvalid] = useState<{ field: SecretField; message: string } | null>(null)
  const [touched, setTouched] = useState<Partial<Record<SecretField, boolean>>>({})
  const [busy, setBusy] = useState(false)
  const form = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (invalid) form.current?.querySelector<HTMLInputElement>(`input[name="${invalid.field}"]`)?.focus()
  }, [invalid])

  const values = { category: cat, name: which, value, user, pass }
  const active: SecretField[] = [
    ...(fixed ? [] : (['category', 'name'] as const)),
    ...(kind === 'secret' ? (['value'] as const) : (['user', 'pass'] as const)),
  ]
  const firstInvalid = active.find((field) => secretFieldError(field, values[field]))
  const touch = (field: SecretField) => setTouched((current) => ({ ...current, [field]: true }))
  const fieldProps = (field: SecretField) => {
    const error =
      (touched[field] ? secretFieldError(field, values[field]) : null) ??
      (invalid?.field === field ? invalid.message : undefined)
    return {
      name: field,
      error,
      'aria-invalid': Boolean(error) || undefined,
      disabled: busy,
      onBlur: () => touch(field),
    }
  }
  const edited = (field: SecretField) => {
    touch(field)
    setInvalid((current) => (current?.field === field ? null : current))
    setWarn(null)
  }

  const ready = firstInvalid === undefined

  const save = async () => {
    if (busy) return
    if (firstInvalid) {
      touch(firstInvalid)
      form.current?.querySelector<HTMLInputElement>(`input[name="${firstInvalid}"]`)?.focus()
      return
    }
    setBusy(true)
    setWarn(null)
    setInvalid(null)
    const target = { category: cat, ...(which.trim() ? { name: which } : {}) }
    const body = kind === 'secret' ? { ...target, type: kind, value } : { ...target, type: kind, user, pass }
    const response = await postJson(`${API}/secret`, body)
    const detail =
      response?.status === 400
        ? ((await response
            .clone()
            .json()
            .catch(() => null)) as { field?: unknown } | null)
        : null
    const refusal = await refusalOf(response)
    setBusy(false)
    if (refusal) {
      const field = SECRET_FIELDS.find((field) => field === detail?.field)
      if (field && !(fixed && (field === 'category' || field === 'name'))) setInvalid({ field, message: refusal })
      else setWarn(refusal)
    } else onDone()
  }

  return (
    <div className="sky-set-form" ref={form}>
      {!fixed && (
        <div className="sky-set-form-grid">
          <TextInput
            {...fieldProps('category')}
            size="sm"
            label="What it is for"
            value={cat}
            onChange={(e) => {
              setCat(e.currentTarget.value)
              edited('category')
            }}
            placeholder="cerebras, notion, email…"
            classNames={{ input: 'sky-set-mono-input' }}
          />
          <TextInput
            {...fieldProps('name')}
            size="sm"
            label="Which one (optional)"
            value={which}
            onChange={(e) => {
              setWhich(e.currentTarget.value)
              edited('name')
            }}
            placeholder="personal, work — or leave blank"
            classNames={{ input: 'sky-set-mono-input' }}
          />
        </div>
      )}
      {!type && (
        <SegmentedControl
          size="xs"
          disabled={busy}
          value={kind}
          onChange={(v) => {
            setKind(v as 'secret' | 'login')
            setInvalid((current) => (current?.field === 'category' || current?.field === 'name' ? current : null))
            setWarn(null)
          }}
          data={[
            { value: 'secret', label: 'Key or token' },
            { value: 'login', label: 'Login' },
          ]}
        />
      )}
      {kind === 'secret' ? (
        <PasswordInput
          {...fieldProps('value')}
          size="sm"
          label={valueLabel ?? 'Value'}
          value={value}
          onChange={(e) => {
            setValue(e.currentTarget.value)
            edited('value')
          }}
          placeholder="Paste it here"
        />
      ) : (
        <div className="sky-set-form-grid">
          <TextInput
            {...fieldProps('user')}
            size="sm"
            label="Username"
            value={user}
            onChange={(e) => {
              setUser(e.currentTarget.value)
              edited('user')
            }}
          />
          <PasswordInput
            {...fieldProps('pass')}
            size="sm"
            label="Password"
            value={pass}
            onChange={(e) => {
              setPass(e.currentTarget.value)
              edited('pass')
            }}
          />
        </div>
      )}
      {warn && (
        <p className="sky-set-warn" role="alert">
          {warn}
        </p>
      )}
      <div className="sky-set-form-foot">
        <Button size="sm" variant="light" color="blue" disabled={busy || !ready} onClick={() => void save()}>
          Save to keychain
        </Button>
        <Button size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ── The keychain: every entry, by name ──────────────────────────────

function KeychainBlock({ secrets, reload }: { secrets: SecretRow[]; reload: () => void }) {
  const [editing, setEditing] = useState<'new' | string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)

  const done = () => {
    setEditing(null)
    reload()
  }
  const remove = async (row: SecretRow) => {
    setConfirming(null)
    setWarn(await removeSecret(row.category, row.name))
    reload()
  }

  return (
    <Block
      head="Keychain"
      note="Everything Sky keeps in your keychain, apart from the Google entries above. Values stay there; a key shows its last four characters so you can tell which one it is."
    >
      {secrets.length === 0 && editing !== 'new' && <p className="sky-set-sub">Nothing here yet.</p>}
      {secrets.map((row, index) => {
        const id = `${row.category}/${row.name}`
        const open = editing === id
        return (
          <Fragment key={id}>
            <Row label={row.label} sub={row.sub || undefined} last={index === secrets.length - 1 && !open}>
              {row.tail && mono(`•••• ${row.tail}`)}
              <Button size="compact-sm" onClick={() => setEditing(open ? null : id)}>
                Change
              </Button>
              {confirming === id ? (
                <Button size="compact-sm" color="red" variant="light" onClick={() => void remove(row)}>
                  Really remove
                </Button>
              ) : (
                <Button size="compact-sm" onClick={() => setConfirming(id)}>
                  Remove
                </Button>
              )}
            </Row>
            {open && (
              <SecretForm
                category={row.category}
                name={row.name}
                type={row.type}
                valueLabel={row.type === 'secret' ? row.label : undefined}
                onDone={done}
                onCancel={() => setEditing(null)}
              />
            )}
          </Fragment>
        )
      })}
      {editing === 'new' ? (
        <SecretForm onDone={done} onCancel={() => setEditing(null)} />
      ) : (
        <div className="sky-set-foot">
          <Button size="sm" variant="light" color="blue" onClick={() => setEditing('new')}>
            ＋ Add to keychain
          </Button>
        </div>
      )}
      {warn && <p className="sky-set-warn">{warn}</p>}
    </Block>
  )
}

// ── The pane ────────────────────────────────────────────────────────

export function ConnectionsPane() {
  const { data, note, reload } = useConnections()
  return (
    <>
      {note && <div className="sky-condensed">— {note} —</div>}
      {data && (
        <>
          <AccountsBlock data={data} reload={reload} />
          <KeychainBlock secrets={data.secrets} reload={reload} />
        </>
      )}
    </>
  )
}
