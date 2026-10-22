/**
 * The model providers' keys, each on its own page under Connections ›
 * Services: Anthropic, OpenAI and Cerebras. A pasted key is checked with the
 * provider before it goes in the keychain, and every visit asks again, so a
 * revoked key reads as refused. A key still in Sky's src/.env file shows as
 * such until one is saved here; the keychain's key wins.
 */

import { Button, PasswordInput } from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { Block, mono, refusalOf, Row } from './settingsBlocks.tsx'
import { ConnectionPage } from './settingsConnectionPage.tsx'
import { API, postJson } from './settingsConnections.tsx'
import { connectionPageOf } from './settingsRoutes.ts'

// ── What the service answers (mirrors handler/settings/providerKeys.ts) ──

interface ProviderKeyStatus {
  source: 'keychain' | 'env' | null
  env?: string
  tail?: string
  refused?: boolean
  error?: string
}

/** The providers with a key page, in the order Services lists them, in their own words. */
export const PROVIDER_KEY_PAGES = {
  anthropic: {
    name: 'Anthropic',
    row: 'Claude models. Configure its API key.',
    gives: 'Connect Claude models to Sky. Your API key is saved in the OS credential store.',
    console: 'console.anthropic.com',
    where: 'In the Anthropic Console, open API keys, create a key, and paste it here.',
  },
  openai: {
    name: 'OpenAI',
    row: 'GPT models, voice calls, transcription and images. Configure its API key.',
    gives:
      'Connect OpenAI’s models to Sky for chat, voice calls, transcription and images. Your API key is saved in the OS credential store.',
    console: 'platform.openai.com',
    where: 'On the OpenAI platform, open API keys, create a secret key, and paste it here.',
  },
  cerebras: {
    name: 'Cerebras',
    row: 'Fast open models. Configure its API key.',
    gives: 'Connect Cerebras’s fast open models to Sky. Your API key is saved in the OS credential store.',
    console: 'cloud.cerebras.ai',
    where: 'In Cerebras Cloud, open API Keys, create a key, and paste it here.',
  },
} as const

export type ProviderKeyPage = keyof typeof PROVIDER_KEY_PAGES
export const PROVIDER_KEY_ORDER = Object.keys(PROVIDER_KEY_PAGES) as ProviderKeyPage[]

/** The provider whose key page this path is, if it is one. */
export function providerKeyPageOf(path: string): ProviderKeyPage | null {
  const page = connectionPageOf(path)
  return page !== null && page in PROVIDER_KEY_PAGES ? (page as ProviderKeyPage) : null
}

function useProviderKey(provider: ProviderKeyPage) {
  const { name } = PROVIDER_KEY_PAGES[provider]
  const url = `${API}/keys/${provider}`
  const [status, setStatus] = useState<ProviderKeyStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [warn, setWarn] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const r = await fetch(url).catch(() => null)
    if (!r?.ok) {
      setWarn(await refusalOf(r))
      return
    }
    setStatus((await r.json()) as ProviderKeyStatus)
  }, [url])
  useEffect(() => {
    void reload()
  }, [reload])

  const saveKey = useCallback(
    async (key: string) => {
      setWarn(null)
      setHint(null)
      setBusy(true)
      const refusal = await refusalOf(await postJson(url, { key }))
      setBusy(false)
      if (refusal) {
        setWarn(refusal)
        return false
      }
      setHint(`Saved. ${name} accepts the key.`)
      void reload()
      return true
    },
    [url, name, reload],
  )

  const remove = useCallback(async () => {
    setWarn(null)
    setHint(null)
    setBusy(true)
    const refusal = await refusalOf(await fetch(url, { method: 'DELETE' }).catch(() => null))
    setBusy(false)
    if (refusal) setWarn(refusal)
    else {
      setHint('Removed from the keychain.')
      void reload()
    }
  }, [url, reload])

  return { status, busy, warn, hint, saveKey, remove }
}

function ProviderKeyRow({ provider }: { provider: ProviderKeyPage }) {
  const { name, console: home, where } = PROVIDER_KEY_PAGES[provider]
  const { status, busy, warn, hint, saveKey, remove } = useProviderKey(provider)
  const [form, setForm] = useState(false)
  const [key, setKey] = useState('')
  const [confirming, setConfirming] = useState(false)
  const close = () => {
    setForm(false)
    setKey('')
  }
  const fromEnv = status?.source === 'env'
  const envFile = (
    <>
      <code>{status?.env}</code> in Sky’s <code>src/.env</code> file
    </>
  )
  const sub = !status ? (
    warn ? (
      'Try again in a moment.'
    ) : (
      'Checking…'
    )
  ) : !status.source ? (
    <>
      Keys are made at{' '}
      <a href={`https://${home}`} target="_blank" rel="noreferrer">
        {home}
      </a>
      .
    </>
  ) : status.refused ? (
    fromEnv ? (
      <>
        {name} no longer accepts the key from {envFile}. Save a new one here.
      </>
    ) : (
      `${name} no longer accepts this key. Save a new one.`
    )
  ) : fromEnv ? (
    <>Read from {envFile}. Save it here to keep it in your keychain instead.</>
  ) : (
    'Saved in your keychain.'
  )
  const trouble = warn ?? (status?.error && !status.refused ? status.error : null)

  return (
    <>
      <Row
        label={`${name} API key`}
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
        last={!form}
      >
        {status?.tail && mono(`•••• ${status.tail}`)}
        {status &&
          (!status.source ? (
            <span className="sky-set-off">Not set</span>
          ) : status.refused ? (
            <span className="sky-set-off">Refused</span>
          ) : (
            <span className="sky-set-status">Connected</span>
          ))}
        {status && (
          <Button size="compact-sm" disabled={busy} onClick={() => (form ? close() : setForm(true))}>
            {status.source ? 'Change' : 'Add'}
          </Button>
        )}
        {status?.source === 'keychain' &&
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
            {where} Sky asks {name} to confirm it before it goes in your keychain
            {fromEnv ? ', and uses it in place of the key in src/.env.' : '.'}
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
              {busy ? `Checking with ${name}…` : 'Save to keychain'}
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

export function ProviderKeyMain({ provider, navigate }: { provider: ProviderKeyPage; navigate: (to: string) => void }) {
  const { name, gives } = PROVIDER_KEY_PAGES[provider]
  return (
    <ConnectionPage name={name} gives={gives} navigate={navigate}>
      <Block head="API key">
        <ProviderKeyRow provider={provider} />
      </Block>
    </ConnectionPage>
  )
}
