import { Button, Textarea } from '@mantine/core'
import { CAPTURE_HORIZON_CHOICES as horizons } from '#lib/workstreams/captureTypes.ts'
import { CaptureContext } from './CaptureContext.tsx'
import type { CaptureFlow } from './useCaptureFlow.ts'

export function CaptureQuestion({ flow, touch }: { flow: CaptureFlow; touch: boolean }) {
  const { intent, step, result, question, locked, answerInput, changeAnswer, keySubmit } = flow
  if (!question) return null
  if (question.field === 'timing')
    return (
      <div className="sky-workstream-capture-question">
        <p className="sky-workstream-capture-intent">{intent}</p>
        <div className="sky-workstream-capture-choices">
          {horizons.map((choice) => (
            <Button
              key={choice.value}
              aria-pressed={step?.horizon === choice.value}
              disabled={locked}
              onClick={() => changeAnswer(choice.label, choice.value)}
            >
              {choice.label}
              <span aria-hidden="true">{step?.horizon === choice.value ? '✓' : ''}</span>
            </Button>
          ))}
        </div>
      </div>
    )
  return (
    <>
      <div className="sky-workstream-capture-question">
        <h3>{question.prompt}</h3>
        <Textarea
          ref={answerInput}
          aria-label={question.prompt}
          placeholder="A sentence is enough…"
          autosize
          minRows={2}
          maxRows={5}
          maxLength={4000}
          value={step!.answer}
          onChange={(event) => changeAnswer(event.currentTarget.value)}
          enterKeyHint={touch ? 'enter' : 'send'}
          onKeyDown={keySubmit}
          disabled={locked}
        />
        {question.choices.length > 0 && (
          <div className="sky-workstream-capture-suggestions">
            {question.choices.map((choice) => (
              <Button
                key={choice.value}
                onClick={() => changeAnswer(choice.value)}
                aria-pressed={step!.answer === choice.value}
                disabled={locked}
              >
                {choice.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      <CaptureContext result={result!} />
    </>
  )
}
