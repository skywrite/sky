import { Button, Modal } from '@mantine/core'
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
  const [nativeSetup, setNativeSetup] = useState<'apple' | 'passkeys' | null>(null)
  const [nativeError, setNativeError] = useState<string | null>(null)
  const [nativeBusy, setNativeBusy] = useState(false)
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
                      ? 'Approve each website in a native dialog. Passwords, passkeys, and verification codes stay in the private browser.'
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
                    <Button
                      size="sm"
                      variant={data.nativeBrowser?.applePasswords ? 'default' : 'primary'}
                      onClick={() => {
                        setNativeError(null)
                        setNativeSetup('apple')
                      }}
                    >
                      {data.nativeBrowser?.applePasswords ? 'Manage' : 'Connect'}
                    </Button>
                  </div>
                  <p className="sky-browser-help">
                    Use a saved login, a passkey, or your organization’s sign-in. Sky keeps the sign-in private and asks
                    you to complete any Touch ID, SMS, or authenticator challenge in the browser.
                  </p>
                </div>
              </section>
              <Block head="Passkeys and SSO">
                <Row
                  label={data.nativeBrowser ? 'Native Mac passkeys' : 'Enable native Mac passkeys'}
                  sub={
                    data.nativeBrowser
                      ? 'Brave (Chromium) · a separate, temporary profile for each task. Apple Passwords and 1Password use the macOS passkey picker.'
                      : 'Use Apple Passwords or 1Password through macOS AutoFill. Choose a browser that supports Mac passkeys.'
                  }
                  last
                >
                  <Button
                    size="sm"
                    onClick={() => {
                      setNativeError(null)
                      setNativeSetup('passkeys')
                    }}
                  >
                    {data.nativeBrowser ? 'Manage' : 'Set up'}
                  </Button>
                </Row>
                <p className="sky-browser-help">
                  For Google, Microsoft, Okta, or another SSO provider, complete the private sign-in window. Sky resumes
                  on the original website after your approval.
                </p>
              </Block>
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
      <Modal
        opened={nativeSetup !== null}
        onClose={() => {
          if (!nativeBusy) setNativeSetup(null)
        }}
        title="Apple Passwords and passkeys"
        centered
      >
        <p>
          Use Brave (Chromium) for native Mac sign-in. Each Sky task gets a temporary profile; your everyday browser
          stays separate.
        </p>
        <p>
          Apple Passwords fills logins through Apple’s extension. Passkeys use the macOS picker, including 1Password
          when enabled in AutoFill.
        </p>
        {nativeError && (
          <p role="alert" className="sky-browser-error">
            {nativeError}
          </p>
        )}
        <Button
          loading={nativeBusy}
          onClick={async () => {
            setNativeBusy(true)
            setNativeError(null)
            try {
              await browserSetupRequest('native-browser', {
                browser: 'brave',
                applePasswords: nativeSetup === 'apple' || !!data?.nativeBrowser?.applePasswords,
              })
              await reload()
              setNativeSetup(null)
            } catch (error) {
              setNativeError(browserSetupFailure(error))
            } finally {
              setNativeBusy(false)
            }
          }}
        >
          {data?.nativeBrowser
            ? 'Refresh setup'
            : nativeSetup === 'apple'
              ? 'Use Brave and connect'
              : 'Use Brave for passkeys'}
        </Button>
        {data?.nativeBrowser && (
          <>
            <Button
              disabled={nativeBusy}
              onClick={() =>
                void browserSetupRequest('autofill-settings', {}).catch((error) =>
                  setNativeError(browserSetupFailure(error)),
                )
              }
            >
              Open macOS AutoFill settings
            </Button>
            <Button
              disabled={nativeBusy}
              onClick={async () => {
                setNativeBusy(true)
                try {
                  await browserSetupRequest('bundled-browser', {})
                  await reload()
                  setNativeSetup(null)
                } catch (error) {
                  setNativeError(browserSetupFailure(error))
                } finally {
                  setNativeBusy(false)
                }
              }}
            >
              Use bundled Chromium
            </Button>
          </>
        )}
      </Modal>
    </div>
  )
}
