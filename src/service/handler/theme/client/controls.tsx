import { Select, Slider } from '@mantine/core'
import { useId, useState, type Key } from 'react'
import { effortLabel, type Effort, type EffortOverride } from '#universal/ai/effort.ts'
import { reachIndex, STOPS, stopIndex } from '#universal/ai/readingBudget.ts'
import type { Chat } from './chat.tsx'
import { EffortControl } from './effortControl.tsx'
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
  contextTokens: number
  kept: number | null
  documents: number | null
  saves: boolean
}

export function thousands(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
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
  key?: Key | null
}) {
  const [budget, setBudget] = useState<number | null>(null)
  const panelId = useId()
  const { settings } = chat.state
  if (!settings) return null
  const current = settings.model.choices.find((choice) => choice.name === settings.model.current)
  const effort = settings.effort && settings.effort !== 'default' ? settings.effort : (current?.effort?.default ?? null)
  const busy = chat.state.phase !== 'idle' || chat.tuning
  const reach = reachIndex(current?.contextWindow)
  const at = Math.min(budget ?? stopIndex(settings.contextTokens), reach)
  const tokens = budget === null ? settings.contextTokens : STOPS[at]
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
          <span>{tokens === 0 ? 'Context off' : `${thousands(tokens)} context`}</span>
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
              <span>Notebook context</span>
              <Slider
                className="sky-budget"
                min={0}
                max={reach}
                domain={[0, STOPS.length - 1]}
                step={1}
                value={at}
                disabled={busy}
                onChange={setBudget}
                onChangeEnd={(index) => {
                  if (STOPS[index] !== settings.contextTokens)
                    void chat.setContextTokens(STOPS[index]).finally(() => setBudget(null))
                  else setBudget(null)
                }}
                marks={STOPS.map((stop, index) => ({
                  value: index,
                  label: <span data-off={index > reach || undefined}>{stop === 0 ? 'Off' : thousands(stop)}</span>,
                }))}
                label={null}
                thumbLabel="Notebook context"
              />
              <strong>{tokens === 0 ? 'Off' : thousands(tokens)}</strong>
            </div>
            <div className="sky-chat-model-field">
              <span>Model</span>
              <Select
                aria-label="Model"
                value={settings.model.current}
                disabled={busy}
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
                disabled={busy}
                inherited={!settings.effort || settings.effort === 'default'}
                resetLabel="Use preset default"
                onChange={(value) => chat.setEffort(value ?? 'default')}
              />
            </div>
          </div>
          {reach < STOPS.length - 1 && (
            <p className="sky-chat-controls-note">
              This model supports up to {thousands(STOPS[reach])} of notebook context.
            </p>
          )}
          <p className="sky-chat-controls-note">
            An estimated notebook allowance. Sky reads less when needed to leave room for the conversation and reply.
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
