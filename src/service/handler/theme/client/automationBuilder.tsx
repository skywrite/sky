import { Autocomplete, Button, MultiSelect, Select, type SelectProps, Textarea, TextInput } from '@mantine/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AutomationCommand, AutomationSetup } from '../../automations/configure.ts'

const keyOf = (name: string) => name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
const DAYS = [
  { value: 'EVERY-MON', label: 'Monday' },
  { value: 'EVERY-TUE', label: 'Tuesday' },
  { value: 'EVERY-WED', label: 'Wednesday' },
  { value: 'EVERY-THU', label: 'Thursday' },
  { value: 'EVERY-FRI', label: 'Friday' },
  { value: 'EVERY-SAT', label: 'Saturday' },
  { value: 'EVERY-SUN', label: 'Sunday' },
]
const REPEATS = [
  { value: 'EVERY-DAY', label: 'Every day' },
  { value: 'EVERY-WEEKDAY', label: 'Weekdays' },
  { value: 'EVERY-WEEKEND', label: 'Weekends' },
  { value: 'days', label: 'Choose days' },
  { value: 'interval', label: 'At an interval' },
  { value: 'custom', label: 'Custom schedule' },
]

export async function automationRequest<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/automations/_api/${url}`,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  )
  const result = (await response.json()) as T & { message?: string }
  if (!response.ok) throw new Error(result.message ?? `The service answered ${response.status}.`)
  return result
}

const atList = (setup: AutomationSetup): string[] => (typeof setup.at === 'string' ? [setup.at] : (setup.at ?? []))
const timeOf = (setup: AutomationSetup): string => atList(setup)[0]?.split(' ').pop() ?? '07:00'

function repeatOf(setup: AutomationSetup): string {
  if (setup.every !== undefined) return 'interval'
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(timeOf(setup))) return 'custom'
  const entries = atList(setup)
  const first = entries[0]?.split(' ') ?? []
  const pattern = first.length === 1 ? 'EVERY-DAY' : first[0]
  if (entries.length === 1 && REPEATS.some((repeat) => repeat.value === pattern)) return pattern!
  if (entries.length && entries.every((entry) => DAYS.some((day) => entry === `${day.value} ${timeOf(setup)}`)))
    return 'days'
  return 'custom'
}

function selectionFor(command: AutomationCommand): AutomationSetup['commands'][number] {
  const args: Record<string, unknown> = {}
  if (
    command.name.startsWith('recap:') &&
    command.flags.some((flag) => flag.name === 'day' && flag.type === 'plainDate')
  )
    args.day = 'yesterday'
  if (command.flags.some((flag) => keyOf(flag.name) === 'noEditor' && flag.type === 'bool')) args.noEditor = true
  return { run: command.name, args }
}

/** Search the installed catalog and choose the conditions the scheduler actually supports. */
export function AutomationBuilder({
  busy,
  revise,
  initialSetup,
  onPreview,
  onChange,
  onBack,
}: {
  busy: boolean
  revise?: string
  initialSetup?: AutomationSetup
  onPreview: (setup: AutomationSetup) => void
  onChange: () => void
  onBack?: () => void
}) {
  const [catalog, setCatalog] = useState<AutomationCommand[] | null>(null)
  const [setup, setSetup] = useState<AutomationSetup>(initialSetup ?? { commands: [], at: ['07:00'] })
  const [repeat, setRepeat] = useState('EVERY-DAY')
  const [clockTime, setClockTime] = useState('07:00')
  const [problem, setProblem] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const commandRef = useRef<HTMLInputElement>(null)
  const [commandsOpen, setCommandsOpen] = useState(false)

  useEffect(() => {
    let alive = true
    setLoaded(false)
    setProblem(null)
    void Promise.all([
      automationRequest<AutomationCommand[]>('commands'),
      initialSetup
        ? Promise.resolve(initialSetup)
        : revise
          ? automationRequest<AutomationSetup>(`automation/${encodeURIComponent(revise)}/configuration`)
          : Promise.resolve(null),
    ])
      .then(([commands, initial]) => {
        if (!alive) return
        setCatalog(commands)
        if (initial) {
          setSetup(initial)
          setRepeat(repeatOf(initial))
          setClockTime(timeOf(initial).padStart(5, '0'))
        }
        setLoaded(true)
      })
      .catch((error: unknown) => {
        if (alive) setProblem(error instanceof Error ? error.message : "Couldn't load commands.")
      })
    return () => {
      alive = false
    }
  }, [revise, initialSetup, attempt])

  const byName = useMemo(() => new Map(catalog?.map((command) => [command.name, command])), [catalog])
  const update = (next: AutomationSetup) => {
    setSetup(next)
    onChange()
  }
  const choose = (names: string[]) =>
    update({
      ...setup,
      commands: names.map(
        (run) => setup.commands.find((selection) => selection.run === run) ?? selectionFor(byName.get(run)!),
      ),
    })
  const changeArgs = (run: string, key: string, value: unknown) =>
    update({
      ...setup,
      commands: setup.commands.map((selection) => {
        if (selection.run !== run) return selection
        const args = { ...selection.args }
        for (const existing of Object.keys(args)) if (keyOf(existing) === keyOf(key)) delete args[existing]
        if (value !== undefined) args[keyOf(key)] = value
        return { ...selection, args }
      }),
    })

  const recapDays = setup.commands.filter(
    (selection) =>
      selection.run.startsWith('recap:') &&
      byName.get(selection.run)?.flags.some((flag) => flag.name === 'day' && flag.type === 'plainDate'),
  )
  const dayValues = new Set(recapDays.map((selection) => selection.args.day ?? 'default'))
  const recapDay = dayValues.size === 1 ? String([...dayValues][0]) : null

  const setSchedule = (value: string) => {
    const { at: _at, every: _every, tz, ...rest } = setup
    setRepeat(value)
    if (value === 'interval') update({ ...rest, every: '1h' })
    else
      update({
        ...rest,
        ...(tz ? { tz } : {}),
        at:
          value === 'custom'
            ? atList(setup).length
              ? atList(setup)
              : ['07:00']
            : [`${value === 'days' ? 'EVERY-MON' : value} ${clockTime}`],
      })
  }

  const commandPickerProps = {
    placeholder: 'Search commands — recap, inbox, day…',
    searchable: true,
    data: (catalog ?? []).map((command) => ({ value: command.name, label: command.name })),
    filter: ({ options, search, limit }) =>
      options
        .filter(
          (option) =>
            'value' in option &&
            search
              .toLowerCase()
              .trim()
              .split(/\s+/)
              .every((word) =>
                `${option.value} ${byName.get(option.value)?.description ?? ''}`.toLowerCase().includes(word),
              ),
        )
        .slice(0, limit),
    limit: 40,
    nothingFoundMessage: 'No matching commands',
    disabled: busy,
    dropdownOpened: commandsOpen,
    onDropdownOpen: () => setCommandsOpen(true),
    onDropdownClose: () => setCommandsOpen(false),
    renderOption: ({ option }) => (
      <div className="sky-auto-command-option">
        <span>{option.value}</span>
        <small>{byName.get(option.value)?.description}</small>
      </div>
    ),
  } satisfies SelectProps

  if (!loaded)
    return (
      <div className="sky-auto-empty" role="status">
        {problem ?? 'Loading commands…'}
        {problem && <Button onClick={() => setAttempt((value) => value + 1)}>Try again</Button>}
      </div>
    )

  return (
    <section className="sky-block">
      <div className="sky-block-head">Commands & conditions</div>
      <fieldset className="sky-block-pad sky-auto-builder" disabled={busy}>
        <TextInput
          label="Automation name"
          placeholder="Choose automatically"
          value={setup.name ?? ''}
          disabled={!!revise || busy}
          onChange={(event) => update({ ...setup, name: event.currentTarget.value })}
        />
        <MultiSelect
          {...commandPickerProps}
          ref={commandRef}
          label="Commands"
          description="All selected commands run together in this automation. Search by name or what each does."
          clearable
          hidePickedOptions
          value={setup.commands.map((selection) => selection.run)}
          onChange={choose}
          maxValues={50}
        />
        <div className="sky-auto-command-browse">
          <Button
            size="sm"
            variant="primary-quiet"
            disabled={busy}
            onClick={() => {
              commandRef.current?.focus()
              commandRef.current?.select()
              setCommandsOpen(true)
            }}
          >
            Browse commands
          </Button>
          <span className="sky-auto-help">{catalog?.length ?? 0} installed commands</span>
        </div>
        {catalog?.some((command) => command.name.startsWith('recap:')) && (
          <div>
            <Button
              size="sm"
              onClick={() => {
                const { every: _every, ...rest } = setup
                setRepeat('EVERY-DAY')
                setClockTime('07:00')
                update({
                  ...rest,
                  commands: catalog
                    .filter((command) => command.name.startsWith('recap:'))
                    .slice(0, 50)
                    .map(selectionFor),
                  at: ['07:00'],
                })
              }}
            >
              Morning recaps
            </Button>
            <span className="sky-auto-help">Select recap commands for 7:00 each morning, then adjust.</span>
          </div>
        )}

        <div className="sky-auto-condition-grid">
          <Select
            label="Repeat"
            data={REPEATS}
            value={repeat}
            allowDeselect={false}
            disabled={busy}
            onChange={(value) => value && setSchedule(value)}
          />
          {repeat === 'interval' ? (
            <TextInput
              label="Every"
              placeholder="30m, 2h, 1d"
              value={setup.every ?? ''}
              onChange={(event) => update({ ...setup, every: event.currentTarget.value })}
            />
          ) : (
            repeat !== 'custom' && (
              <TextInput
                label="Time"
                type="time"
                value={clockTime}
                onChange={(event) => {
                  const time = event.currentTarget.value
                  setClockTime(time)
                  update({
                    ...setup,
                    at: atList(setup).map(
                      (entry) => `${entry.includes(' ') ? entry.split(' ')[0] : 'EVERY-DAY'} ${time}`,
                    ),
                  })
                }}
              />
            )
          )}
        </div>
        {repeat === 'days' && (
          <MultiSelect
            label="Run on"
            data={DAYS}
            value={atList(setup).map((entry) => entry.split(' ')[0]!)}
            disabled={busy}
            onChange={(days) => update({ ...setup, at: days.map((day) => `${day} ${clockTime}`) })}
          />
        )}
        {repeat === 'custom' && (
          <Textarea
            label="Schedule"
            description="One time per line, such as EVERY-MON 07:00 or EVERY-THU 09:00."
            autosize
            minRows={2}
            value={atList(setup).join('\n')}
            onChange={(event) => update({ ...setup, at: event.currentTarget.value.split('\n') })}
          />
        )}

        {recapDays.length > 0 && (
          <Select
            label="Day to recap"
            description="Relative days are worked out each time the automation runs."
            value={recapDay}
            placeholder="Mixed — choose a day"
            allowDeselect={false}
            disabled={busy}
            data={[
              { value: 'yesterday', label: 'Previous day' },
              { value: 'today', label: 'Today' },
              { value: 'default', label: 'Command default' },
              ...(recapDay && !['yesterday', 'today', 'default'].includes(recapDay)
                ? [{ value: recapDay, label: recapDay }]
                : []),
            ]}
            onChange={(value) => {
              if (value)
                update({
                  ...setup,
                  commands: setup.commands.map((selection) => {
                    if (!recapDays.includes(selection)) return selection
                    const args = { ...selection.args }
                    if (value === 'default') delete args.day
                    else args.day = value
                    return { ...selection, args }
                  }),
                })
            }}
          />
        )}

        <details className="sky-auto-options">
          <summary>More conditions</summary>
          <div className="sky-auto-condition-grid">
            {repeat !== 'interval' && (
              <TextInput
                label="Time zone"
                placeholder="Local time"
                description="Leave blank to follow your computer’s clock."
                value={setup.tz ?? ''}
                onChange={(event) => update({ ...setup, tz: event.currentTarget.value })}
              />
            )}
            <TextInput
              label="Last day to run"
              type="date"
              description="Optional — leave blank to keep running."
              value={setup.until ?? ''}
              onChange={(event) => update({ ...setup, until: event.currentTarget.value })}
            />
          </div>
        </details>

        {setup.commands.map((selection) => {
          const command = byName.get(selection.run)
          return (
            <details className="sky-auto-options" key={selection.run}>
              <summary>
                {selection.run} <span className="sky-auto-help">options</span>
              </summary>
              <div className="sky-auto-fields">
                {!command && (
                  <p className="sky-auto-problem">This command is no longer in the catalog. Choose another command.</p>
                )}
                {command?.flags.map((flag) => {
                  const key = keyOf(flag.name)
                  const value = selection.args[key] ?? selection.args[flag.name]
                  const common = { label: flag.name, description: flag.description, disabled: busy }
                  if (flag.type === 'bool')
                    return (
                      <Select
                        key={key}
                        {...common}
                        allowDeselect={false}
                        data={[
                          { value: 'default', label: 'Command default' },
                          { value: 'true', label: 'Yes' },
                          { value: 'false', label: 'No' },
                        ]}
                        value={value === undefined ? 'default' : String(value)}
                        onChange={(next) =>
                          changeArgs(selection.run, key, next === 'default' ? undefined : next === 'true')
                        }
                      />
                    )
                  if (flag.type === 'plainDate')
                    return (
                      <Autocomplete
                        key={key}
                        {...common}
                        data={['yesterday', 'today']}
                        placeholder="Command default"
                        value={value === undefined ? '' : String(value)}
                        onChange={(next) => changeArgs(selection.run, key, next || undefined)}
                      />
                    )
                  return (
                    <TextInput
                      key={key}
                      {...common}
                      placeholder="Command default"
                      type={flag.type === 'number' ? 'number' : 'text'}
                      value={value === undefined ? '' : String(value)}
                      onChange={(event) => {
                        const next = event.currentTarget.value
                        changeArgs(
                          selection.run,
                          key,
                          next === '' ? undefined : flag.type === 'number' ? Number(next) : next,
                        )
                      }}
                    />
                  )
                })}
              </div>
            </details>
          )
        })}
        <Textarea
          label="What this is for"
          placeholder="Optional context for this automation"
          autosize
          minRows={2}
          value={setup.brief ?? ''}
          onChange={(event) => update({ ...setup, brief: event.currentTarget.value })}
        />
        {setup.commands.length > 1 && (
          <span className="sky-auto-help">
            {setup.commands.length} commands in one automation. Runs in order; failures are reported and remaining
            commands continue.
          </span>
        )}
        <div className={`sky-auto-actions${onBack ? ' sky-auto-wizard-actions' : ''}`}>
          {onBack && (
            <Button disabled={busy} onClick={onBack}>
              Back
            </Button>
          )}
          <Button
            variant="primary"
            disabled={busy || !setup.commands.length || (repeat !== 'interval' && !atList(setup).length)}
            onClick={() => onPreview(setup)}
          >
            {busy ? 'Preparing…' : onBack ? 'Review automation' : 'Preview automation'}
          </Button>
        </div>
      </fieldset>
    </section>
  )
}
