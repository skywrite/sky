import { Button, Modal, NumberInput, Select, Textarea, TextInput } from '@mantine/core'
import { useState } from 'react'
import { effortLevels, modelDefaultEffort, optionsWithoutEffort, type Effort } from '#universal/ai/effort.ts'
import { prettyModel, PROVIDER_LABEL } from '#universal/ai/modelName.ts'
import { EffortControl } from '../../lib/effortControl.tsx'
import type { ProfileRow } from '../settings.tsx'
import { refusalOf } from '../settingsBlocks.tsx'
import { editableEffort, effortText, presetTitle, roleLabel } from './presets.ts'

function advancedOptions(p: ProfileRow) {
  return JSON.stringify(editableEffort(p) === undefined ? (p.options ?? {}) : optionsWithoutEffort(p), null, 2)
}

function sameModel(a: ProfileRow, b: ProfileRow) {
  return a.provider === b.provider && a.model === b.model && a.baseUrl === b.baseUrl
}

export function PresetDialog({
  initial,
  profiles,
  providers,
  chat,
  onClose,
  onSaved,
}: {
  initial?: ProfileRow
  profiles: Map<string, ProfileRow>
  providers: string[]
  chat?: ProfileRow
  onClose: () => void
  onSaved: (message: string, created?: boolean) => Promise<void>
}) {
  const [draft, setDraft] = useState<ProfileRow>(
    () =>
      initial ?? {
        ...(chat ?? profiles.values().next().value ?? { provider: providers[0] ?? 'anthropic', model: '' }),
        name: '',
        builtin: false,
        roles: [],
      },
  )
  const [effort, setEffort] = useState<Effort | null | undefined>(() => editableEffort(draft))
  const [options, setOptions] = useState(() => advancedOptions(draft))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const models = [...profiles.values()].filter(
    (p, index, all) => all.findIndex((other) => sameModel(other, p)) === index,
  )
  const current = models.find((p) => sameModel(p, draft))
  const title = initial ? presetTitle(initial) : 'New language preset'
  const changeModel = (p: ProfileRow) => {
    setDraft({ ...p, name: draft.name, builtin: draft.builtin, roles: draft.roles })
    setEffort(editableEffort(p))
    setOptions(advancedOptions(p))
  }
  const changeIdentity = (field: 'model' | 'provider', value: string) => {
    const next = { ...draft, [field]: value }
    setDraft(next)
    setEffort(editableEffort({ ...next, options: {} }))
  }
  const save = async () => {
    if (busy) return
    const name = draft.name.trim()
    if (!initial && profiles.has(name)) {
      setError(`A preset named “${name}” already exists. Choose another name or edit that preset.`)
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(options)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    } catch {
      setError('Other provider options must be a JSON object.')
      return
    }
    setBusy(true)
    try {
      const failure = await refusalOf(
        await fetch('/settings/_api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            provider: draft.provider,
            model: draft.model.trim(),
            baseUrl: draft.baseUrl || undefined,
            contextWindow: draft.contextWindow,
            options: parsed,
            effort,
            createOnly: !initial,
          }),
        }).catch(() => null),
      )
      if (failure) setError(`Couldn’t save “${name}”. ${failure}`)
      else await onSaved(`${initial ? 'Saved' : 'Created'} ${name}.`, !initial)
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!initial || busy) return
    if (!confirming) {
      setConfirming(true)
      return
    }
    setBusy(true)
    try {
      const failure = await refusalOf(
        await fetch(`/settings/_api/profile/${encodeURIComponent(initial.name)}`, { method: 'DELETE' }).catch(
          () => null,
        ),
      )
      if (failure) setError(`Couldn’t ${initial.overrides ? 'restore' : 'delete'} “${initial.name}”. ${failure}`)
      else await onSaved(initial.overrides ? 'Built-in preset restored.' : 'Preset deleted.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      opened
      centered
      title={title}
      onClose={() => !busy && onClose()}
      closeOnEscape={!busy}
      closeOnClickOutside={!busy}
    >
      <form
        className="sky-model-form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <p className="sky-model-intro">
          {initial?.roles.length
            ? `Changes to this preset apply to ${initial.roles.map(roleLabel).join(' and ')}.`
            : 'Save a model and its settings for use across Sky.'}
        </p>
        {!initial && (
          <TextInput
            label="Preset name"
            placeholder="e.g. weekly-review"
            value={draft.name}
            required
            maxLength={64}
            onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
          />
        )}
        <Select
          label="Model"
          aria-label="Preset model"
          value={current?.name ?? '__custom__'}
          searchable
          allowDeselect={false}
          data={[
            ...models.map((p) => ({
              value: p.name,
              label: `${prettyModel(p.model)} · ${PROVIDER_LABEL[p.provider] ?? p.provider}`,
            })),
            { value: '__custom__', label: 'Custom model…' },
          ]}
          onChange={(name) => {
            const p = models.find((item) => item.name === name)
            changeModel(p ?? { ...draft, model: '', options: {}, baseUrl: undefined, contextWindow: undefined })
          }}
        />
        <div>
          <div className="sky-model-field-label">Default effort</div>
          {effort === undefined ? (
            <span className="sky-effort-fixed">{effortText(draft)} · Provider settings</span>
          ) : (
            <EffortControl
              key={`${draft.provider}/${draft.model}`}
              value={effort}
              defaultValue={modelDefaultEffort(draft)}
              levels={effortLevels(draft)}
              disabled={busy}
              onChange={setEffort}
            />
          )}
        </div>
        <details className="sky-model-advanced" open={!current || undefined}>
          <summary>Advanced options</summary>
          {initial && <p className="sky-model-caption">Preset name · {initial.name}</p>}
          <div className="sky-model-fields">
            <Select
              label="Provider"
              value={draft.provider}
              data={providers}
              allowDeselect={false}
              onChange={(provider) => {
                if (provider) changeIdentity('provider', provider)
              }}
            />
            <TextInput
              label="Model ID"
              value={draft.model}
              onChange={(event) => changeIdentity('model', event.currentTarget.value)}
            />
            <TextInput
              label="Server URL (optional)"
              placeholder="Provider default"
              value={draft.baseUrl ?? ''}
              onChange={(event) => setDraft({ ...draft, baseUrl: event.currentTarget.value || undefined })}
            />
            <NumberInput
              label="Context window (optional)"
              min={1}
              allowDecimal={false}
              placeholder="Tokens"
              value={draft.contextWindow ?? ''}
              onChange={(value) => setDraft({ ...draft, contextWindow: typeof value === 'number' ? value : undefined })}
            />
          </div>
          <Textarea
            label="Other options (JSON)"
            value={options}
            onChange={(event) => setOptions(event.currentTarget.value)}
            minRows={3}
            autosize
          />
        </details>
        {initial && !initial.builtin && (
          <div>
            {initial.roles.length > 0 && !initial.overrides ? (
              <p className="sky-model-caption">
                Choose another preset for {initial.roles.map(roleLabel).join(' and ')} before deleting this one.
              </p>
            ) : (
              <Button size="compact-sm" variant="danger-quiet" disabled={busy} onClick={() => void remove()}>
                {initial.overrides
                  ? confirming
                    ? 'Confirm restore'
                    : 'Restore built-in'
                  : confirming
                    ? 'Confirm delete'
                    : 'Delete preset'}
              </Button>
            )}
          </div>
        )}
        {error && (
          <p className="sky-set-warn" role="alert">
            {error}
          </p>
        )}
        <div className="sky-dialog-actions">
          <Button size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            variant="primary"
            loading={busy}
            disabled={!draft.name.trim() || !draft.model.trim()}
          >
            {initial ? 'Save preset' : 'Create preset'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
