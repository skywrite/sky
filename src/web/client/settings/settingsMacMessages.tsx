/**
 * Messages on this Mac: the row under Connections that says whether Sky may
 * read this Mac's Contacts and Messages — the names behind the numbers
 * Beeper's iMessage shows, and the phone's own known-or-not — and opens the
 * System Settings pane where Full Disk Access is granted.
 */

import { Button } from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { mono, plural, refusalOf, Row } from './settingsBlocks.tsx'
import { API, postJson } from './settingsConnections.tsx'

type SourceState = 'readable' | 'denied' | 'missing' | 'unexpected'

export type MacMessagesStatus = {
  supported: boolean
  messages: SourceState
  contacts: SourceState
  books: number
  names: number
  handles: number
  binary: string
}

/** The status, or why there is none: `gone` when the service has no such connection, as off a Mac. */
export function useMacMessages() {
  const [status, setStatus] = useState<MacMessagesStatus | null>(null)
  const [gone, setGone] = useState(false)
  const [warn, setWarn] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    const r = await fetch(`${API}/mac-messages`).catch(() => null)
    if (r?.status === 503) {
      setGone(true)
      return
    }
    if (!r?.ok) {
      setWarn(await refusalOf(r))
      return
    }
    setWarn(null)
    setStatus((await r.json()) as MacMessagesStatus)
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  const openSettings = useCallback(async () => {
    setBusy(true)
    const refusal = await refusalOf(await postJson(`${API}/mac-messages/open-settings`, {}))
    setBusy(false)
    if (refusal) setWarn(refusal)
  }, [])

  // A process that is already running picks a grant up only once it starts
  // again. Sky is away for a moment; the row keeps asking until it is back.
  const [note, setNote] = useState<string | null>(null)
  const restart = useCallback(async () => {
    setBusy(true)
    setNote('Sky is starting again…')
    const ok = await fetch('/service/restart', { method: 'POST' })
      .then((r) => r.ok)
      .catch(() => false)
    if (!ok) {
      setNote(null)
      setBusy(false)
      setWarn('Could not restart Sky. Try again.')
      return
    }
    for (let tries = 0; tries < 30; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000))
      const r = await fetch(`${API}/mac-messages`).catch(() => null)
      if (r?.ok) {
        setStatus((await r.json()) as MacMessagesStatus)
        break
      }
    }
    setNote(null)
    setBusy(false)
  }, [])

  return { status, gone, warn, note, busy, reload, openSettings, restart }
}

/** Whether a source needs the person's hand: the grant is missing. */
export function needsGrant(status: MacMessagesStatus): boolean {
  return status.messages === 'denied' || status.contacts === 'denied'
}

/** What the row says about the two databases, and whether Sky reads them. */
export function macMessagesLine(status: MacMessagesStatus): { ok: boolean; text: string } {
  const sources: [name: string, state: SourceState][] = [
    ['Contacts', status.contacts],
    ['Messages', status.messages],
  ]
  const named = (state: SourceState) =>
    sources
      .filter(([, s]) => s === state)
      .map(([name]) => name)
      .join(' and ')
  if (sources.every(([, s]) => s === 'readable'))
    return {
      ok: true,
      text: `Names for the people who text you by number, and which senders your phone filed as unknown. ${plural(status.names, 'name')} · ${plural(status.handles, 'chat')} on this Mac.`,
    }
  const ok = sources.some(([, s]) => s === 'readable')
  if (named('denied'))
    return {
      ok,
      text: `Sky cannot read this Mac’s ${named('denied')}, so every iMessage sender looks unknown and its photos and voice notes stay behind.`,
    }
  if (named('unexpected'))
    return {
      ok,
      text: `This Mac’s ${named('unexpected')} database is not in a shape Sky knows. macOS may have changed it.`,
    }
  return { ok, text: `This Mac has no ${named('missing')} database yet. Sign in to Messages on this Mac first.` }
}

/** The row: absent off a Mac, since there is nothing to read. */
export function MacMessagesRow({ last }: { last?: boolean }) {
  const { status, gone, warn, note, busy, reload, openSettings, restart } = useMacMessages()
  const [checked, setChecked] = useState(false)
  if (gone || (status && !status.supported)) return null
  const line = status ? macMessagesLine(status) : null
  const grant = status ? needsGrant(status) : false
  const checkAgain = async () => {
    await reload()
    setChecked(true)
  }
  return (
    <Row
      label="Messages on this Mac"
      sub={
        <>
          {!status ? (warn ? 'Try again in a moment.' : 'Checking…') : line?.text}
          {status && grant && (
            <> Add {mono(status.binary)} under Full Disk Access, let macOS quit it if it offers to, then check again.</>
          )}
          {status && grant && checked && !note && <> Added it already? Sky picks it up once it starts again.</>}
          {note && <> {note}</>}
          {status && warn && (
            <p className="sky-set-warn" role="alert">
              {warn}
            </p>
          )}
        </>
      }
      last={last}
    >
      {status &&
        (line?.ok ? <span className="sky-set-status">Reading</span> : <span className="sky-set-off">Not reading</span>)}
      {status && grant && (
        <>
          <Button size="compact-sm" variant="primary" disabled={busy} onClick={() => void openSettings()}>
            Open System Settings
          </Button>
          <Button size="compact-sm" disabled={busy} onClick={() => void checkAgain()}>
            Check again
          </Button>
          {checked && (
            <Button size="compact-sm" disabled={busy} onClick={() => void restart()}>
              Restart Sky
            </Button>
          )}
        </>
      )}
    </Row>
  )
}
