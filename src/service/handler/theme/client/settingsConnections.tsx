/**
 * Connections — the accounts and keys Sky signs in with, as a page.
 *
 * The page sees presence only: which keychain entries exist, and for whom.
 * A value goes in through a form and never comes back out — a key shows its
 * last four characters, so two keys can be told apart. A Google account
 * signs in here the way `sky google:auth` does in the terminal: the consent
 * page opens in a tab, and Sky's service receives the redirect on this
 * machine. Slack is agent-slack's: its test is shown, a re-import offered.
 * Beeper Desktop approves Sky on its own page, opened from here. TypeSafe's
 * key is checked with TypeSafe before it goes in, and the row says whether
 * TypeSafe still takes it.
 */

import { Button, PasswordInput, SegmentedControl, TextInput } from '@mantine/core'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { SECRET_FIELDS, secretFieldError, type SecretField } from '../../settings/secretValidation.ts'
import { Block, mono, refusalOf, Row, UNREACHABLE } from './settingsBlocks.tsx'
import { connectionHref } from './settingsRoutes.ts'

// ── What the service answers (mirrors handler/settings/connections.ts) ──

interface GoogleAccountRow {
  email: string
  grants: string[]
  /** What it should cover but does not — a box left unticked */
  missing: string[]
  /** Set when Sky made the Google Cloud side itself */
  setup?: { projectId: string; at: string }
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
  accessError?: string
  google: { client: boolean; accounts: GoogleAccountRow[]; leftovers: string[]; setup: string[] }
  secrets: SecretRow[]
}

type SlackStatus =
  | { installed: false }
  | {
      installed: true
      ok: true
      workspace: string | null
      team: string | null
      user: string | null
      displayName?: string | null
    }
  | { installed: true; ok: false; error: string }

type ConnectState = { status: 'waiting' } | { status: 'done'; email: string } | { status: 'failed'; message: string }

type BeeperStatus = {
  running: boolean
  version?: string
  connected: boolean
  expired?: boolean
  expiresAt?: string
  accounts: { network: string; status: string }[]
  error?: string
}

type BeeperConnectState =
  | { status: 'waiting' }
  | { status: 'done'; expiresAt?: string }
  | { status: 'failed'; message: string }

type TypeSafeStatus = {
  connected: boolean
  tail?: string
  models: string[]
  refused?: boolean
  error?: string
}

export const API = '/settings/_api/connections'

/** The sign-in is asked after this often while the tab is open. */
const SIGN_IN_POLL_MS = 1500

// ── Talking to the service ──────────────────────────────────────────

export function postJson(url: string, body: unknown): Promise<Response | null> {
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

export function useConnections() {
  const [data, setData] = useState<ConnectionsData | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const r = await fetch(API)
      if (r.ok) {
        const next = (await r.json()) as ConnectionsData
        setData(next)
        setNote(null)
        return next
      }
      setNote(await refusalOf(r))
    } catch {
      setNote(UNREACHABLE)
    }
    return null
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, note, reload }
}

// ── Slack: agent-slack's test, and a re-import when it fails ────────

function useSlack() {
  const [status, setStatus] = useState<SlackStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [warn, setWarn] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const ask = useCallback((how: 'status' | 'check' | 'reconnect') => {
    setBusy(true)
    setWarn(null)
    setHint(null)
    const answer =
      how === 'reconnect' ? postJson(`${API}/slack/reconnect`, {}) : fetch(`${API}/slack`).catch(() => null)
    void answer
      .then(async (r) => {
        if (!r?.ok) {
          setWarn(await refusalOf(r))
          return
        }
        const next = (await r.json()) as SlackStatus
        setStatus(next)
        if (how !== 'status' && next.installed && next.ok) {
          const name = next.displayName?.trim()
          setHint(
            name
              ? `Connection successful. Signed in as ${name}.`
              : 'Connection successful. Your Slack profile name could not be retrieved.',
          )
        }
      })
      .catch(() => setWarn("Couldn't check the Slack connection. Please try again."))
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => ask('status'), [ask])

  return { status, busy, warn, hint, check: () => ask('check'), reconnect: () => ask('reconnect') }
}

function SlackRow() {
  const { status, busy, warn, hint, check, reconnect } = useSlack()
  const sub = !status
    ? warn
      ? 'Try checking the connection again.'
      : 'Checking…'
    : !status.installed
      ? 'Sky talks to Slack through agent-slack, which this Mac does not have.'
      : status.ok
        ? [status.team, status.workspace?.replace(/^https?:\/\//, '').replace(/\/$/, '')].filter(Boolean).join(' · ') ||
          'Connected'
        : 'Sign in to Slack in Brave, then reconnect.'
  const trouble = warn ?? (status?.installed && !status.ok ? `Connection failed. ${status.error}` : null)

  return (
    <Row
      label="Slack"
      sub={
        <>
          {sub}
          <div role="status" aria-atomic="true">
            {hint && <p className="sky-set-success">{hint}</p>}
          </div>
          {trouble && (
            <p className="sky-set-warn" role="alert">
              {trouble}
            </p>
          )}
        </>
      }
    >
      {warn ? (
        <span className="sky-set-off">Check failed</span>
      ) : status?.installed ? (
        status.ok ? (
          <span className="sky-set-status">Connected</span>
        ) : (
          <span className="sky-set-off">Not connected</span>
        )
      ) : null}
      {status?.installed !== false &&
        (status?.installed && !status.ok ? (
          <Button size="compact-sm" variant="primary" disabled={busy} onClick={reconnect}>
            {busy ? 'Reconnecting…' : 'Reconnect'}
          </Button>
        ) : (
          <Button size="compact-sm" disabled={busy} onClick={check}>
            {busy ? 'Checking…' : 'Check'}
          </Button>
        ))}
    </Row>
  )
}

// ── Beeper: the chats on this Mac, through Beeper Desktop ───────────

const BEEPER_CONNECTED = 'Connected. Sky saves new messages every five minutes.'

function useBeeper() {
  const [status, setStatus] = useState<BeeperStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [warn, setWarn] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  const stop = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current)
    timer.current = null
  }, [])
  useEffect(() => stop, [stop])

  const reload = useCallback(async () => {
    const r = await fetch(`${API}/beeper`).catch(() => null)
    if (!r?.ok) {
      setWarn(await refusalOf(r))
      return
    }
    setStatus((await r.json()) as BeeperStatus)
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  const connect = useCallback(async () => {
    setWarn(null)
    setHint(null)
    setBusy(true)
    // The tab opens on the click itself; after the round trip a browser may refuse to.
    const tab = window.open('', '_blank')
    const r = await postJson(`${API}/beeper/connect`, {})
    const refusal = await refusalOf(r)
    if (refusal || !r) {
      tab?.close()
      setWarn(refusal ?? UNREACHABLE)
      setBusy(false)
      return
    }
    const started = (await r.json()) as { id: string; url: string }
    if (tab) tab.location.href = started.url
    timer.current = window.setInterval(async () => {
      const res = await fetch(`${API}/beeper/connect/${started.id}`).catch(() => null)
      if (!res?.ok) return
      const state = (await res.json()) as BeeperConnectState
      if (state.status === 'waiting') return
      stop()
      setBusy(false)
      if (state.status === 'done') {
        setHint(BEEPER_CONNECTED)
        void reload()
      } else setWarn(state.message)
    }, SIGN_IN_POLL_MS)
  }, [reload, stop])

  const saveToken = useCallback(
    async (token: string) => {
      setWarn(null)
      setHint(null)
      setBusy(true)
      const refusal = await refusalOf(await postJson(`${API}/beeper/token`, { token }))
      setBusy(false)
      if (refusal) {
        setWarn(refusal)
        return false
      }
      setHint(BEEPER_CONNECTED)
      void reload()
      return true
    },
    [reload],
  )

  const disconnect = useCallback(async () => {
    setWarn(null)
    setHint(null)
    setBusy(true)
    const refusal = await refusalOf(await fetch(`${API}/beeper`, { method: 'DELETE' }).catch(() => null))
    setBusy(false)
    if (refusal) setWarn(refusal)
    else {
      setHint('Disconnected. Beeper still lists Sky under Settings → Integrations.')
      void reload()
    }
  }, [reload])

  return { status, busy, warn, hint, connect, saveToken, disconnect }
}

function BeeperRow() {
  const { status, busy, warn, hint, connect, saveToken, disconnect } = useBeeper()
  const [tokenForm, setTokenForm] = useState(false)
  const [token, setToken] = useState('')
  const networks = [...new Set(status?.accounts.map((account) => account.network) ?? [])]
  const live = Boolean(status?.connected && !status?.expired)
  const sub = !status
    ? warn
      ? 'Try again in a moment.'
      : 'Checking…'
    : status.expired
      ? 'The connection ran out. Connect again to keep saving messages.'
      : status.connected
        ? networks.length
          ? networks.join(' · ')
          : status.running
            ? 'Connected. Beeper has no chat accounts yet.'
            : 'Connected. Open Beeper Desktop to keep saving messages.'
        : status.running
          ? 'WhatsApp, iMessage, Signal and the other chats Beeper Desktop carries, saved as messages.'
          : 'Beeper Desktop is not running on this Mac. Open it to connect.'
  const trouble = warn ?? status?.error ?? null

  return (
    <>
      <Row
        label="Beeper"
        sub={
          <>
            {sub}
            <div role="status" aria-atomic="true">
              {hint && <p className="sky-set-success">{hint}</p>}
            </div>
            {trouble && (
              <p className="sky-set-warn" role="alert">
                {trouble}
              </p>
            )}
          </>
        }
      >
        {status &&
          (live ? (
            <span className="sky-set-status">Connected</span>
          ) : (
            <span className="sky-set-off">Not connected</span>
          ))}
        {status && live && (
          <Button size="compact-sm" disabled={busy} onClick={() => void disconnect()}>
            Disconnect
          </Button>
        )}
        {status && !live && status.running && (
          <Button size="compact-sm" variant="primary" disabled={busy} onClick={() => void connect()}>
            {busy ? 'Waiting for Beeper…' : status.expired ? 'Connect again' : 'Connect'}
          </Button>
        )}
        {status && !live && !tokenForm && (
          <Button size="compact-sm" disabled={busy} onClick={() => setTokenForm(true)}>
            Use a token
          </Button>
        )}
      </Row>
      {tokenForm && (
        <div className="sky-set-form">
          <p className="sky-set-sub">
            In Beeper Desktop, open Settings → Integrations, press + beside Approved connections, and paste the token it
            makes here.
          </p>
          <div className="sky-set-form-grid">
            <PasswordInput size="sm" label="Token" value={token} onChange={(e) => setToken(e.currentTarget.value)} />
          </div>
          <div className="sky-set-form-foot">
            <Button
              size="sm"
              variant="primary"
              disabled={busy || !token.trim()}
              onClick={() =>
                void saveToken(token.trim()).then((ok) => {
                  if (ok) {
                    setToken('')
                    setTokenForm(false)
                  }
                })
              }
            >
              Save to keychain
            </Button>
            <Button size="sm" disabled={busy} onClick={() => setTokenForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

// ── Google: the rows lead to Google's own page ──────────────────────

function AccountsBlock({ data, navigate }: { data: ConnectionsData; navigate: (to: string) => void }) {
  const { google } = data
  const toGoogle = () => navigate(connectionHref('google'))
  return (
    <Block head="Accounts">
      <SlackRow />
      <BeeperRow />
      {google.accounts.length === 0 && (
        <Row label="Google" sub="Mail, Calendar, Drive and Docs. Sign in, tick the boxes — Sky sets up the rest." last>
          <span className="sky-set-off">Not connected</span>
          <Button size="compact-sm" variant="primary" onClick={toGoogle}>
            Connect
          </Button>
        </Row>
      )}
      {google.accounts.map((account, index) => (
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
                {account.missing.length > 0 && (
                  <span className="sky-set-line sky-set-warn">
                    {account.missing.join(' and ')} not ticked — connect again.
                  </span>
                )}
              </>
            }
            last={index === google.accounts.length - 1}
          >
            <span className="sky-set-status">Connected</span>
            <Button size="compact-sm" aria-label="Google settings" onClick={toGoogle}>
              ›
            </Button>
          </Row>
        </Fragment>
      ))}
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
        <Button size="sm" variant="primary" disabled={busy || !ready} onClick={() => void save()}>
          Save to keychain
        </Button>
        <Button size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ── TypeSafe: the key for Jev, checked with TypeSafe ────────────────

export function useTypeSafe() {
  const [status, setStatus] = useState<TypeSafeStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [warn, setWarn] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const r = await fetch(`${API}/typesafe`).catch(() => null)
    if (!r?.ok) {
      setWarn(await refusalOf(r))
      return
    }
    setStatus((await r.json()) as TypeSafeStatus)
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  const saveKey = useCallback(
    async (key: string) => {
      setWarn(null)
      setHint(null)
      setBusy(true)
      const refusal = await refusalOf(await postJson(`${API}/typesafe/key`, { key }))
      setBusy(false)
      if (refusal) {
        setWarn(refusal)
        return false
      }
      setHint('Saved. TypeSafe accepts the key.')
      void reload()
      return true
    },
    [reload],
  )

  const remove = useCallback(async () => {
    setWarn(null)
    setHint(null)
    setBusy(true)
    const refusal = await refusalOf(await fetch(`${API}/typesafe`, { method: 'DELETE' }).catch(() => null))
    setBusy(false)
    if (refusal) setWarn(refusal)
    else {
      setHint('Removed from the keychain.')
      void reload()
    }
  }, [reload])

  return { status, busy, warn, hint, saveKey, remove }
}

function TypeSafeRow({ last }: { last: boolean }) {
  const { status, busy, warn, hint, saveKey, remove } = useTypeSafe()
  const [form, setForm] = useState(false)
  const [key, setKey] = useState('')
  const [confirming, setConfirming] = useState(false)
  const close = () => {
    setForm(false)
    setKey('')
  }
  const sub = !status
    ? warn
      ? 'Try again in a moment.'
      : 'Checking…'
    : !status.connected
      ? 'For Jev, TypeSafe’s decision model. Keys are made at console.typesafe.ai.'
      : status.refused
        ? 'TypeSafe no longer accepts this key. Save a new one.'
        : status.models.length
          ? `Models: ${status.models.join(', ')}`
          : 'Stored.'
  const trouble = warn ?? (status?.error && !status.refused ? status.error : null)

  return (
    <>
      <Row
        label="TypeSafe API key"
        sub={
          <>
            {sub}
            <div role="status" aria-atomic="true">
              {hint && <p className="sky-set-success">{hint}</p>}
            </div>
            {trouble && (
              <p className="sky-set-warn" role="alert">
                {trouble}
              </p>
            )}
          </>
        }
        last={last && !form}
      >
        {status?.tail && mono(`•••• ${status.tail}`)}
        {status &&
          (!status.connected ? (
            <span className="sky-set-off">Not set</span>
          ) : status.refused ? (
            <span className="sky-set-off">Refused</span>
          ) : (
            <span className="sky-set-status">Connected</span>
          ))}
        {status && (
          <Button size="compact-sm" disabled={busy} onClick={() => (form ? close() : setForm(true))}>
            {status.connected ? 'Change' : 'Add'}
          </Button>
        )}
        {status?.connected &&
          (confirming ? (
            <Button
              size="compact-sm"
              variant="danger"
              disabled={busy}
              onClick={() => {
                setConfirming(false)
                void remove()
              }}
            >
              Really remove
            </Button>
          ) : (
            <Button size="compact-sm" disabled={busy} onClick={() => setConfirming(true)}>
              Remove
            </Button>
          ))}
      </Row>
      {form && (
        <div className="sky-set-form">
          <p className="sky-set-sub">
            In the TypeSafe console, open Settings → API keys, make a key, and paste it here. Sky asks TypeSafe to
            confirm it before it goes in your keychain.
          </p>
          <div className="sky-set-form-grid">
            <PasswordInput size="sm" label="API key" value={key} onChange={(e) => setKey(e.currentTarget.value)} />
          </div>
          <div className="sky-set-form-foot">
            <Button
              size="sm"
              variant="primary"
              disabled={busy || !key.trim()}
              onClick={() =>
                void saveKey(key.trim()).then((ok) => {
                  if (ok) close()
                })
              }
            >
              {busy ? 'Checking with TypeSafe…' : 'Save to keychain'}
            </Button>
            <Button size="sm" disabled={busy} onClick={close}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </>
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
      <TypeSafeRow last={secrets.length === 0 && editing !== 'new'} />
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
                <Button size="compact-sm" variant="danger" onClick={() => void remove(row)}>
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
          <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
            ＋ Add to keychain
          </Button>
        </div>
      )}
      {warn && <p className="sky-set-warn">{warn}</p>}
    </Block>
  )
}

// ── The pane ────────────────────────────────────────────────────────

export function ConnectionsPane({ navigate }: { navigate: (to: string) => void }) {
  const { data, note, reload } = useConnections()
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [restoreNote, setRestoreNote] = useState<string | null>(null)
  const restore = async () => {
    if (restoring) return
    setRestoring(true)
    setRestoreError(null)
    setRestoreNote(null)
    try {
      const response = await postJson(`${API}/restore`, {})
      const refusal = await refusalOf(response)
      if (refusal) setRestoreError(refusal)
      const refreshed = await reload()
      if (!refusal && refreshed && !refreshed.accessError) setRestoreNote('Keychain access restored.')
    } finally {
      setRestoring(false)
    }
  }
  return (
    <>
      {note && <div className="sky-condensed">— {note} —</div>}
      {data && (
        <Block
          head="Keychain access"
          note="Background checks stay quiet. Restore access here if macOS needs your approval."
        >
          {!restoring && (restoreError || data.accessError) && (
            <p className="sky-set-warn" role="alert">
              {restoreError ?? data.accessError}
            </p>
          )}
          <Button size="sm" variant="secondary" loading={restoring} onClick={() => void restore()}>
            Restore access
          </Button>
          {restoring && <p role="status">Restoring access… Approve any macOS Keychain prompts.</p>}
          {!restoring && restoreNote && <p role="status">{restoreNote}</p>}
        </Block>
      )}
      {data && (
        <>
          <AccountsBlock data={data} navigate={navigate} />
          <KeychainBlock secrets={data.secrets} reload={reload} />
        </>
      )}
    </>
  )
}
