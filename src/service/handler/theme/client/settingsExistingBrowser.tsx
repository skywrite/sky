import { Button, Modal, PasswordInput } from '@mantine/core'
import { useState } from 'react'
import type { BrowserAutomationData } from '../../settings/browserAutomation/types.ts'
import { Block, Row } from './settingsBlocks.tsx'
import { browserSetupFailure, browserSetupRequest } from './settingsBrowserAutomationApi.ts'

export function ExistingBrowserSettings({
  data,
  reload,
}: {
  data: BrowserAutomationData
  reload: () => Promise<void>
}) {
  const [opened, setOpened] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const connected = !!data.existingBrowser
  const close = () => {
    if (busy) return
    setOpened(false)
    setToken('')
    setError(null)
  }
  return (
    <>
      <Block head="Browser">
        <Row
          label={connected ? 'Use my Brave browser' : 'Use your existing Brave browser'}
          sub={
            connected
              ? 'Sky uses your existing website sign-ins in its own tabs. Ending a task leaves Brave and your sign-ins available.'
              : 'Connect the Brave profile you already use so Sky can work with websites where you’re signed in.'
          }
          last
        >
          {connected && <span className="sky-set-status">Selected</span>}
          <Button
            size="sm"
            onClick={() => {
              setError(null)
              setOpened(true)
            }}
          >
            {connected ? 'Manage browser' : 'Connect Brave'}
          </Button>
        </Row>
      </Block>
      <Modal
        opened={opened}
        onClose={close}
        title={connected ? 'Your Brave connection' : 'Connect your Brave browser'}
        centered
      >
        <p>
          Install the{' '}
          <a
            href="https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm"
            target="_blank"
            rel="noreferrer"
          >
            Playwright extension
          </a>{' '}
          in the Brave profile you want Sky to use. Open the extension and copy its connection token.
        </p>
        <p>
          Saving this connection lets Sky use that browser for tasks you request without asking you to approve each
          browser connection. The token is stored in this Mac’s Keychain.
        </p>
        <PasswordInput
          label={connected ? 'New connection token' : 'Connection token'}
          value={token}
          onChange={(event) => setToken(event.currentTarget.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {error && (
          <p role="alert" className="sky-browser-error">
            {error}
          </p>
        )}
        <div className="sky-browser-manager-actions" style={{ marginTop: 16 }}>
          <Button
            disabled={!token.trim()}
            loading={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await browserSetupRequest('existing-browser', { token })
                setToken('')
                await reload()
                setOpened(false)
              } catch (error) {
                setError(browserSetupFailure(error))
              } finally {
                setBusy(false)
              }
            }}
          >
            {connected ? 'Update connection' : 'Use my Brave browser'}
          </Button>
          {connected && (
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  await browserSetupRequest('disconnect-browser', {})
                  await reload()
                  setOpened(false)
                  setToken('')
                } catch (error) {
                  setError(browserSetupFailure(error))
                } finally {
                  setBusy(false)
                }
              }}
            >
              Use Sky’s separate browser
            </Button>
          )}
        </div>
      </Modal>
    </>
  )
}
