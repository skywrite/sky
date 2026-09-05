import { Menu, Popover, SegmentedControl, Slider } from '@mantine/core'
import { Fragment, useEffect, useRef, useState } from 'react'
import { reachIndex, STOPS, stopIndex } from '#universal/ai/readingBudget.ts'
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
  /** Tokens the host serves in one request; absent when the model takes any budget */
  contextWindow?: number
}

export interface ThreadSettings {
  model: { current: string; default: string; choices: ModelChoice[] }
  contextTokens: number
  kept: number | null
  documents: number | null
  /** Whether closing the thread files it; false keeps nothing of it */
  saves: boolean
}

/** What a stop is called on the slider and in the strip. */
function stopLabel(tokens: number): string {
  return tokens === 0 ? 'Nothing' : thousands(tokens)
}

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

/**
 * How much sky reads before answering — the token ceiling on the assembled
 * context, on a slider with seven stops. Nothing keeps the notebook closed:
 * sky answers from the conversation and its tools until a budget opens it
 * again. The thumb follows the drag; the budget changes when it is let go.
 * A model whose host serves less than the stops ask ends the slider at the
 * last stop that fits; the stops past it stay drawn, grayed, out of reach.
 *
 * The slider reports a pointer's position a frame late and its release at
 * once, so a quick tap is released before its stop arrives. The stop is kept
 * as it arrives and committed on release when it is known, else as soon as
 * the slider has been still for a moment — a tap, a drag and an arrow key
 * all land, once.
 */
export function BudgetControl({ chat }: { chat: Chat }) {
  const { state, setContextTokens } = chat
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState<number | null>(null)
  const [pending, setPending] = useState<number | null>(null)
  const latest = useRef<number | null>(null)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const committed = useRef(0)
  const settings = state.settings
  const tokens = settings?.contextTokens ?? 0
  committed.current = tokens
  useEffect(() => () => clearTimeout(settle.current ?? undefined), [])
  if (!settings) return null
  const busy = state.phase !== 'idle'
  const current = settings.model.choices.find((c) => c.name === settings.model.current)
  const reach = reachIndex(current?.contextWindow)
  const capped = reach < STOPS.length - 1
  const at = Math.min(dragging ?? pending ?? stopIndex(tokens), reach)
  const shown = STOPS[at]
  const fit =
    settings.kept !== null && settings.documents !== null
      ? ` Right now ${settings.kept} of ${settings.documents} files fit.`
      : ''

  const commit = () => {
    if (settle.current) clearTimeout(settle.current)
    settle.current = null
    const i = latest.current
    latest.current = null
    setDragging(null)
    if (i === null || STOPS[i] === committed.current) return
    setPending(i)
    void setContextTokens(STOPS[i]).finally(() => setPending(null))
  }
  const moved = (i: number) => {
    latest.current = i
    setDragging(i)
    if (settle.current) clearTimeout(settle.current)
    settle.current = setTimeout(commit, 500)
  }

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
          {tokens === 0 ? 'Reads nothing' : `Reads up to ${thousands(tokens)}`}
          <Caret />
        </button>
      </Popover.Target>
      <Popover.Dropdown>
        <div className="sky-ctl-title">How much sky reads before answering</div>
        <Slider
          className="sky-budget"
          min={0}
          max={reach}
          domain={[0, STOPS.length - 1]}
          step={1}
          value={at}
          onChange={moved}
          onChangeEnd={() => {
            if (latest.current !== null) commit()
          }}
          marks={STOPS.map((stop, i) => ({
            value: i,
            label: <span data-off={i > reach || undefined}>{stopLabel(stop)}</span>,
          }))}
          label={null}
          thumbLabel="Reading budget"
        />
        <p className="sky-ctl-note">
          {shown === 0
            ? 'Your notebook stays closed: sky answers from this conversation and the tools it calls. Slide right to open it again.'
            : `${thousands(shown)} tokens is about ${pages(shown)} pages.${fit} A smaller budget answers faster; a larger one reaches further back.`}
          {capped && current
            ? ` ${current.label} takes ${thousands(current.contextWindow ?? 0)} tokens in all, so the stops past ${stopLabel(STOPS[reach])} are out of its reach.`
            : ''}
        </p>
        <div className="sky-ctl-foot">Applies from your next message.</div>
      </Popover.Dropdown>
    </Popover>
  )
}

/**
 * Whether the chat is kept. Saves to today files the transcript under the
 * day's chats when the thread is closed, with what sky learned from it;
 * Not saved keeps nothing — no transcript, no day entry, no crash copy —
 * and the thread is gone when it is closed or when sky restarts. Set before
 * the first message it is an incognito chat; it can change until the close.
 */
export function SavesControl({ chat }: { chat: Chat }) {
  const { state, setSaves } = chat
  const [open, setOpen] = useState(false)
  const settings = state.settings
  if (!settings) return null
  const busy = state.phase !== 'idle'
  const saves = settings.saves

  return (
    <Popover position="top-start" shadow="md" width={400} withinPortal opened={open} onChange={setOpen}>
      <Popover.Target>
        <button
          type="button"
          className="sky-ctl"
          disabled={busy}
          onClick={() => setOpen((o) => !o)}
          aria-label="Whether this chat is kept"
        >
          {saves ? 'Saves to today' : 'Not saved'}
          <Caret />
        </button>
      </Popover.Target>
      <Popover.Dropdown>
        <div className="sky-ctl-title">Whether this chat is kept</div>
        <SegmentedControl
          fullWidth
          value={saves ? 'saves' : 'not'}
          onChange={(value) => void setSaves(value === 'saves')}
          data={[
            { value: 'saves', label: 'Saves to today' },
            { value: 'not', label: 'Not saved' },
          ]}
        />
        <p className="sky-ctl-note">
          {saves
            ? 'Filed under today’s chats when you close it, with what sky learned from it.'
            : 'Nothing is kept: no transcript, no day entry, no crash copy. Gone when you close it or when sky restarts.'}
        </p>
        <div className="sky-ctl-foot">Applies now.</div>
      </Popover.Dropdown>
    </Popover>
  )
}
