import { Button, Modal, PasswordInput, TextInput } from '@mantine/core'
import { useState } from 'react'
import type { MapsConfig } from '../../places/types.ts'
import { placesApi } from './placesApi.ts'

export function PlacesSetup({
  config,
  onClose,
  onSaved,
}: {
  config: MapsConfig
  onClose: () => void
  onSaved: (config: MapsConfig) => void
}) {
  const [browserKey, setBrowserKey] = useState(''),
    [serverKey, setServerKey] = useState(''),
    [mapId, setMapId] = useState(config.mapId)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  return (
    <Modal
      opened
      onClose={busy ? () => {} : onClose}
      title="Connect Google Maps"
      size="lg"
      centered
      className="sky-places-dialog"
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
      withCloseButton={!busy}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          setBusy(true)
          setError('')
          try {
            const next = await placesApi<MapsConfig>('/maps', {
              ...(browserKey.trim() ? { browserKey: browserKey.trim() } : {}),
              ...(serverKey.trim() ? { serverKey: serverKey.trim() } : {}),
              ...(mapId.trim() ? { mapId: mapId.trim() } : {}),
            })
            onSaved(next)
          } catch (error) {
            setError((error as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <p className="sky-places-lead">
          Use your Google Cloud project to show maps and find places. You can always add and organize places manually.
        </p>
        <div className="sky-places-form">
          <PasswordInput
            label="Browser map key"
            description={
              config.browserKey
                ? 'A map key is already connected. Leave blank to keep using it.'
                : 'Enable Maps JavaScript API. Restrict this key to your Sky website and that API.'
            }
            placeholder="Paste a browser API key"
            autoComplete="off"
            value={browserKey}
            onChange={(event) => setBrowserKey(event.currentTarget.value)}
          />
          <p className="sky-places-setup-hint">
            Add <code>{window.location.origin}/*</code> to the key’s website restrictions. This key is visible in the
            browser. A separate browser key lets you restrict maps and server lookups independently.
          </p>
          <PasswordInput
            label="Places search key"
            description={
              config.searchAvailable
                ? 'Your existing Places key is available. Leave blank to keep it.'
                : 'Enable Places API (New) on this server key. It stays in Sky’s keychain.'
            }
            placeholder="Paste a server API key (optional)"
            autoComplete="off"
            value={serverKey}
            onChange={(event) => setServerKey(event.currentTarget.value)}
          />
          <TextInput
            label="Map ID"
            description="Optional. Use your Google Cloud map ID to apply a custom map style."
            placeholder="Google’s default map"
            value={mapId}
            onChange={(event) => setMapId(event.currentTarget.value)}
          />
          <p className="sky-places-setup-hint">
            Google requires billing to be enabled, with usage subject to its free allowances and pricing.{' '}
            <a
              href="https://developers.google.com/maps/documentation/javascript/get-api-key"
              target="_blank"
              rel="noreferrer"
            >
              Set up a Google Maps key ↗
            </a>
          </p>
          {config.message && <p role="status">{config.message}</p>}
          {error && (
            <p className="sky-places-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="sky-places-dialog-footer">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={!browserKey.trim() && !serverKey.trim() && mapId === config.mapId}
          >
            Save connection
          </Button>
        </div>
      </form>
    </Modal>
  )
}
