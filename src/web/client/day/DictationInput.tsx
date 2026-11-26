import './DictationInput.css'
import { Input, Textarea, type TextareaProps } from '@mantine/core'
import { useEffect, useId, useRef, type Ref } from 'react'
import { connectionHref } from '../settings/settingsRoutes.ts'
import { appendDictation } from './entryDictation.ts'
import { EntryListeningWave } from './EntryListeningWave.tsx'
import { EntryMicrophone } from './EntryMicrophone.tsx'
import type { DayDictation, DictationField } from './useEntryDictation.ts'

type Props = Omit<TextareaProps, 'value' | 'onChange' | 'maxLength'> & {
  dictation: DayDictation
  field: DictationField
  inputRef?: Ref<HTMLTextAreaElement>
  micRef?: Ref<HTMLButtonElement>
}

export function DictationInput({ dictation, field, inputRef, micRef, label, disabled, autoFocus, ...textarea }: Props) {
  const id = useId()
  const transcript = useRef<HTMLDivElement>(null)
  const selected = dictation.field === field.name
  const active = selected && dictation.active
  const usedMic = useRef(false)
  useEffect(() => {
    if (active) usedMic.current = true
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight
  }, [active, dictation.speech])
  return (
    <div className="sky-entry-writing">
      {label && <Input.Label htmlFor={id}>{label}</Input.Label>}
      <div className="sky-entry-input">
        {active ? (
          <div
            ref={transcript}
            id={id}
            className="sky-entry-transcript"
            role="group"
            aria-label={`Live ${field.name} text`}
            aria-describedby={textarea['aria-describedby']}
          >
            {field.text}
            <span>{appendDictation(field.text, dictation.speech).slice(field.text.length)}</span>
          </div>
        ) : (
          <Textarea
            {...textarea}
            ref={inputRef}
            id={id}
            autosize
            autoFocus={autoFocus && !usedMic.current}
            value={field.text}
            maxLength={field.limit}
            disabled={disabled}
            onChange={(event) => field.setText(event.currentTarget.value)}
          />
        )}
        <EntryMicrophone
          buttonRef={micRef}
          phase={active ? dictation.phase : 'idle'}
          subject={field.name}
          hasText={!!field.text.trim()}
          disabled={disabled || (dictation.active && !selected) || (!active && field.text.length >= field.limit)}
          onClick={() => dictation.toggle(field)}
        />
      </div>
      {active && (
        <div role="status" className="sky-entry-status" data-phase={dictation.phase}>
          {dictation.phase === 'listening' && <EntryListeningWave sample={dictation.microphoneLevel} />}
          {dictation.phase === 'connecting'
            ? 'Connecting microphone…'
            : dictation.phase === 'finishing'
              ? 'Finishing transcript…'
              : dictation.phase === 'checking'
                ? 'Checking names…'
                : 'Listening'}
        </div>
      )}
      {selected && dictation.error && (
        <p className="sky-plan-error" role="alert">
          {dictation.error}
          {dictation.needsKey && (
            <>
              {' '}
              <a href={connectionHref('openai')}>Open OpenAI settings</a>
            </>
          )}
        </p>
      )}
      {field.text.length > field.limit && (
        <p className="sky-plan-error" role="alert">
          Shorten this {field.name} to {field.limit.toLocaleString('en-US')} characters before continuing.
        </p>
      )}
    </div>
  )
}
