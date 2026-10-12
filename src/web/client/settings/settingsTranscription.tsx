import { Anchor, Button, Select } from '@mantine/core'
import { useEffect, useState } from 'react'
import type { MacWhisperModels, TranscriptionSettings } from '#commands/all/audio/transcript/lib/models.ts'
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
  const [catalog, setCatalog] = useState<MacWhisperModels | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const local = settings.value.startsWith('macwhisper/')
  const selected = settings.choices.find((choice) =>
    local ? choice.provider === 'macwhisper' : choice.value === settings.value,
  )
  const automatic = catalog?.models.find((model) => model.current) ?? catalog?.models[0]
  const modelChoices = [
    { value: 'macwhisper/default', label: automatic ? `Automatic · ${automatic.name}` : 'Automatic' },
    ...(catalog?.models.map((model) => ({
      value: `macwhisper/${model.id}`,
      label: `${model.name}${model.size ? ` · ${model.size}` : ''}`,
    })) ?? []),
  ]
  const missingModel =
    local &&
    settings.value !== 'macwhisper/default' &&
    catalog?.available &&
    !modelChoices.some((model) => model.value === settings.value)
  if (missingModel) modelChoices.push({ value: settings.value, label: 'Saved model unavailable' })

  useEffect(() => {
    if (!local) return
    const controller = new AbortController()
    setLoadingModels(true)
    setCatalog(null)
    void fetch('/settings/_api/transcription/macwhisper', { signal: controller.signal })
      .then(async (response) => {
        const result = (await response.json()) as MacWhisperModels
        if (!response.ok) throw new Error(result.error ?? 'Could not load MacWhisper models.')
        if (!controller.signal.aborted) setCatalog(result)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setCatalog({
            available: false,
            models: [],
            error: error instanceof Error ? error.message : 'Could not load MacWhisper models.',
          })
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingModels(false)
      })
    return () => controller.abort()
  }, [local, refresh])

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
            value={selected?.value ?? settings.value}
            data={settings.choices.map(({ value, label }) => ({ value, label }))}
            onChange={(value) => void save(value)}
            allowDeselect={false}
            disabled={saving}
            w={220}
          />
        </Row>
        {selected ? (
          <>
            {local ? (
              <Row
                label="MacWhisper model"
                sub="Installed on the Mac running Sky. Download more models in MacWhisper, then refresh."
              >
                <Select
                  aria-label="MacWhisper model"
                  value={settings.value}
                  data={modelChoices}
                  onChange={(value) => void save(value)}
                  allowDeselect={false}
                  disabled={saving || loadingModels || !catalog?.models.length}
                  searchable
                  w={320}
                  maw="100%"
                />
              </Row>
            ) : (
              <Row label="Model">{mono(selected.model)}</Row>
            )}
            <Row
              label="Maximum file size"
              sub={
                <Anchor href={selected.docsUrl} target="_blank" rel="noreferrer" size="sm">
                  {local ? 'About local transcription' : 'Provider limits'}
                </Anchor>
              }
              last
            >
              <span className="sky-set-value">
                {selected.maxUploadMb === null ? 'No provider upload limit' : `${selected.maxUploadMb} MB per file`}
              </span>
            </Row>
            {local && (
              <>
                <p className="sky-set-note">
                  Audio is transcribed on your Mac. No API key is needed. Automatic uses MacWhisper’s selected local
                  model, or the first installed local model.
                </p>
                <Button
                  variant="subtle"
                  size="compact-sm"
                  onClick={() => setRefresh((value) => value + 1)}
                  disabled={loadingModels || saving}
                >
                  Refresh models
                </Button>
                {loadingModels && (
                  <p className="sky-set-note" role="status">
                    Loading MacWhisper models…
                  </p>
                )}
                {catalog?.error && (
                  <p className="sky-set-warn" role="alert">
                    {catalog.error}
                  </p>
                )}
                {catalog?.available && catalog.models.length === 0 && (
                  <p className="sky-set-note">
                    Download a local transcription model in MacWhisper, then refresh the models here.
                  </p>
                )}
                {missingModel && (
                  <p className="sky-set-warn" role="alert">
                    The saved model is no longer installed. Choose an available model or download it again in
                    MacWhisper.
                  </p>
                )}
              </>
            )}
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
      {selected?.apiKeyEnv && (
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
