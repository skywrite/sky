import { Button, Textarea } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useId, useState } from 'react'

export function WorkstreamsEmpty({
  onStart,
  disabled,
  hasWorkstreams,
  onClearFilters,
  availableHeight,
}: {
  onStart: (intent?: string) => void
  disabled: boolean
  hasWorkstreams: boolean
  onClearFilters?: () => void
  availableHeight: number
}) {
  const [intent, setIntent] = useState('')
  const inputId = useId()
  const touch = useMediaQuery('(pointer: coarse)') ?? false
  const compact = availableHeight < 320
  const maxRows = Math.max(1, Math.min(6, Math.floor((availableHeight - (compact ? 175 : 275)) / 27)))
  const submit = () => {
    if (intent.trim() && !disabled) onStart(intent)
  }
  if (hasWorkstreams)
    return (
      <div className="sky-workstreams-empty sky-workstreams-no-matches" data-canvas-control>
        <h2>No matching workstreams</h2>
        <Button variant="secondary" onClick={onClearFilters} disabled={disabled}>
          Clear filters
        </Button>
      </div>
    )
  return (
    <div className="sky-workstreams-empty" data-canvas-control data-compact={compact}>
      <h2>
        <label htmlFor={inputId}>What do you want to get done?</label>
      </h2>
      <form
        className="sky-workstreams-capture"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Textarea
          id={inputId}
          placeholder="Tell Sky what you have in mind…"
          classNames={{ input: 'sky-workstreams-capture-input' }}
          variant="unstyled"
          autosize
          minRows={Math.min(2, maxRows)}
          maxRows={maxRows}
          maxLength={20000}
          enterKeyHint={touch ? 'enter' : 'send'}
          value={intent}
          onChange={(event) => setIntent(event.currentTarget.value)}
          disabled={disabled}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              (!touch || event.metaKey || event.ctrlKey) &&
              !event.repeat &&
              !event.nativeEvent.isComposing &&
              event.nativeEvent.keyCode !== 229
            ) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className="sky-workstreams-capture-footer">
          {!touch && (
            <span className="sky-workstreams-capture-shortcut">Enter to send · Shift + Enter for a new line</span>
          )}
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!intent.trim() || disabled}
            rightSection={<span aria-hidden="true">→</span>}
          >
            Send
          </Button>
        </div>
      </form>
    </div>
  )
}
