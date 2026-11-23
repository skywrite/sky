import { Select } from '@mantine/core'
import { useId } from 'react'
import { effortLabel, type Effort, type EffortOverride } from '#universal/ai/effort.ts'
import { formatTokens } from '#universal/ai/tokenUsage.ts'
import { EffortControl } from '../lib/effortControl.tsx'
import type { Chat } from './chat.tsx'
import './chatControls.css'

export interface ModelChoice {
  name: string
  label: string
  provider: string
  roles: string[]
  contextWindow?: number
  effort?: { default: Effort | null; levels: readonly Effort[] }
  group?: string
  builtin?: boolean
}

export interface ThreadSettings {
  model: { current: string; default: string; choices: ModelChoice[] }
  effort?: EffortOverride
  modelSettingsLocked: boolean
  /** What the chat's model leaves for the notebook, in its tokens; zero when it reads none. Not a choice. */
  contextTokens: number
  kept: number | null
  documents: number | null
  saves: boolean
}

/** Retain named presets while folding built-in variants that differ only by effort. */
function pickerChoices(settings: ThreadSettings): ModelChoice[] {
  const selected = new Map<string, ModelChoice>()
  for (const choice of settings.model.choices) {
    const key = choice.builtin && choice.group ? choice.group : choice.name
    const prior = selected.get(key)
    if (
      !prior ||
      choice.name === settings.model.current ||
      (prior.name !== settings.model.current && choice.name === settings.model.default)
    )
      selected.set(key, choice)
  }
  return [...selected.values()]
}

export function ChatControls({
  chat,
  open,
  onOpenChange,
}: {
  chat: Chat
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const panelId = useId()
  const { settings } = chat.state
  if (!settings) return null
  const current = settings.model.choices.find((choice) => choice.name === settings.model.current)
  const effort = settings.effort && settings.effort !== 'default' ? settings.effort : (current?.effort?.default ?? null)
  const locked = settings.modelSettingsLocked || chat.state.inherited > 0
  const disabled = locked || chat.state.phase !== 'idle' || !!chat.tuning
  // What the chat holds now, against all its model can hold. A model that declares no window shows the count alone.
  const held = chat.state.heldTokens ?? 0
  const max = current?.contextWindow
  const context = max ? `${formatTokens(held)} of ${formatTokens(max)}` : formatTokens(held)
  const choices = pickerChoices(settings)
  const providers = [...new Set(choices.map((choice) => choice.provider))]
  return (
    <div className="sky-chat-controls" data-expanded={open}>
      <div className="sky-chat-controls-surface">
        <button
          type="button"
          className="sky-chat-controls-toggle"
          aria-label="Chat settings"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onOpenChange(!open)}
        >
          <svg
            className="sky-chat-controls-icon"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            aria-hidden="true"
          >
            <path d="M3 5h3m4 0h7M3 15h7m4 0h3" />
            <circle cx="8" cy="5" r="2" />
            <circle cx="12" cy="15" r="2" />
          </svg>
          <span className="sky-chat-controls-model">{current?.label ?? settings.model.current}</span>
          <span className="sky-chat-controls-dot" aria-hidden="true">
            ·
          </span>
          <span>{effort ? `${effortLabel(effort)} effort` : 'Default effort'}</span>
          <span className="sky-chat-controls-dot" aria-hidden="true">
            ·
          </span>
          <span>{context} context</span>
          <svg
            className="sky-chat-controls-caret"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="m3 4.5 3 3 3-3" />
          </svg>
        </button>
        <section id={panelId} className="sky-chat-controls-panel" aria-label="Chat settings" hidden={!open}>
          <div className="sky-chat-controls-fields">
            <div className="sky-chat-context-field">
              <span>Context</span>
              {max ? (
                <div
                  className="sky-chat-context-meter"
                  role="meter"
                  aria-label="Context in use"
                  aria-valuemin={0}
                  aria-valuemax={max}
                  aria-valuenow={Math.min(held, max)}
                  aria-valuetext={`${context} tokens`}
                >
                  <span style={{ width: `${Math.min(100, (held / max) * 100)}%` }} />
                </div>
              ) : (
                <span />
              )}
              <strong>{context}</strong>
            </div>
            <div className="sky-chat-model-field">
              <span>Model</span>
              <Select
                aria-label="Model"
                value={settings.model.current}
                disabled={disabled}
                data={providers.map((provider) => ({
                  group: provider,
                  items: choices
                    .filter((choice) => choice.provider === provider)
                    .map((choice) => ({
                      value: choice.name,
                      label: choice.builtin === false ? `${choice.name} · ${choice.label}` : choice.label,
                    })),
                }))}
                onChange={(value) => {
                  if (value) void chat.setModel(value)
                }}
                allowDeselect={false}
                checkIconPosition="left"
              />
            </div>
            <div className="sky-chat-effort-field">
              <span>Effort</span>
              <EffortControl
                key={settings.model.current}
                value={effort}
                levels={current?.effort?.levels ?? []}
                disabled={disabled}
                inherited={!settings.effort || settings.effort === 'default'}
                resetLabel="Use preset default"
                onChange={(value) => chat.setEffort(value ?? 'default')}
              />
            </div>
          </div>
          <p className="sky-chat-controls-note sky-chat-controls-lock">
            {locked
              ? 'Model and effort are fixed for this chat and its branches. Start a new chat to change them.'
              : 'These settings become fixed after your first message, including in branches.'}
          </p>
        </section>
      </div>
      {chat.tuningError && (
        <p className="sky-chat-controls-error" role="alert">
          {chat.tuningError}
        </p>
      )}
    </div>
  )
}

export function TemporaryControl({ chat }: { chat: Chat }) {
  const settings = chat.state.settings
  if (!settings) return null
  return (
    <button
      type="button"
      className="sky-chat-temporary"
      role="switch"
      aria-label="Temporary chat"
      aria-checked={!settings.saves}
      disabled={chat.state.phase !== 'idle' || chat.tuning}
      onClick={() => void chat.setSaves(!settings.saves)}
      title={
        settings.saves
          ? 'Save this chat when you close it.'
          : 'No filed transcript or memories. Discard removes its temporary recovery copy.'
      }
    >
      <span className="sky-chat-temporary-track" aria-hidden="true">
        <span />
      </span>
      Temporary
    </button>
  )
}
