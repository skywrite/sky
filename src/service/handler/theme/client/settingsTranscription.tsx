import { Anchor, Select } from '@mantine/core'
import { useState } from 'react'
import type { TranscriptionSettings } from '#commands/all/audio/transcript/lib/models.ts'
import { saveSetting } from './settings.tsx'
import { Block, mono, Row } from './settingsBlocks.tsx'

export function TranscriptionPane({
  settings,
  reload,
}: {
  settings: TranscriptionSettings
  reload: () => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selected = settings.choices.find((choice) => choice.value === settings.value)

  const save = async (value: string | null) => {
    if (!value || value === settings.value) return
    setSaving(true)
    setNote(null)
    setError(null)
    try {
      const refusal = await saveSetting('ai.models.transcription', value)
      if (refusal) setError(refusal)
      else {
        await reload()
        setNote('Saved. New transcriptions will use this provider.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Block>
        <Row label="Transcription provider" sub="Used for audio imports, recordings, and Slack voice notes.">
          <Select
            aria-label="Transcription provider"
            value={settings.value}
            data={settings.choices.map(({ value, label }) => ({ value, label }))}
            onChange={(value) => void save(value)}
            allowDeselect={false}
            disabled={saving}
            w={180}
          />
        </Row>
        {selected ? (
          <>
            <Row label="Model">{mono(selected.model)}</Row>
            <Row
              label="Maximum file size"
              sub={
                <Anchor href={selected.docsUrl} target="_blank" rel="noreferrer" size="sm">
                  Provider limits
                </Anchor>
              }
              last
            >
              <span className="sky-set-value">{selected.maxUploadMb} MB per file</span>
            </Row>
          </>
        ) : (
          <p className="sky-set-warn">Choose a supported transcription provider.</p>
        )}
        <p className="sky-set-note">
          Your choice applies to new transcriptions. A resumed import keeps its saved transcript; choose Start over to
          transcribe it again.
        </p>
        {saving && (
          <p className="sky-set-note" role="status">
            Saving…
          </p>
        )}
        {note && (
          <p className="sky-set-success" role="status">
            {note}
          </p>
        )}
        {error && (
          <p className="sky-set-warn" role="alert">
            {error}
          </p>
        )}
      </Block>
      {selected && (
        <Block head="API access">
          <Row
            label={`${selected.label} API key`}
            sub={
              selected.configured ? (
                'Available to the Sky service.'
              ) : (
                <>
                  Add <code>{selected.apiKeyEnv}</code> to Sky’s <code>src/.env</code> file, then restart the service.
                </>
              )
            }
            last
          >
            <span className={selected.configured ? 'sky-set-status' : 'sky-set-off'}>
              {selected.configured ? 'Configured' : 'Not configured'}
            </span>
          </Row>
        </Block>
      )}
    </>
  )
}
