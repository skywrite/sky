import { Button, Checkbox, Loader, Modal, Switch } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import type { BrowserAutomationData, PasswordManagerView } from '../../settings/browserAutomation/types.ts'
import { browserSetupFailure, browserSetupRequest } from './settingsBrowserAutomationApi.ts'
import { CredentialProviderIcon } from './settingsCredentialIcons.tsx'

function OnePasswordSetup({ onError }: { onError: (message: string) => void }) {
  const [opening, setOpening] = useState(false)
  return (
    <section className="sky-browser-provider-setup" aria-label="1Password setup">
      <strong>One-time setup in 1Password</strong>
      <p>In Settings → Developer, enable both:</p>
      <ul>
        <li>
          <strong>Integrate with 1Password CLI</strong>
          <span>Lets Sky find your accounts automatically.</span>
        </li>
        <li>
          <strong>Integrate with 1Password SDKs</strong>
          <span>Lets Sky check the connection and find your vaults.</span>
        </li>
      </ul>
      <p>MCP integration is not required.</p>
      <Button
        size="sm"
        loading={opening}
        onClick={async () => {
          setOpening(true)
          try {
            await browserSetupRequest('open-settings', {})
          } catch (error) {
            onError(browserSetupFailure(error))
          } finally {
            setOpening(false)
          }
        }}
      >
        Open 1Password settings
      </Button>
    </section>
  )
}

export function ConnectPasswordManager({
  id,
  close,
  done,
}: {
  id: string
  close: () => void
  done: () => Promise<void>
}) {
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const pending = useRef<{ attempt: number; request: Promise<unknown> } | null>(null)
  const callbacks = useRef({ close, done })
  callbacks.current = { close, done }
  useEffect(() => {
    let active = true
    setBusy(true)
    setError(null)
    // Only a Connect/Refresh click mounts this dialog. Reuse the native approval on effect replays.
    if (pending.current?.attempt !== attempt)
      pending.current = {
        attempt,
        request: id ? browserSetupRequest('refresh', { id }) : browserSetupRequest('connect', {}),
      }
    void pending.current.request.then(
      async () => {
        if (!active) return
        // A saved setup must not turn a failed page refresh into another approval attempt.
        await callbacks.current.done().catch(() => {})
        if (active) callbacks.current.close()
      },
      async (error: unknown) => {
        if (!active) return
        setError(browserSetupFailure(error))
        setBusy(false)
        await callbacks.current.done().catch(() => {})
      },
    )
    return () => {
      active = false
    }
  }, [id, attempt])
  return (
    <Modal
      opened
      onClose={close}
      closeOnEscape={!busy}
      closeOnClickOutside={!busy}
      withCloseButton={!busy}
      title={id ? 'Refresh 1Password vaults' : 'Connect 1Password'}
      size="560px"
      centered
    >
      <div className="sky-browser-form">
        <CredentialProviderIcon provider="1password" />
        <p className="sky-browser-lead">Approve Sky in 1Password.</p>
        <p className="sky-browser-help">
          Sky finds your accounts on this Mac automatically. Follow any approval or verification steps in 1Password. All
          accessible vaults are included by default.
        </p>
        {busy && (
          <p role="status">
            <Loader size="sm" aria-hidden="true" /> Connecting to 1Password…
          </p>
        )}
        {error && (
          <p role="alert" className="sky-set-warn">
            {error}
          </p>
        )}
        {!busy && error && <OnePasswordSetup onError={setError} />}
        {!busy && (
          <div className="sky-dialog-actions">
            <Button onClick={close}>Close</Button>
            <Button variant="primary" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function SourceVaults({
  source,
  busy,
  save,
}: {
  source: PasswordManagerView
  busy: boolean
  save: (ids: string[]) => void
}) {
  const [custom, setCustom] = useState(source.excludedVaultIds.length > 0)
  return (
    <>
      <div className="sky-set-row" data-last="true">
        <div className="sky-set-txt">
          <div>Include all accessible vaults</div>
          <div className="sky-set-sub">New vaults are included unless you exclude them.</div>
        </div>
        <Switch
          aria-label={`Include all vaults from ${source.label}`}
          checked={!custom}
          disabled={busy}
          onChange={(event) => {
            const all = event.currentTarget.checked
            setCustom(!all)
            if (all) save([])
          }}
        />
      </div>
      <div className="sky-browser-vaults">
        {source.containers.map((container) => (
          <Checkbox
            key={container.id}
            label={container.label}
            checked={!source.excludedVaultIds.includes(container.id)}
            disabled={busy || !custom}
            onChange={(event) =>
              save(
                event.currentTarget.checked
                  ? source.excludedVaultIds.filter((id) => id !== container.id)
                  : [...source.excludedVaultIds, container.id],
              )
            }
          />
        ))}
      </div>
    </>
  )
}

export function PasswordManagers({
  data,
  close,
  reload,
  connect,
}: {
  data: BrowserAutomationData
  close: () => void
  reload: () => Promise<void>
  connect: (id?: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const mutate = async (operation: 'disconnect' | 'vaults', body: unknown) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await browserSetupRequest(operation, body)
      setConfirm(null)
      await reload().catch(() => setError('Your change was saved. Close this window and refresh Browser automation.'))
    } catch (error) {
      setError(browserSetupFailure(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      opened
      onClose={close}
      closeOnEscape={!busy}
      closeOnClickOutside={!busy}
      withCloseButton={!busy}
      title="1Password accounts"
      size="650px"
      centered
    >
      <p className="sky-browser-lead">Choose the accounts and vaults for browser sign-in.</p>
      {data.passwordManagers.map((source) => (
        <section key={source.id} className="sky-browser-account">
          <div className="sky-browser-manager-row">
            <CredentialProviderIcon provider="1password" />
            <div className="sky-browser-manager-copy">
              <div className="sky-browser-manager-title">{source.label}</div>
              <div className="sky-browser-manager-sub">1Password</div>
            </div>
          </div>
          <SourceVaults
            source={source}
            busy={busy}
            save={(ids) => void mutate('vaults', { id: source.id, excludedVaultIds: ids })}
          />
          <div className="sky-browser-actions">
            <Button size="sm" disabled={busy} onClick={() => connect(source.id)}>
              Refresh vaults
            </Button>
            <Button
              size="sm"
              variant="danger-quiet"
              disabled={busy}
              onClick={() => setConfirm(confirm === source.id ? null : source.id)}
            >
              Disconnect
            </Button>
          </div>
          {confirm === source.id && (
            <div className="sky-browser-confirm">
              <p>Disconnect {source.label} from Sky? Its credentials stay in 1Password.</p>
              <div className="sky-browser-actions">
                <Button size="sm" disabled={busy} onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy}
                  onClick={() => void mutate('disconnect', { id: source.id })}
                >
                  Disconnect account
                </Button>
              </div>
            </div>
          )}
        </section>
      ))}
      <Button size="sm" disabled={busy} onClick={() => connect()}>
        {data.passwordManagers.length ? 'Connect another account' : 'Connect 1Password'}
      </Button>
      {error && (
        <p role="alert" className="sky-set-warn">
          {error}
        </p>
      )}
      <div className="sky-dialog-actions">
        <Button variant="primary" disabled={busy} onClick={close}>
          Done
        </Button>
      </div>
    </Modal>
  )
}
