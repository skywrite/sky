import { Button, NumberInput, Select, Textarea, TextInput } from '@mantine/core'
import { useState, type Key } from 'react'
import { effortLabel, effortLevels, optionsWithEffort, presetEffort, type Effort } from '#universal/ai/effort.ts'
import { EffortControl } from './effortControl.tsx'
import type { ProfileRow, SettingsData } from './settings.tsx'
import { Block, refusalOf } from './settingsBlocks.tsx'
import './settingsModels.css'

function modelLabel(model: string): string {
  return model
    .split(/[-/]/)
    .map((word) => (/^gpt/i.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ')
    .replace(/ (\d+) (\d+)$/, ' $1.$2')
}

async function saveProfile(profile: ProfileRow, effort: Effort | null | undefined): Promise<string | null> {
  const response = await fetch('/settings/_api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: profile.name,
      provider: profile.provider,
      model: profile.model,
      baseUrl: profile.baseUrl || undefined,
      contextWindow: profile.contextWindow,
      options: profile.options,
      effort,
    }),
  }).catch(() => null)
  return refusalOf(response)
}

function PresetEditor({
  initial,
  profiles,
  providers,
  onDone,
  onCancel,
}: {
  initial?: ProfileRow
  key?: Key | null
  profiles: ProfileRow[]
  providers: string[]
  onDone: () => Promise<void>
  onCancel: () => void
}) {
  const seed = initial ?? {
    ...(profiles[0] ?? { provider: providers[0] ?? 'anthropic', model: '' }),
    name: '',
    builtin: false,
    roles: [],
  }
  const [draft, setDraft] = useState<ProfileRow>(seed)
  // Unknown provider-specific effort remains editable JSON and survives unrelated edits.
  const customEffort =
    seed.options?.[seed.provider === 'anthropic' ? 'effort' : 'reasoningEffort'] !== undefined &&
    presetEffort(seed) === null
  const [effort, setEffort] = useState<Effort | null | undefined>(customEffort ? undefined : presetEffort(seed))
  const [options, setOptions] = useState(
    JSON.stringify(customEffort ? seed.options : optionsWithEffort(seed, null), null, 2),
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const models = [
    ...new Map(
      [...profiles]
        .reverse()
        .map((profile) => [JSON.stringify([profile.provider, profile.model, profile.baseUrl]), profile]),
    ).values(),
  ]
  const current = models.find(
    (profile) =>
      profile.provider === draft.provider && profile.model === draft.model && profile.baseUrl === draft.baseUrl,
  )
  const save = async () => {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(options) as Record<string, unknown>
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    } catch {
      setError('Other options must be a JSON object.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const failure = await saveProfile({ ...draft, name: draft.name.trim(), options: parsed }, effort)
      setError(failure)
      if (!failure) await onDone()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="sky-preset-editor">
      {!initial && (
        <TextInput
          label="Preset name"
          placeholder="For example, deep-work"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
        />
      )}
      {initial?.roles.length ? (
        <p className="sky-preset-sharing">
          Used by {initial.roles.join(' and ')}. Changes apply wherever this preset is used.
        </p>
      ) : null}
      <div className="sky-preset-fields">
        <Select
          label="Model"
          aria-label="Preset model"
          value={current?.name ?? 'custom'}
          allowDeselect={false}
          data={[
            ...models.map((profile) => ({
              value: profile.name,
              label: `${modelLabel(profile.model)} · ${profile.provider}`,
            })),
            { value: 'custom', label: 'Custom model…' },
          ]}
          onChange={(name) => {
            const chosen = models.find((profile) => profile.name === name)
            if (!chosen) {
              setDraft({ ...draft, model: '' })
              return
            }
            setDraft({ ...chosen, name: draft.name, builtin: draft.builtin, roles: draft.roles })
            setEffort(presetEffort(chosen))
            setOptions(JSON.stringify(optionsWithEffort(chosen, null), null, 2))
          }}
        />
        <div>
          <label className="sky-preset-effort-label">Default effort</label>
          {effort === undefined ? (
            <span className="sky-effort-fixed">Set in advanced options</span>
          ) : (
            <EffortControl
              key={`${draft.provider}/${draft.model}`}
              value={effort}
              levels={effortLevels(draft)}
              onChange={setEffort}
            />
          )}
        </div>
      </div>
      <details className="sky-preset-advanced" open={!current || undefined}>
        <summary>Advanced options</summary>
        <div className="sky-preset-fields">
          <Select
            label="Provider"
            value={draft.provider}
            data={providers}
            onChange={(value) => {
              if (value) {
                setDraft({ ...draft, provider: value })
                setEffort(null)
              }
            }}
          />
          <TextInput
            label="Model ID"
            value={draft.model}
            onChange={(event) => {
              setDraft({ ...draft, model: event.currentTarget.value })
              setEffort(null)
            }}
          />
          <TextInput
            label="Server URL (optional)"
            placeholder="Use the provider’s default server"
            value={draft.baseUrl ?? ''}
            onChange={(event) => setDraft({ ...draft, baseUrl: event.currentTarget.value || undefined })}
          />
          <NumberInput
            label="Context window (optional)"
            min={1}
            allowDecimal={false}
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
        {initial && (
          <p className="sky-preset-id">
            Preset name: <code>{initial.name}</code>
          </p>
        )}
      </details>
      {error && (
        <p className="sky-set-warn" role="alert">
          {error}
        </p>
      )}
      <div className="sky-set-form-foot">
        <Button
          variant="primary"
          size="sm"
          disabled={busy || !draft.name.trim() || !draft.model.trim()}
          onClick={() => void save()}
        >
          Save preset
        </Button>
        <Button size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function AIPane({ data, reload }: { data: SettingsData; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('Changes apply to the next AI call. Chat effort overrides stay with the chat.')
  const [confirming, setConfirming] = useState<string | null>(null)
  // The API keeps the built-in row for Restore; every control uses the effective definition.
  const profiles = [...new Map([...data.profiles].reverse().map((profile) => [profile.name, profile])).values()]
  const used = profiles.filter((profile) => profile.roles.length > 0)
  const others = profiles.filter((profile) => profile.roles.length === 0)
  const update = async (write: () => Promise<string | null>, message: string) => {
    setBusy(true)
    setError(null)
    try {
      const failure = await write()
      setError(failure)
      if (!failure) {
        setNotice(message)
        await reload()
      }
    } finally {
      setBusy(false)
    }
  }
  const done = async () => {
    setEditing(null)
    await reload()
  }
  return (
    <>
      {error && (
        <p className="sky-set-warn" role="alert">
          {error}
        </p>
      )}
      <Block head="Default presets" note="Choose a preset for each kind of work. Adjust its default effort here.">
        <div className="sky-ai-role-head" aria-hidden="true">
          <span>Used for</span>
          <span>Preset</span>
          <span>Default effort</span>
        </div>
        {data.models.map((role) => {
          const profile = profiles.find((profile) => profile.name === role.profile)
          return (
            <div className="sky-ai-role" key={role.role}>
              <label className="sky-ai-role-label" htmlFor={`ai-role-${role.role}`}>
                {role.label}
              </label>
              <div>
                <Select
                  id={`ai-role-${role.role}`}
                  aria-label={`Default preset for ${role.label}`}
                  value={profile?.name ?? null}
                  placeholder="Choose a preset"
                  allowDeselect={false}
                  searchable
                  disabled={busy}
                  data={profiles.map((preset) => ({ value: preset.name, label: preset.name }))}
                  onChange={(value) => {
                    if (value)
                      void update(
                        async () =>
                          refusalOf(
                            await fetch('/settings/_api/set', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ key: `ai.roles.${role.role}`, value }),
                            }).catch(() => null),
                          ),
                        `${role.label} now uses ${value}.`,
                      )
                  }}
                />
                {profile && <p className="sky-ai-role-model">{modelLabel(profile.model)}</p>}
              </div>
              {profile ? (
                <div>
                  <EffortControl
                    label={`Default effort for ${role.label}`}
                    value={presetEffort(profile)}
                    levels={effortLevels(profile)}
                    disabled={busy}
                    onChange={(value) =>
                      update(
                        () => saveProfile(profile, value),
                        `${profile.name} saved.${profile.roles.length > 1 ? ` Used by ${profile.roles.join(' and ')}.` : ''}`,
                      )
                    }
                  />
                  {profile.roles.length > 1 && (
                    <p className="sky-ai-role-shared">Shared by {profile.roles.join(' and ')}</p>
                  )}
                </div>
              ) : (
                <span className="sky-effort-fixed">Choose a preset first</span>
              )}
            </div>
          )
        })}
        <p className="sky-ai-role-status" role="status">
          {notice}
        </p>
      </Block>
      <Block
        head="Presets"
        note="A model, its default effort, and any provider options. Chat and command overrides leave these defaults unchanged."
      >
        {[...used, ...(more ? others : others.filter((profile) => !profile.builtin))].map((profile) => (
          <div key={profile.name} className="sky-preset" data-open={editing === profile.name}>
            <button
              type="button"
              className="sky-preset-toggle"
              aria-expanded={editing === profile.name}
              onClick={() => setEditing(editing === profile.name ? null : profile.name)}
            >
              <span>
                <strong>{profile.name}</strong>
                <span>
                  {modelLabel(profile.model)} · {profile.provider}
                  {profile.roles.length ? ` · ${profile.roles.join(' & ')}` : ''}
                </span>
              </span>
              <span>{effortLabel(presetEffort(profile))}</span>
              <span aria-hidden="true">{editing === profile.name ? '⌃' : '⌄'}</span>
            </button>
            {editing === profile.name && (
              <>
                <PresetEditor
                  key={profile.name}
                  initial={profile}
                  profiles={profiles}
                  providers={data.providers}
                  onDone={done}
                  onCancel={() => setEditing(null)}
                />
                {!profile.builtin && (
                  <div className="sky-preset-remove">
                    <Button
                      size="compact-sm"
                      disabled={busy}
                      onClick={() => {
                        if (confirming !== profile.name) {
                          setConfirming(profile.name)
                          return
                        }
                        setConfirming(null)
                        void update(
                          async () =>
                            refusalOf(
                              await fetch(`/settings/_api/profile/${encodeURIComponent(profile.name)}`, {
                                method: 'DELETE',
                              }).catch(() => null),
                            ),
                          profile.overrides ? 'Built-in preset restored.' : 'Preset deleted.',
                        )
                      }}
                    >
                      {confirming === profile.name
                        ? profile.overrides
                          ? 'Confirm restore'
                          : 'Confirm delete'
                        : profile.overrides
                          ? 'Restore built-in'
                          : 'Delete preset'}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        {others.some((profile) => profile.builtin) && (
          <Button size="sm" aria-expanded={more} onClick={() => setMore(!more)}>
            {more ? 'Show fewer presets' : 'Show all presets'}
          </Button>
        )}
        {editing === 'new' ? (
          <PresetEditor
            profiles={profiles}
            providers={data.providers}
            onDone={done}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div className="sky-set-foot">
            <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
              ＋ New preset
            </Button>
          </div>
        )}
      </Block>
    </>
  )
}
