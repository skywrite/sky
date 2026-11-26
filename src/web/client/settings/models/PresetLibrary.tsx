import { Button, SegmentedControl, TextInput } from '@mantine/core'
import { useState } from 'react'
import { prettyModel, PROVIDER_LABEL } from '#universal/ai/modelName.ts'
import type { ProfileRow, SettingsData } from '../settings.tsx'
import { EffortSummary } from './EffortSummary.tsx'
import { ModelIcon } from './ModelIcon.tsx'
import { PresetDialog } from './PresetDialog.tsx'
import { effortText, presetTitle, roleLabel } from './presets.ts'
import { libraryHref, presetHref } from './routes.ts'

interface LibraryRow {
  title: string
  meta: string
  roles: string[]
  profile?: ProfileRow
  href: string
  keywords: string[]
  custom: boolean
}

export function PresetLibrary({
  data,
  profiles,
  editing,
  onClose,
  onSaved,
}: {
  data: SettingsData
  profiles: Map<string, ProfileRow>
  editing?: 'new' | ProfileRow
  onClose: () => void
  onSaved: (message: string) => Promise<void>
}) {
  const [filter, setFilter] = useState('used')
  const [query, setQuery] = useState('')
  const chat = data.models.find((model) => model.role === 'chat')
  const decision = data.decisions
  const names = new Set([...data.models.map((row) => row.profile), ...profiles.keys()])
  const rows = [...names].flatMap<LibraryRow>((name) => {
    const p = profiles.get(name)
    if (!p) return []
    const provider = PROVIDER_LABEL[p.provider] ?? p.provider
    return [
      {
        title: presetTitle(p),
        meta: `${provider} · ${p.builtin || p.overrides ? name : prettyModel(p.model)}`,
        roles: p.roles.map(roleLabel),
        profile: p,
        href: presetHref(name),
        keywords: [p.name, p.model, p.provider, effortText(p)],
        custom: !p.builtin,
      },
    ]
  })
  if (decision) {
    rows.splice(chat && profiles.has(chat.profile) ? 1 : 0, 0, {
      title: decision.providerLabel,
      meta: decision.model,
      roles: ['Background decisions'],
      href: `${libraryHref}/decisions`,
      keywords: [decision.provider, decision.profile ?? '', 'pinned release'],
      custom: false,
    })
  }
  const matches = rows.filter(
    (row) =>
      (filter !== 'used' || row.roles.length) &&
      (filter !== 'custom' || row.custom) &&
      [row.title, row.meta, ...row.roles, ...row.keywords].join(' ').toLowerCase().includes(query.trim().toLowerCase()),
  )
  const customEmpty = filter === 'custom' && !query.trim()
  return (
    <section className="sky-model-library">
      <header>
        <div>
          <h2>Preset library</h2>
          <p>Model and provider settings shared by the roles that use them.</p>
        </div>
        <Button
          component="a"
          href={`${libraryHref}/new`}
          variant="primary"
          size="sm"
          leftSection={<ModelIcon name="plus" />}
        >
          New preset
        </Button>
      </header>
      <div className="sky-model-tools">
        <TextInput
          type="search"
          aria-label="Search presets"
          placeholder="Search presets…"
          leftSection={<ModelIcon name="search" />}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <SegmentedControl
          aria-label="Filter presets"
          value={filter}
          onChange={setFilter}
          data={[
            { value: 'used', label: 'In use' },
            { value: 'all', label: 'All' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
      </div>
      {matches.length ? (
        <>
          <div className="sky-model-columns" aria-hidden="true">
            <span>Preset</span>
            <span>Used for</span>
            <span>Configuration</span>
          </div>
          {matches.map((row) => (
            <a className="sky-model-row" key={row.href} href={row.href}>
              <span className="sky-model-cell">
                <span className="sky-model-kind-icon" data-kind={row.profile ? 'chat' : 'decision'}>
                  <ModelIcon name={row.profile ? 'layers' : 'decision'} />
                </span>
                <span>
                  <strong>{row.title}</strong>
                  <small>{row.meta}</small>
                </span>
              </span>
              <span className="sky-model-value">{row.roles.join(' and ') || 'Unassigned'}</span>
              {row.profile ? (
                <EffortSummary profile={row.profile} full />
              ) : (
                <span className="sky-model-effort">
                  <ModelIcon name="pin" />
                  Pinned release
                </span>
              )}
              <ModelIcon name="right" />
            </a>
          ))}
        </>
      ) : (
        <div className="sky-model-empty" role="status">
          <strong>{customEmpty ? 'No custom presets yet' : 'No matching presets'}</strong>
          <p>
            {customEmpty
              ? 'Save a model with the settings you want to use again.'
              : 'Try another model, provider, or role name.'}
          </p>
          {customEmpty ? (
            <Button component="a" size="sm" href={`${libraryHref}/new`}>
              Create a preset
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                setFilter('all')
                setQuery('')
              }}
            >
              Show all presets
            </Button>
          )}
        </div>
      )}
      {editing && (
        <PresetDialog
          key={editing === 'new' ? 'new' : `edit/${editing.name}`}
          initial={editing === 'new' ? undefined : editing}
          profiles={profiles}
          providers={data.providers}
          chat={chat && profiles.get(chat.profile)}
          onClose={onClose}
          onSaved={async (message, created) => {
            if (created) {
              setFilter('custom')
              setQuery('')
            }
            await onSaved(message)
          }}
        />
      )}
    </section>
  )
}
