/**
 * Extensions in the web app: where an installed extension's screens appear,
 * and how they reach the extension's commands.
 *
 * The contract an extension writes to is `extensionContract.ts`, published
 * as `@skywrite/core/extensions`. Sky places each export: a card on profile
 * pages, an action in a file's header, a settings page, and a page of the
 * extension's own behind a sidebar entry. Each renders inside a guard: a
 * screen that throws is replaced by one line naming its extension, and the
 * page keeps working.
 */

import { Button, Switch } from '@mantine/core'
import { Component, type ReactNode, useEffect, useState } from 'react'
import type { ExtensionModule, ProfileRef, Run, RunAnswer, SettingsKit } from './extensionContract.ts'
import { extensionModules } from './extensionsGenerated.ts'
import { Block, mono, Row, UNREACHABLE } from './settingsBlocks.tsx'

export type { ExtensionModule, ProfileRef, Run, RunAnswer, SettingsKit } from './extensionContract.ts'

/** An installed extension as the service lists it. */
export interface ExtensionRow {
  id: string
  author: string
  slug: string
  name: string
  version: string
  description: string
  categories: string[]
  authorName: string
  from: string
  enabled: boolean
  problem?: string
  ui: boolean
}

export const runExtensionCommand: Run = async (command, args = {}) => {
  try {
    const r = await fetch('/extensions/_api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, args }),
    })
    const body = (await r.json().catch(() => ({}))) as Partial<RunAnswer>
    if (!r.ok) return { status: 'fail', message: body.message ?? `The service answered ${r.status}.`, log: [] }
    return { status: body.status ?? 'error', data: body.data, message: body.message, log: body.log ?? [] }
  } catch {
    return { status: 'error', message: UNREACHABLE, log: [] }
  }
}

/** Keeps a throwing screen from taking the page with it. React catches render errors only in a class. */
class Guard extends Component {
  declare props: { name: string; children: ReactNode }
  state: { error: string | null } = { error: null }
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  render() {
    if (this.state.error)
      return <p className="sky-set-note">{`${this.props.name} failed to show: ${this.state.error}`}</p>
    return this.props.children
  }
}

export function ExtensionProfileCards({ profile }: { profile: ProfileRef }) {
  return (
    <>
      {extensionModules.map((extension) => {
        const Card = extension.ui.ProfileCard
        return Card ? (
          <Guard key={extension.id} name={extension.name}>
            <Card profile={profile} run={runExtensionCommand} />
          </Guard>
        ) : null
      })}
    </>
  )
}

export function ExtensionFileActions({ file }: { file: string }) {
  return (
    <>
      {extensionModules.map((extension) => {
        const Action = extension.ui.FileAction
        if (!Action || !(extension.ui.appliesTo?.(file) ?? true)) return null
        return (
          <Guard key={extension.id} name={extension.name}>
            <Action file={file} run={runExtensionCommand} />
          </Guard>
        )
      })}
    </>
  )
}

export function ExtensionFileCards({ file }: { file: string }) {
  return (
    <>
      {extensionModules.map((extension) => {
        const Card = extension.ui.FileCard
        if (!Card || !(extension.ui.appliesTo?.(file) ?? true)) return null
        return (
          <Guard key={extension.id} name={extension.name}>
            <Card file={file} run={runExtensionCommand} />
          </Guard>
        )
      })}
    </>
  )
}

// ── an extension's own page, behind its sidebar entry ───────────────

/** `/extensions/<author>/<slug>` is an extension's own page; null is any other path. */
export function extensionRouteOf(path: string): string | null {
  const match = /^\/extensions\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/.exec(path)
  return match ? `${match[1]}/${match[2]}` : null
}

export function extensionHref(id: string): string {
  return `/extensions/${id}`
}

/** The sidebar entries of the extensions that have a page. */
export function ExtensionNavLinks({ active, navigate }: { active: string | null; navigate: (to: string) => void }) {
  return (
    <>
      {extensionModules
        .filter((extension) => extension.ui.Page && extension.ui.nav)
        .map((extension) => (
          <a
            key={extension.id}
            href={extensionHref(extension.id)}
            className="sky-thread sky-settings-link"
            data-active={active === extension.id}
            aria-current={active === extension.id ? 'page' : undefined}
            onClick={(event) => {
              if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              navigate(extensionHref(extension.id))
            }}
          >
            {extension.ui.nav?.label ?? extension.name}
          </a>
        ))}
    </>
  )
}

export function ExtensionPageMain({ id, navigate }: { id: string; navigate: (to: string) => void }) {
  const extension = extensionModules.find((e) => e.id === id)
  const Page = extension?.ui.Page
  return (
    <div className="sky-main">
      <header className="sky-head">
        <Button size="sm" onClick={() => navigate('/')} style={{ marginLeft: -10 }}>
          ‹ Today
        </Button>
        <span className="sky-title">{extension?.ui.nav?.label ?? extension?.name ?? id}</span>
      </header>
      <div className="sky-scroll">
        <div className="sky-col sky-set">
          {Page ? (
            <Guard name={extension.name}>
              <Page run={runExtensionCommand} navigate={navigate} />
            </Guard>
          ) : (
            <p className="sky-set-note">
              {extension ? `${extension.name} has no page.` : `No extension is installed as ${id}.`}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Settings › Extensions ───────────────────────────────────────────

const EXTENSIONS_HREF = '/settings/extensions'

/** `/settings/extensions/<author>/<slug>` names one extension's settings page. */
export function extensionPageOf(path: string): string | null {
  const match = /^\/settings\/extensions\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/.exec(path)
  return match ? `${match[1]}/${match[2]}` : null
}

function useInstalled(): [ExtensionRow[] | null, () => void] {
  const [rows, setRows] = useState<ExtensionRow[] | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    fetch('/extensions/_api/list')
      .then((r) => (r.ok ? r.json() : { extensions: [] }))
      .then((body: { extensions?: ExtensionRow[] }) => alive && setRows(body.extensions ?? []))
      .catch(() => alive && setRows([]))
    return () => {
      alive = false
    }
  }, [tick])
  return [rows, () => setTick((t) => t + 1)]
}

async function post(path: string, body?: unknown): Promise<string | null> {
  try {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (r.ok) return null
    const json = (await r.json().catch(() => ({}))) as { message?: string }
    return json.message ?? `The service answered ${r.status}.`
  } catch {
    return UNREACHABLE
  }
}

/** Settings › Extensions: what is installed, on or off, and each extension's own settings page. */
export function ExtensionsPane({ path, navigate }: { path: string; navigate: (to: string) => void }) {
  const [installed, reload] = useInstalled()
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const pageId = extensionPageOf(path)
  const kit: SettingsKit = { Block, Row, mono }

  if (pageId) {
    const extension = extensionModules.find((e) => e.id === pageId)
    const row = installed?.find((e) => e.id === pageId)
    const Settings = extension?.ui.Settings
    return (
      <>
        <div className="sky-set-back">
          <Button size="compact-sm" variant="subtle" onClick={() => navigate(EXTENSIONS_HREF)}>
            ‹ Extensions
          </Button>
        </div>
        <h2>{extension?.name ?? row?.name ?? pageId}</h2>
        {row && <p className="sky-set-note">{row.description}</p>}
        {Settings ? (
          <Guard name={extension?.name ?? pageId}>
            <Settings run={runExtensionCommand} ui={kit} />
          </Guard>
        ) : (
          <p className="sky-set-note">This extension has no settings.</p>
        )}
      </>
    )
  }

  // Screens compile into the page's bundle, so a switch or a reload ends in a fresh page.
  const toggle = async (row: ExtensionRow, enabled: boolean) => {
    setBusy(row.id)
    const refusal = await post('/extensions/_api/enable', { id: row.id, enabled })
    if (refusal) {
      setNote(refusal)
      setBusy(null)
      return
    }
    window.location.reload()
  }
  const reloadAll = async () => {
    setBusy('reload')
    const refusal = await post('/extensions/_api/reload')
    if (refusal) {
      setNote(refusal)
      setBusy(null)
      return
    }
    window.location.reload()
  }

  if (!installed) return null
  return (
    <Block
      head="Installed"
      note={
        installed.length
          ? 'Switching one on or off, or Reload, reads the extensions folder again and refreshes this page. Add one from the terminal: sky extensions:add <folder>'
          : 'No extensions yet. Add one from the terminal: sky extensions:add <folder>'
      }
    >
      {installed.map((row, index) => {
        const hasPage = extensionModules.some((e) => e.id === row.id && e.ui.Settings)
        return (
          <Row
            key={row.id}
            label={row.name}
            sub={
              row.problem
                ? `Not loaded: ${row.problem}`
                : `${row.version} · by ${row.authorName} · ${row.categories.join(', ')} · ${row.description}`
            }
            last={index === installed.length - 1}
          >
            {hasPage && row.enabled && (
              <Button size="compact-sm" onClick={() => navigate(`${EXTENSIONS_HREF}/${row.id}`)}>
                Settings ›
              </Button>
            )}
            <Switch
              size="sm"
              aria-label={`${row.name} on`}
              checked={row.enabled}
              disabled={busy !== null || Boolean(row.problem)}
              onChange={(event) => void toggle(row, event.currentTarget.checked)}
            />
          </Row>
        )
      })}
      <div className="sky-set-row" data-last="true">
        <div className="sky-set-txt">
          <div>{note ?? 'Reload'}</div>
          {!note && <div className="sky-set-sub">After adding or editing an extension in its folder.</div>}
        </div>
        <div className="sky-set-ctl">
          <Button
            size="compact-sm"
            loading={busy === 'reload'}
            disabled={busy !== null}
            onClick={() => void reloadAll()}
          >
            Reload
          </Button>
        </div>
      </div>
    </Block>
  )
}
