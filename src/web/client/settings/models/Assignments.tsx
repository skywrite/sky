import type { ReactNode } from 'react'
import { prettyModel, PROVIDER_LABEL } from '#universal/ai/modelName.ts'
import type { ModelRow, ProfileRow, SettingsData } from '../settings.tsx'
import { EffortSummary } from './EffortSummary.tsx'
import { KeyStatus } from './KeyStatus.tsx'
import { ModelIcon } from './ModelIcon.tsx'
import { presetTitle, roleInfo, serviceTier } from './presets.ts'
import { assignmentsHref, roleHref } from './routes.ts'

function Feature({
  kind,
  title,
  model,
  description,
  status,
  action,
  href,
}: {
  kind: 'chat' | 'decision'
  title: string
  model: string
  description: string
  status?: ReactNode
  action: string
  href: string
}) {
  return (
    <article className="sky-model-feature" data-kind={kind}>
      <header>
        <span className="sky-model-kind-icon">
          <ModelIcon name={kind} />
        </span>
        <h2>{title}</h2>
      </header>
      <strong className="sky-model-name">{model}</strong>
      <p>{description}</p>
      <footer>
        {status}
        <a href={href}>
          {action}
          <ModelIcon name="right" />
        </a>
      </footer>
    </article>
  )
}

export function Assignments({ data, profiles }: { data: SettingsData; profiles: Map<string, ProfileRow> }) {
  const chat = data.models.find((row) => row.role === 'chat')
  const preset = chat && profiles.get(chat.profile)
  const decisions = data.decisions
  const taskRow = (role: ModelRow) => {
    const p = profiles.get(role.profile)
    const info = roleInfo(role.role)
    return (
      <a
        key={role.role}
        className="sky-model-row"
        href={roleHref(role.role)}
        aria-label={`Change preset for ${role.label}`}
        aria-describedby={`model-for-${role.role}`}
      >
        <span className="sky-model-cell">
          <span className="sky-model-row-icon">
            <ModelIcon name={info.icon} />
          </span>
          <span>
            <strong>{role.label}</strong>
            <small>{info.example}</small>
          </span>
        </span>
        <span className="sky-model-value" id={`model-for-${role.role}`}>
          {p ? presetTitle(p) : `${role.profile} (unavailable)`}
        </span>
        {p ? <EffortSummary profile={p} /> : <span>—</span>}
        <ModelIcon name="right" />
      </a>
    )
  }
  return (
    <>
      <section className="sky-model-features" aria-label="Chat and decision defaults">
        {chat && (
          <Feature
            kind="chat"
            title="New chats"
            model={preset ? prettyModel(preset.model) : 'Preset unavailable'}
            description={
              preset
                ? [
                    PROVIDER_LABEL[preset.provider] ?? preset.provider,
                    serviceTier(preset),
                    !preset.builtin && !preset.overrides && preset.name,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : `Choose a replacement for ${chat.profile}.`
            }
            status={preset && <EffortSummary profile={preset} full />}
            action="Change preset"
            href={roleHref('chat')}
          />
        )}
        <Feature
          kind="decision"
          title="Background decisions"
          model={decisions?.providerLabel ?? 'Decision settings unavailable'}
          description={
            decisions
              ? `Pinned to ${decisions.model} · Screening and scoring`
              : 'Reload settings to check the release and API key.'
          }
          status={decisions && <KeyStatus configured={decisions.configured} />}
          action={decisions && !decisions.configured ? 'Set up TypeSafe' : 'View details'}
          href={`${assignmentsHref}/decisions`}
        />
      </section>
      <section className="sky-model-tasks">
        <h2>Task defaults</h2>
        <div className="sky-model-columns" aria-hidden="true">
          <span>Used for</span>
          <span>Preset</span>
          <span>Default effort</span>
        </div>
        {data.models.filter((role) => role.role !== 'chat').map(taskRow)}
        <p className="sky-model-footnote">
          <ModelIcon name="info" />
          Changes apply to the next AI call. Each chat keeps its own overrides.
        </p>
      </section>
    </>
  )
}
