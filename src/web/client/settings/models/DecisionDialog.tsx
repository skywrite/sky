import { Button, Modal } from '@mantine/core'
import type { DecisionSettings } from '../settings.tsx'
import { connectionHref } from '../settingsRoutes.ts'
import { KeyStatus } from './KeyStatus.tsx'
import { ModelIcon } from './ModelIcon.tsx'

export function DecisionDialog({
  decisions,
  onClose,
  reload,
}: {
  decisions?: DecisionSettings
  onClose: () => void
  reload: () => Promise<void>
}) {
  return (
    <Modal opened centered title="Background decisions" onClose={onClose}>
      {decisions ? (
        <>
          <p className="sky-model-intro">
            Sky uses this model to classify messages, screen replies, and score their priority.
          </p>
          <div className="sky-model-release">
            <strong>{decisions.providerLabel}</strong>
            <div>
              <ModelIcon name="pin" /> {decisions.model} · Pinned release
            </div>
            <p>
              Sky’s scoring thresholds were calibrated on this release. Keeping it pinned makes the scores consistent.
            </p>
          </div>
          <section className="sky-model-access">
            <header>
              <h3>TypeSafe API access</h3>
              <KeyStatus configured={decisions.configured} />
            </header>
            <p>
              {decisions.configured
                ? 'Sky can use the saved TypeSafe key for decision requests.'
                : 'Add a TypeSafe API key in Connections to enable background decisions.'}
            </p>
          </section>
        </>
      ) : (
        <p className="sky-model-intro">Sky couldn’t load the decision model or its connection status.</p>
      )}
      <div className="sky-dialog-actions">
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
        {decisions ? (
          <Button
            size="sm"
            variant="primary"
            component="a"
            href={connectionHref('typesafe')}
            target="_blank"
            rel="noopener"
            rightSection={<ModelIcon name="external" />}
          >
            {decisions.configured ? 'Manage connection' : 'Open TypeSafe connection'}
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => void reload()}>
            Reload settings
          </Button>
        )}
      </div>
    </Modal>
  )
}
