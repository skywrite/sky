import { Button, Modal, Select } from '@mantine/core'
import { useState } from 'react'
import { effortLevels, hasCustomEffort, modelDefaultEffort, presetEffort, type Effort } from '#universal/ai/effort.ts'
import { PROVIDER_LABEL } from '#universal/ai/modelName.ts'
import { EffortControl } from '../../lib/effortControl.tsx'
import type { ModelRow, ProfileRow } from '../settings.tsx'
import { refusalOf } from '../settingsBlocks.tsx'
import { effortText, presetTitle, roleInfo, roleLabel } from './presets.ts'

export function AssignmentDialog({
  role,
  profiles,
  onClose,
  onSaved,
}: {
  role: ModelRow
  profiles: Map<string, ProfileRow>
  onClose: () => void
  onSaved: (notice: string) => Promise<void>
}) {
  const [name, setName] = useState(role.profile)
  const [effort, setEffort] = useState<Effort | null | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const preset = profiles.get(name)
  const presets = [...profiles.values()]
  const providers = [...new Set(presets.map((p) => p.provider))]
  const groups = providers
    .map((provider) => ({
      group: PROVIDER_LABEL[provider] ?? provider,
      items: presets
        .filter((p) => p.provider === provider)
        .map((p) => ({ value: p.name, label: `${presetTitle(p)} · ${effortText(p, true)}` })),
    }))
    .sort((a, b) => a.group.localeCompare(b.group))
  const others = preset?.roles.filter((r) => r !== role.label).map(roleLabel) ?? []
  const title = role.role === 'chat' ? 'New chat preset' : `${role.label} preset`
  const save = async () => {
    if (!preset || busy) return
    const changedEffort = effort !== undefined && effort !== presetEffort(preset)
    if (name === role.profile && !changedEffort) {
      onClose()
      return
    }
    setBusy(true)
    setError('')
    try {
      const failure = await refusalOf(
        await fetch('/settings/_api/set', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: `ai.roles.${role.role}`,
            value: name,
            effort: changedEffort ? effort : undefined,
          }),
        }).catch(() => null),
      )
      if (failure) setError(`Couldn’t save the ${role.label} assignment. ${failure}`)
      else await onSaved(`${roleLabel(role.label)} now uses ${presetTitle(preset)}.`)
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
        <p className="sky-model-intro">{roleInfo(role.role).example}</p>
        <Select
          label="Preset"
          aria-label={`Default preset for ${role.label}`}
          allowDeselect={false}
          searchable
          placeholder="Choose a preset"
          nothingFoundMessage="No matching presets"
          value={preset?.name ?? null}
          disabled={busy}
          classNames={{ groupLabel: 'sky-model-provider-heading', option: 'sky-model-preset-option' }}
          data={groups}
          filter={({ search }) => {
            const query = search.trim().toLowerCase()
            if (!query) return groups
            return groups.flatMap(({ group, items }) => {
              const matches = items.filter(({ label, value }) =>
                `${group} ${label} ${value}`.toLowerCase().includes(query),
              )
              return matches.length ? [{ group, items: matches }] : []
            })
          }}
          renderOption={({ option }) => (
            <span className="sky-model-option">
              {option.label}
              <small>{option.value}</small>
            </span>
          )}
          onChange={(value) => {
            if (value) {
              setName(value)
              setEffort(undefined)
            }
          }}
        />
        {preset ? (
          <>
            <p className="sky-model-caption">
              {PROVIDER_LABEL[preset.provider] ?? preset.provider} · {preset.name}
            </p>
            <div>
              <div className="sky-model-field-label">Default effort</div>
              {hasCustomEffort(preset) ? (
                <span className="sky-effort-fixed">Set in advanced options</span>
              ) : (
                <EffortControl
                  key={name}
                  label={`Default effort for ${role.label}`}
                  levels={effortLevels(preset)}
                  disabled={busy}
                  value={effort === undefined ? presetEffort(preset) : effort}
                  defaultValue={modelDefaultEffort(preset)}
                  onChange={setEffort}
                />
              )}
            </div>
            {others.length > 0 && (
              <p className="sky-model-impact">Changing this preset’s effort also updates {others.join(' and ')}.</p>
            )}
          </>
        ) : (
          <p className="sky-model-impact">
            The assigned preset “{role.profile}” is unavailable. Choose another preset to continue.
          </p>
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
          <Button size="sm" variant="primary" type="submit" loading={busy} disabled={!preset}>
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  )
}
