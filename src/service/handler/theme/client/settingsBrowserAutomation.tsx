import { Button } from '@mantine/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserAutomationData } from '../../settings/browserAutomation/types.ts'
import { Block, Row } from './settingsBlocks.tsx'
import { browserSetupFailure, browserSetupRequest } from './settingsBrowserAutomationApi.ts'
import { CredentialProviderIcon } from './settingsCredentialIcons.tsx'
import { ConnectPasswordManager, PasswordManagers } from './settingsPasswordManagers.tsx'
import { settingsHref } from './settingsRoutes.ts'
import './settingsBrowserAutomation.css'

export function BrowserAutomationMain({
  navigate,
  back,
}: {
  navigate: (path: string) => void
  back: { label: string; onClick: () => void }
}) {
  const [data, setData] = useState<BrowserAutomationData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [managing, setManaging] = useState(false)
  const [connecting, setConnecting] = useState<string | null>(null)
  const sequence = useRef(0)
  const reload = useCallback(async () => {
    const current = ++sequence.current
    setLoading(true)
    setError(null)
    try {
      const next = await browserSetupRequest<BrowserAutomationData>()
      if (sequence.current === current) setData(next)
    } catch (error) {
      if (sequence.current === current) setError(browserSetupFailure(error))
      throw error
    } finally {
      if (sequence.current === current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    void reload().catch(() => {})
    return () => {
      sequence.current++
    }
  }, [reload])
  const count = data?.passwordManagers.length ?? 0
  return (
    <div className="sky-main">
      <header className="sky-head">
        <Button size="sm" style={{ marginLeft: -10 }} onClick={back.onClick}>
          ‹ {back.label}
        </Button>
        <span className="sky-set-breadcrumb">Settings</span>
      </header>
      <div className="sky-scroll">
        <div className="sky-col sky-set" data-section="browser-automation">
          <div className="sky-set-heading">
            <h1>Browser automation</h1>
            <p>How Sky works with websites and signs in with your help.</p>
          </div>
          {error && (
            <div className="sky-browser-error" role="alert">
              <span>{error}</span>
              <Button size="sm" loading={loading} onClick={() => void reload().catch(() => {})}>
                Try again
              </Button>
            </div>
          )}
          {!data && loading && <p role="status">Loading browser settings…</p>}
          {data && (
            <>
              <Block head="Sign-in">
                <Row
                  label={data.signIn === 'approval' ? 'Approve each sign-in' : 'Sign in with your help'}
                  sub={
                    data.signIn === 'approval'
                      ? 'Sky asks you to choose a 1Password login and approve its use for the current website. Each task has its own private browser session.'
                      : 'Sky pauses when a website needs a password, passkey, or verification code. Complete the step in the browser, then continue.'
                  }
                  last
                >
                  <span className="sky-set-off">{data.signIn === 'approval' ? 'Approval required' : 'Manual'}</span>
                </Row>
              </Block>
              <section className="sky-block sky-browser-managers" aria-label="Password managers">
                <div className="sky-block-head">Password managers</div>
                <div className="sky-block-pad">
                  <div className="sky-browser-manager-row">
                    <CredentialProviderIcon provider="1password" />
                    <div className="sky-browser-manager-copy">
                      <div className="sky-browser-manager-title">1Password</div>
                      <div className="sky-browser-manager-sub">
                        {count
                          ? `${count} ${count === 1 ? 'account' : 'accounts'} set up for browser sign-in`
                          : 'Choose the accounts and vaults for browser sign-in.'}
                      </div>
                    </div>
                    <div className="sky-browser-manager-actions">
                      {count > 0 && <span className="sky-set-status">Setup saved</span>}
                      <Button
                        size="sm"
                        variant={count ? 'default' : 'primary'}
                        onClick={() => (count ? setManaging(true) : setConnecting(''))}
                      >
                        {count ? 'Manage' : 'Connect'}
                      </Button>
                    </div>
                  </div>
                  <div className="sky-browser-manager-row">
                    <CredentialProviderIcon provider="keychain" />
                    <div className="sky-browser-manager-copy">
                      <div className="sky-browser-manager-title">Apple Passwords</div>
                      <div className="sky-browser-manager-sub">Passwords and passkeys saved in iCloud Keychain.</div>
                    </div>
                    <span className="sky-set-off">Not available yet</span>
                  </div>
                  <p className="sky-browser-help">
                    Password sign-in requires your approval. For passkeys, verification codes, or an unsupported sign-in
                    page, Sky asks you to finish in the browser.
                  </p>
                </div>
              </section>
              <p className="sky-set-note">
                API keys for Sky’s services are managed in{' '}
                <button
                  className="sky-browser-link"
                  type="button"
                  onClick={() => navigate(settingsHref('connections'))}
                >
                  Connections
                </button>
                .
              </p>
            </>
          )}
        </div>
      </div>
      {data && managing && (
        <PasswordManagers
          data={data}
          close={() => setManaging(false)}
          reload={reload}
          connect={(id) => {
            setManaging(false)
            setConnecting(id ?? '')
          }}
        />
      )}
      {connecting !== null && (
        <ConnectPasswordManager id={connecting} close={() => setConnecting(null)} done={reload} />
      )}
    </div>
  )
}
