/**
 * Beeper's own page under Connections: which of its networks Sky saves, groups
 * or not, what the last check did, and a preview of what the next one would
 * do. The row on the Connections page leads here; connecting and the token
 * form stay on that page.
 */

import { Button, SegmentedControl } from '@mantine/core'
import { type Key, useCallback, useEffect, useState } from 'react'
import { Block, refusalOf, Row } from './settingsBlocks.tsx'
import { ConnectionPage } from './settingsConnectionPage.tsx'
import { API, postJson } from './settingsConnections.tsx'
import { settingsHref } from './settingsRoutes.ts'

type AccountRow = {
  id: string
  network: string
  status: string
  save: boolean
  groups: boolean
  holdUnknown: boolean
  chosen: boolean
  chats: number
}

type HeldRow = {
  chat: string
  network: string
  who: string
  first: string
  at: string
  count: number
}

type LastRun = {
  at: string
  chats: number
  messages: number
  files: number
  skipped: { chat: string; reason: string }[]
  accountsOff: string[]
  complete: boolean
}

type BeeperPageStatus = {
  running: boolean
  version?: string
  connected: boolean
  expired?: boolean
  accounts: AccountRow[]
  error?: string
  lastRun?: LastRun
  held: HeldRow[]
}

type PreviewRow = {
  chat: string
  network: string
  group: boolean
  pile: 'primary' | 'low-priority' | 'archive'
  save: boolean
  reason?: string
}

type Preview = { rows: PreviewRow[]; complete: boolean }

type CheckOutcome =
  | { ran: true; chats: number; messages: number; files: number; complete: boolean }
  | { ran: false; reason: string }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** How long ago, in the words a person would use. */
export function sinceLabel(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 60_000) return 'Just now'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${plural(hours, 'hour')} ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'Yesterday' : `${days} days ago`
}

/** The left-out chats, counted by reason, most common first. */
export function reasonSummary(skipped: { reason?: string }[]): string {
  const counts = new Map<string, number>()
  for (const { reason = 'left out' } of skipped) counts.set(reason, (counts.get(reason) ?? 0) + 1)
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${reason} (${count})`)
    .join(' · ')
}

function useBeeperPage() {
  const [status, setStatus] = useState<BeeperPageStatus | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [busy, setBusy] = useState<'check' | 'preview' | 'disconnect' | 'keep' | 'open' | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [checked, setChecked] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const r = await fetch(`${API}/beeper`).catch(() => null)
    if (!r?.ok) {
      setWarn(await refusalOf(r))
      return
    }
    setWarn(null)
    setStatus((await r.json()) as BeeperPageStatus)
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  const rule = useCallback(
    async (id: string, change: { save?: boolean; groups?: boolean; holdUnknown?: boolean }) => {
      // The row moves at once; the service's answer settles it.
      setStatus(
        (current) =>
          current && {
            ...current,
            accounts: current.accounts.map((row) => (row.id === id ? { ...row, ...change, chosen: true } : row)),
          },
      )
      setPreview(null)
      const refusal = await refusalOf(await postJson(`${API}/beeper/accounts/${encodeURIComponent(id)}`, change))
      if (refusal) setWarn(refusal)
      void reload()
    },
    [reload],
  )

  const check = useCallback(async () => {
    setBusy('check')
    setChecked(null)
    const r = await postJson(`${API}/beeper/check`, {})
    const refusal = await refusalOf(r)
    setBusy(null)
    if (refusal || !r) {
      setWarn(refusal)
      return
    }
    const outcome = (await r.json()) as CheckOutcome
    setChecked(
      outcome.ran
        ? `${plural(outcome.messages, 'message')} in ${plural(outcome.chats, 'chat')} saved${outcome.complete ? '' : ' · more chats wait for the next check'}.`
        : outcome.reason,
    )
    void reload()
  }, [reload])

  const showPreview = useCallback(async () => {
    setBusy('preview')
    const r = await fetch(`${API}/beeper/preview`).catch(() => null)
    const refusal = await refusalOf(r)
    setBusy(null)
    if (refusal || !r) {
      setWarn(refusal)
      return
    }
    setPreview((await r.json()) as Preview)
  }, [])

  // Save a held chat: it leaves the list at once; the service checks and its files appear.
  const keep = useCallback(
    async (chat: string) => {
      setBusy('keep')
      setStatus((current) => current && { ...current, held: current.held.filter((entry) => entry.chat !== chat) })
      const refusal = await refusalOf(await postJson(`${API}/beeper/held/${encodeURIComponent(chat)}/keep`, {}))
      setBusy(null)
      if (refusal) setWarn(refusal)
      void reload()
    },
    [reload],
  )

  const open = useCallback(async (chat: string) => {
    setBusy('open')
    const refusal = await refusalOf(await postJson(`${API}/beeper/held/${encodeURIComponent(chat)}/open`, {}))
    setBusy(null)
    if (refusal) setWarn(refusal)
  }, [])

  const disconnect = useCallback(async () => {
    setBusy('disconnect')
    const refusal = await refusalOf(await fetch(`${API}/beeper`, { method: 'DELETE' }).catch(() => null))
    setBusy(null)
    if (refusal) setWarn(refusal)
    void reload()
  }, [reload])

  return {
    status,
    warn,
    busy,
    preview,
    checked,
    rule,
    check,
    showPreview,
    keep,
    open,
    disconnect,
    hidePreview: () => setPreview(null),
  }
}

function OnOff({
  value,
  label,
  disabled,
  onChange,
}: {
  value: boolean
  label: string
  disabled?: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <SegmentedControl
      aria-label={label}
      disabled={disabled}
      value={value ? 'on' : 'off'}
      onChange={(next) => onChange(next === 'on')}
      data={[
        { value: 'off', label: 'Off' },
        { value: 'on', label: 'On' },
      ]}
    />
  )
}

/** One network, one card: its own switch, and its groups' switch inside it. */
function NetworkBlock({
  row,
  rule,
}: {
  key?: Key | null
  row: AccountRow
  rule: ReturnType<typeof useBeeperPage>['rule']
}) {
  const sub = row.save
    ? row.chats
      ? `Saving · ${plural(row.chats, 'chat')} so far`
      : 'Saving. Nothing has come in yet.'
    : row.chosen
      ? 'Off. Nothing from this network is saved.'
      : 'Waits for you. Nothing is saved until this is on.'
  return (
    <Block
      head={
        <>
          {row.network}
          {!row.chosen && (
            <span className="sky-set-chips">
              <span className="sky-set-chip">New</span>
            </span>
          )}
        </>
      }
    >
      <Row label="Save new messages" sub={sub}>
        <OnOff value={row.save} label={`Save ${row.network}`} onChange={(save) => void rule(row.id, { save })} />
      </Row>
      <Row
        label="Group chats"
        sub={
          <>
            {!row.save
              ? `Stays off while ${row.network} is off.`
              : row.groups
                ? 'Saved too.'
                : 'Only chats with one person. Groups stay out.'}{' '}
            Muted groups are never saved, even when this is on.
          </>
        }
      >
        <OnOff
          value={row.groups}
          label={`Save ${row.network} groups`}
          disabled={!row.save}
          onChange={(groups) => void rule(row.id, { groups })}
        />
      </Row>
      <Row
        label="Hold texts from unknown senders"
        sub={
          !row.save
            ? `Stays as it is while ${row.network} is off.`
            : row.holdUnknown
              ? 'Someone with no name in your contacts, whom you never answered, is held below for a look instead of saved.'
              : 'Saved like everyone else.'
        }
        last
      >
        <OnOff
          value={row.holdUnknown}
          label={`Hold unknown ${row.network} senders`}
          disabled={!row.save}
          onChange={(holdUnknown) => void rule(row.id, { holdUnknown })}
        />
      </Row>
    </Block>
  )
}

function HeldBlock({
  held,
  busy,
  keep,
  open,
}: {
  held: HeldRow[]
  busy: ReturnType<typeof useBeeperPage>['busy']
  keep: (chat: string) => void
  open: (chat: string) => void
}) {
  return (
    <Block
      head="Held for a look"
      note="Texts from senders you have no contact for. Nothing is saved until you say so; they stay in Beeper as they are, and drop off here after a month."
    >
      {held.map((entry, index) => (
        <Row
          key={entry.chat}
          label={
            <>
              <span className="sky-set-mono">{entry.who}</span>
              <span className="sky-set-chips">
                <span className="sky-set-chip">{entry.network}</span>
              </span>
            </>
          }
          sub={`“${entry.first}” · ${plural(entry.count, 'text')} · ${sinceLabel(entry.at)}`}
          last={index === held.length - 1}
        >
          <Button size="compact-sm" disabled={busy !== null} onClick={() => keep(entry.chat)}>
            Save
          </Button>
          <Button size="compact-sm" disabled={busy !== null} onClick={() => open(entry.chat)}>
            Open in Beeper
          </Button>
        </Row>
      ))}
    </Block>
  )
}

function LastCheck({
  lastRun,
  busy,
  checked,
  check,
  showPreview,
}: {
  lastRun?: LastRun
  busy: ReturnType<typeof useBeeperPage>['busy']
  checked: string | null
  check: () => void
  showPreview: () => void
}) {
  const [showSkipped, setShowSkipped] = useState(false)
  return (
    <Block head="Last check">
      {lastRun ? (
        <>
          <Row
            label={sinceLabel(lastRun.at)}
            sub={`${plural(lastRun.messages, 'message')} in ${plural(lastRun.chats, 'chat')} saved${lastRun.complete ? '' : ' · more chats wait for the next check'}`}
            last={!lastRun.skipped.length && !lastRun.accountsOff.length}
          />
          {lastRun.accountsOff.length > 0 && (
            <Row label="Switched off" sub={lastRun.accountsOff.join(' · ')} last={!lastRun.skipped.length} />
          )}
          {lastRun.skipped.length > 0 && (
            <Row label={`${plural(lastRun.skipped.length, 'chat')} left out`} sub={reasonSummary(lastRun.skipped)} last>
              <Button size="compact-sm" onClick={() => setShowSkipped((open) => !open)}>
                {showSkipped ? 'Hide them' : 'Show them'}
              </Button>
            </Row>
          )}
          {showSkipped && (
            <ul className="sky-set-list">
              {lastRun.skipped.map((entry) => (
                <li key={`${entry.chat} ${entry.reason}`}>
                  {entry.chat} <span className="sky-set-off">· {entry.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="sky-set-sub">No check has run yet. One runs every five minutes while Beeper Desktop is open.</p>
      )}
      <div className="sky-set-actions">
        <Button size="sm" loading={busy === 'check'} disabled={busy !== null} onClick={check}>
          Check now
        </Button>
        <Button size="sm" loading={busy === 'preview'} disabled={busy !== null} onClick={showPreview}>
          Show what a check would save
        </Button>
        {checked && <span role="status">{checked}</span>}
      </div>
    </Block>
  )
}

const PILE_LABEL: Record<PreviewRow['pile'], string> = {
  primary: 'Inbox',
  'low-priority': 'Low priority',
  archive: 'Archive',
}

function PreviewBlock({ preview, hide }: { preview: Preview; hide: () => void }) {
  const saved = preview.rows.filter((row) => row.save)
  const left = preview.rows.filter((row) => !row.save)
  return (
    <Block
      head="What a check would save"
      note="Every chat Beeper filed in the last month, and what the next check does with it. Nothing is saved by looking."
    >
      <Row
        label={`${plural(saved.length, 'chat')} would be saved`}
        sub={
          saved.length
            ? saved.map((row) => `${row.chat} (${row.network})`).join(' · ')
            : 'Nothing, with the switches as they are.'
        }
      />
      <Row
        label={`${plural(left.length, 'chat')} left out`}
        sub={left.length ? reasonSummary(left) : 'Nothing.'}
        last={!left.length && preview.complete}
      />
      {left.length > 0 && (
        <ul className="sky-set-list">
          {left.map((row) => (
            <li key={`${row.pile} ${row.chat}`}>
              {row.chat}{' '}
              <span className="sky-set-off">
                · {row.network}
                {row.group ? ' group' : ''} · {PILE_LABEL[row.pile]} · {row.reason}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!preview.complete && <p className="sky-set-sub">Beeper has more chats than this preview lists.</p>}
      <div className="sky-set-actions">
        <Button size="sm" onClick={hide}>
          Close
        </Button>
      </div>
    </Block>
  )
}

export function BeeperMain({ navigate }: { navigate: (to: string) => void }) {
  const { status, warn, busy, preview, checked, rule, check, showPreview, keep, open, disconnect, hidePreview } =
    useBeeperPage()
  const live = Boolean(status?.connected && !status?.expired)
  const toConnections = () => navigate(settingsHref('connections'))
  return (
    <ConnectionPage
      name="Beeper"
      gives="Beeper Desktop carries your chats from Signal, iMessage and the rest. Sky saves the ones you choose and can place a reply into any of them."
      navigate={navigate}
    >
      {warn && (
        <p className="sky-set-warn" role="alert">
          {warn}
        </p>
      )}
      {status && (
        <Block
          head="Status"
          note={
            live && status.running
              ? 'Each network Beeper carries has a card below. A network that shows up later waits, off, until you switch it on. Slack stays with Sky’s own Slack connection.'
              : undefined
          }
        >
          <Row
            label="Beeper Desktop"
            sub={
              !status.connected
                ? 'Not connected. Connect Beeper on the Connections page.'
                : status.expired
                  ? 'The connection ran out. Connect again on the Connections page.'
                  : status.running
                    ? `Running${status.version ? ` · ${status.version}` : ''}`
                    : 'Not running. Open it to keep saving messages.'
            }
            last
          >
            {live ? (
              <span className="sky-set-status">Connected</span>
            ) : (
              <span className="sky-set-off">Not connected</span>
            )}
            {live ? (
              <Button
                size="compact-sm"
                loading={busy === 'disconnect'}
                disabled={busy !== null}
                onClick={() => void disconnect()}
              >
                Disconnect
              </Button>
            ) : (
              <Button size="compact-sm" onClick={toConnections}>
                Connections
              </Button>
            )}
          </Row>
          {status.error && (
            <p className="sky-set-warn" role="alert">
              {status.error}
            </p>
          )}
        </Block>
      )}
      {status && live && status.running && !status.accounts.length && (
        <Block head="Networks">
          <p className="sky-set-sub">Beeper has no chat accounts yet. Add one in Beeper Desktop.</p>
        </Block>
      )}
      {status &&
        live &&
        status.running &&
        status.accounts.map((row) => <NetworkBlock key={row.id} row={row} rule={rule} />)}
      {status && live && status.held.length > 0 && (
        <HeldBlock held={status.held} busy={busy} keep={(chat) => void keep(chat)} open={(chat) => void open(chat)} />
      )}
      {status && live && (
        <LastCheck
          lastRun={status.lastRun}
          busy={busy}
          checked={checked}
          check={() => void check()}
          showPreview={() => void showPreview()}
        />
      )}
      {preview && <PreviewBlock preview={preview} hide={hidePreview} />}
      {status && live && (
        <Block
          head="Replies"
          note="A reply you approve in Outbox goes into the chat’s composer in Beeper. You press Send there. A draft you typed yourself is never replaced."
        >
          {null}
        </Block>
      )}
    </ConnectionPage>
  )
}
