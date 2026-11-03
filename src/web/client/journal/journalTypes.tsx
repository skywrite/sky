import { Autocomplete, Button, Checkbox } from '@mantine/core'
import { useState } from 'react'
import type { MultiselectPrompt } from '#commands/lib/prompt/Prompter.ts'
import { selectedJournalTypes } from '#lib/journal/typeSelection.ts'

/** The corrected recording has been read before these suggestions arrive. */
export function JournalTypesReview({
  prompt,
  onAnswer,
}: {
  prompt: MultiselectPrompt
  onAnswer: (types: string[]) => Promise<void>
}) {
  const [picked, setPicked] = useState(() => new Set(prompt.initial ?? []))
  const [names, setNames] = useState(() => new Map<string, string>())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const suggested = new Set(prompt.initial ?? [])
  const choices = (detected: boolean) =>
    prompt.options
      .filter((option) => suggested.has(option.value) === detected)
      .map((option) => (
        <div className="sky-journal-type-option" key={option.value}>
          <Checkbox
            className="sky-journal-type-check"
            aria-label={names.get(option.value)?.trim() || option.label}
            checked={picked.has(option.value)}
            disabled={saving}
            onChange={(event) => {
              const checked = event.currentTarget.checked
              setError(null)
              setPicked((previous) => {
                const next = new Set(previous)
                if (checked) next.add(option.value)
                else next.delete(option.value)
                return next
              })
            }}
          />
          <div className="sky-journal-type-content">
            <Autocomplete
              className="sky-journal-type-name"
              aria-label={`Journal type for ${option.label}`}
              value={names.get(option.value) ?? option.label}
              data={prompt.options.map((choice) => choice.label)}
              disabled={saving || !picked.has(option.value)}
              onChange={(name) => {
                setError(null)
                setNames((previous) => new Map(previous).set(option.value, name))
              }}
              placeholder="Choose or enter a type"
            />
            {option.hint && <p className="sky-journal-type-hint">{option.hint}</p>}
          </div>
        </div>
      ))
  const submit = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onAnswer(
        selectedJournalTypes(
          [...picked].map((value) => names.get(value) ?? value),
          prompt.options.map((option) => option.value),
        ),
      )
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not save your choices. Try again.')
      setSaving(false)
    }
  }
  return (
    <section className="sky-journal-types" aria-label="Journal types">
      <h2>Choose journal types</h2>
      <p>Choose an existing type or enter a new one. Each selected type gets its own journal.</p>
      <div className="sky-journal-type-options">{choices(true)}</div>
      <details open={suggested.size === 0}>
        <summary>{suggested.size ? 'Other journal types' : 'Choose a type for this recording'}</summary>
        <div className="sky-journal-type-options">{choices(false)}</div>
      </details>
      <p className="sky-lead">
        Other topics stay together in a remainder entry. The original recording is kept with every journal.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="sky-form-foot">
        <Button variant="primary" loading={saving} onClick={() => void submit()}>
          {picked.size ? 'Create journals' : 'Keep as one journal'}
        </Button>
      </div>
    </section>
  )
}
