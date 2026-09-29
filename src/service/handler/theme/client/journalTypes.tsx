import { Button, Checkbox } from '@mantine/core'
import { useState } from 'react'
import type { MultiselectPrompt } from '#commands/lib/prompt/Prompter.ts'

/** The corrected recording has been read before these suggestions arrive. */
export function JournalTypesReview({
  prompt,
  onAnswer,
}: {
  prompt: MultiselectPrompt
  onAnswer: (types: string[]) => Promise<void>
}) {
  const [picked, setPicked] = useState(() => new Set(prompt.initial ?? []))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const suggested = new Set(prompt.initial ?? [])
  const choices = (detected: boolean) =>
    prompt.options
      .filter((option) => suggested.has(option.value) === detected)
      .map((option) => (
        <Checkbox
          key={option.value}
          label={option.label}
          description={option.hint}
          checked={picked.has(option.value)}
          disabled={saving}
          onChange={(event) => {
            const checked = event.currentTarget.checked
            setPicked((previous) => {
              const next = new Set(previous)
              if (checked) next.add(option.value)
              else next.delete(option.value)
              return next
            })
          }}
        />
      ))
  const submit = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onAnswer([...picked])
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not save your choices. Try again.')
      setSaving(false)
    }
  }
  return (
    <section className="sky-journal-types" aria-label="Journal types">
      <h2>Choose journal types</h2>
      <p>These types fit your corrected recording. Each selected type gets its own journal.</p>
      <div className="sky-journal-type-options">{choices(true)}</div>
      <details open={suggested.size === 0}>
        <summary>{suggested.size ? 'Other journal types' : 'Choose a type for this recording'}</summary>
        <div className="sky-journal-type-options">{choices(false)}</div>
      </details>
      <p className="sky-lead">
        Other topics stay together in a remainder entry. The original audio is kept with every journal.
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
