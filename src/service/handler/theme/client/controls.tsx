import { Menu, Popover, SegmentedControl } from '@mantine/core'
import { Fragment, useState } from 'react'
import type { Chat } from './chat.tsx'

/**
 * The two things a thread is tuned with, under the composer: the model it
 * thinks with and how much of the notebook it reads before answering. Both
 * apply from the next message — the service refuses a change mid-turn, so
 * the controls sit a turn out with the composer.
 */

export interface ModelChoice {
  name: string
  label: string
  provider: string
  roles: string[]
}

export interface ThreadSettings {
  model: { current: string; default: string; choices: ModelChoice[] }
  contextTokens: number
  kept: number | null
  documents: number | null
}

/** Budgets to choose from; the thread's own joins them when it is none of these. */
const STOPS = [100_000, 150_000, 300_000, 500_000]

/** `300000` → `300k` — the strip and the stops speak in thousands. */
export function thousands(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

/** Roughly what a budget is in pages, for a person who has never counted a token. */
function pages(tokens: number): number {
  return Math.round((tokens * 0.75) / 500)
}

function Caret() {
  return (
    <svg
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 3.5 5 6.5 8 3.5" />
    </svg>
  )
}

function Check({ on }: { on: boolean }) {
  return (
    <span className="sky-ctl-check" data-on={on}>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 8.5 6.5 12 13 4.5" />
      </svg>
    </span>
  )
}

/** The model the thread thinks with — every configuration, grouped by provider, the current one ticked. */
export function ModelControl({ chat }: { chat: Chat }) {
  const { state, setModel } = chat
  const settings = state.settings
  if (!settings) return null
  const busy = state.phase !== 'idle'
  const current = settings.model.choices.find((c) => c.name === settings.model.current)
  const groups = new Map<string, ModelChoice[]>()
  for (const choice of settings.model.choices) {
    groups.set(choice.provider, [...(groups.get(choice.provider) ?? []), choice])
  }

  return (
    <Menu position="top-start" shadow="md" width={360} withinPortal>
      <Menu.Target>
        <button type="button" className="sky-ctl" disabled={busy} aria-label="Model">
          {current?.label ?? settings.model.current}
          <Caret />
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <div className="sky-ctl-head">Thinks with</div>
        {[...groups].map(([provider, choices]) => (
          <Fragment key={provider}>
            <Menu.Label>{provider}</Menu.Label>
            {choices.map((choice) => {
              const tags = [...choice.roles]
              if (choice.name === settings.model.default) tags.push('your default')
              return (
                <Menu.Item
                  key={choice.name}
                  onClick={() => void setModel(choice.name)}
                  leftSection={<Check on={choice.name === settings.model.current} />}
                  rightSection={
                    tags.length > 0 ? (
                      <span className="sky-chip sky-chip-sm" data-act="true">
                        {tags.join(' · ')}
                      </span>
                    ) : undefined
                  }
                >
                  {choice.label}
                </Menu.Item>
              )
            })}
          </Fragment>
        ))}
        <div className="sky-ctl-foot">Applies from your next message. Configurations live in Settings › AI.</div>
      </Menu.Dropdown>
    </Menu>
  )
}

/** How much sky reads before answering — the token ceiling on the assembled context, in stops. */
export function BudgetControl({ chat }: { chat: Chat }) {
  const { state, setContextTokens } = chat
  const [open, setOpen] = useState(false)
  const settings = state.settings
  if (!settings) return null
  const busy = state.phase !== 'idle'
  const tokens = settings.contextTokens
  const stops = [...new Set([...STOPS, tokens])].toSorted((a, b) => a - b)
  const fit =
    settings.kept !== null && settings.documents !== null
      ? ` Right now ${settings.kept} of ${settings.documents} files fit.`
      : ''

  return (
    <Popover position="top-start" shadow="md" width={420} withinPortal opened={open} onChange={setOpen}>
      <Popover.Target>
        <button
          type="button"
          className="sky-ctl"
          disabled={busy}
          onClick={() => setOpen((o) => !o)}
          aria-label="Reading budget"
        >
          Reads up to {thousands(tokens)}
          <Caret />
        </button>
      </Popover.Target>
      <Popover.Dropdown>
        <div className="sky-ctl-title">How much sky reads before answering</div>
        <SegmentedControl
          fullWidth
          value={String(tokens)}
          onChange={(value) => void setContextTokens(Number(value))}
          data={stops.map((stop) => ({ value: String(stop), label: thousands(stop) }))}
        />
        <p className="sky-ctl-note">
          {thousands(tokens)} tokens is about {pages(tokens)} pages.{fit} A smaller budget answers faster; a larger one
          reaches further back.
        </p>
        <div className="sky-ctl-foot">Applies from your next message.</div>
      </Popover.Dropdown>
    </Popover>
  )
}
