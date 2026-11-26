import { ActionIcon } from '@mantine/core'
import type { Ref } from 'react'
import type { DictationPhase } from './entryDictation.ts'

export function EntryMicrophone({
  phase,
  subject,
  hasText,
  onClick,
  buttonRef,
  disabled,
}: {
  phase: DictationPhase
  subject: string
  hasText: boolean
  onClick: () => void
  buttonRef?: Ref<HTMLButtonElement>
  disabled?: boolean
}) {
  const resume = subject === 'entry' ? 'Continue dictating' : `Continue dictating ${subject}`
  const label = {
    idle: hasText ? resume : `Dictate ${subject}`,
    connecting: 'Cancel dictation',
    listening: 'Stop dictation',
    finishing: 'Finishing dictation',
    checking: 'Checking names',
  }[phase]
  return (
    <ActionIcon
      type="button"
      ref={buttonRef}
      variant="secondary"
      className="sky-entry-mic"
      aria-label={label}
      title={label}
      disabled={disabled || phase === 'finishing' || phase === 'checking'}
      onClick={onClick}
    >
      {phase === 'idle' ? (
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3" />
        </svg>
      ) : (
        <span className="sky-entry-stop" aria-hidden="true" />
      )}
    </ActionIcon>
  )
}
