/**
 * Notion under Connections: the row on the Connections page and Notion's own
 * page. Connect opens Notion's approval page in a tab; Sky's service receives
 * the redirect on this machine and keeps the grant in the keychain. Chats
 * then find and read pages as the person who signed in.
 */

import { Button } from '@mantine/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Block, refusalOf, Row, UNREACHABLE } from './settingsBlocks.tsx'
import { ConnectionPage } from './settingsConnectionPage.tsx'
import { API, postJson, SIGN_IN_POLL_MS } from './settingsConnections.tsx'
import { connectionHref } from './settingsRoutes.ts'

// ── What the service answers (mirrors handler/settings/connections.ts) ──

type NotionStatus = {
  connected: boolean
  expired?: boolean
  workspace?: string
  user?: string
  email?: string
  error?: string
}

type NotionConnectState =
  | { status: 'waiting' }
  | { status: 'done'; workspace?: string }
  | { status: 'failed'; message: string }

const EXPIRED = 'Notion stopped accepting Sky’s sign-in. Connect again to keep reading pages.'

/** The status, or why there is none: `gone` when the service has no Notion connection. */
export function useNotion() {
  const [status, setStatus] = useState<NotionStatus | null>(null)
  const [gone, setGone] = useState(false)
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
    const r = await fetch(`${API}/notion`).catch(() => null)
    if (r?.status === 503) {
      setGone(true)
      return
    }
    if (!r?.ok) {
      setWarn(await refusalOf(r))
      return
    }
    setStatus((await r.json()) as NotionStatus)
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
    const r = await postJson(`${API}/notion/connect`, {})
    const refusal = await refusalOf(r)
    if (refusal || !r) {
      tab?.close()
      setWarn(refusal ?? UNREACHABLE)
      setBusy(false)
      return
    }
    const started = (await r.json()) as { id: string; url: string }
    if (tab) tab.location.href = started.url
    else setWarn('The browser kept Notion’s page from opening. Allow pop-ups for Sky, then press Connect again.')
    timer.current = window.setInterval(async () => {
      const res = await fetch(`${API}/notion/connect/${started.id}`).catch(() => null)
      if (!res?.ok) return
      const state = (await res.json()) as NotionConnectState
      if (state.status === 'waiting') return
      stop()
      setBusy(false)
      if (state.status === 'done') {
        setWarn(null)
        setHint(state.workspace ? `Connected to ${state.workspace}.` : 'Connected.')
        void reload()
      } else setWarn(state.message)
    }, SIGN_IN_POLL_MS)
  }, [reload, stop])

  const disconnect = useCallback(async () => {
    setWarn(null)
    setHint(null)
    setBusy(true)
    const refusal = await refusalOf(await fetch(`${API}/notion`, { method: 'DELETE' }).catch(() => null))
    setBusy(false)
    if (refusal) setWarn(refusal)
    else {
      setHint('Disconnected. Sky signed out of Notion on this Mac.')
      void reload()
    }
  }, [reload])

  return { status, gone, busy, warn, hint, connect, disconnect }
}

/** The workspace and who signed in, in one line. */
function whoLine(status: NotionStatus): string {
  const person = status.user ?? status.email
  if (status.workspace && person) return `${status.workspace} · signed in as ${person}`
  if (status.workspace) return status.workspace
  return person ? `Signed in as ${person}` : 'Connected.'
}

/** Who signed in, for the page, where the workspace is the row's own name. */
function personLine(status: NotionStatus): string {
  if (status.user && status.email) return `Signed in as ${status.user} (${status.email})`
  const person = status.user ?? status.email
  return person ? `Signed in as ${person}` : 'Connected.'
}

function Notes({ hint, trouble }: { hint: string | null; trouble: string | null }) {
  return (
    <>
      <div role="status" aria-atomic="true">
        {hint && <p className="sky-set-success">{hint}</p>}
      </div>
      {trouble && (
        <p className="sky-set-warn" role="alert">
          {trouble}
        </p>
      )}
    </>
  )
}

function ConnectButton({
  status,
  busy,
  connect,
}: Pick<ReturnType<typeof useNotion>, 'busy' | 'connect'> & { status: NotionStatus }) {
  return (
    <Button
      size="compact-sm"
      variant="primary"
      aria-label="Connect Notion"
      disabled={busy}
      onClick={() => void connect()}
    >
      {busy ? 'Waiting for Notion…' : status.expired ? 'Connect again' : 'Connect'}
    </Button>
  )
}

/** The row on the Connections page: Connect on the spot, then the way to Notion's page. */
export function NotionRow({ navigate }: { navigate: (to: string) => void }) {
  const { status, gone, busy, warn, hint, connect } = useNotion()
  if (gone) return null
  const live = Boolean(status?.connected && !status.expired)
  const sub = !status
    ? warn
      ? 'Try again in a moment.'
      : 'Checking…'
    : status.expired
      ? EXPIRED
      : live
        ? whoLine(status)
        : 'Find, read and create Notion pages in chats. Notion asks you to allow Sky, and that is all.'
  // Until the status loads the line says to try again; the Connections page names an unreachable service itself.
  const trouble = status ? (warn ?? (live ? (status.error ?? null) : null)) : null
  return (
    <Row
      label="Notion"
      sub={
        <>
          {sub}
          <Notes hint={hint} trouble={trouble} />
        </>
      }
    >
      {status &&
        (live ? <span className="sky-set-status">Connected</span> : <span className="sky-set-off">Not connected</span>)}
      {status && live && (
        <Button size="compact-sm" aria-label="Notion settings" onClick={() => navigate(connectionHref('notion'))}>
          ›
        </Button>
      )}
      {status && !live && <ConnectButton status={status} busy={busy} connect={connect} />}
    </Row>
  )
}

/** Notion's own page: who is signed in, Disconnect, and what to do with it in a chat. */
export function NotionMain({ navigate }: { navigate: (to: string) => void }) {
  const { status, gone, busy, warn, hint, connect, disconnect } = useNotion()
  const live = Boolean(status?.connected && !status.expired)
  const sub = !status
    ? warn
      ? 'Try again in a moment.'
      : 'Checking…'
    : status.expired
      ? EXPIRED
      : live
        ? personLine(status)
        : 'Press Connect, then allow Sky on Notion’s page.'
  return (
    <ConnectionPage
      name="Notion"
      gives="Chats can search your Notion, read the pages you link, and create pages and tables. Sky signs in as you, sees what you can see, and asks you before it makes anything."
      navigate={navigate}
    >
      {gone ? (
        <p className="sky-set-warn" role="alert">
          Notion is unavailable here.
        </p>
      ) : (
        <Block head="Workspace">
          <Row
            label={status?.workspace ?? 'Notion'}
            sub={
              <>
                {sub}
                <Notes hint={hint} trouble={warn ?? (live ? (status?.error ?? null) : null)} />
              </>
            }
            last
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
            {status && !live && <ConnectButton status={status} busy={busy} connect={connect} />}
          </Row>
        </Block>
      )}
      {live && (
        <Block head="In a chat">
          <Row label="Find a page" sub="Ask Sky to find a Notion page by its name or by what it says." />
          <Row
            label="Read a page"
            sub="Paste a Notion link into a chat and ask about it. Long pages are read in parts."
          />
          <Row
            label="Create a page"
            sub="Ask for a page, a page under another one, or a page in a teamspace. Sky shows it to you before it makes it."
          />
          <Row label="Create a table" sub="Ask for a table with its columns and rows, or for a new row in one." last />
        </Block>
      )}
    </ConnectionPage>
  )
}
