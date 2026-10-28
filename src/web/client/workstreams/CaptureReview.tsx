import { Button, Checkbox, Textarea } from '@mantine/core'
import { CaptureContext } from './CaptureContext.tsx'
import type { CaptureFlow } from './useCaptureFlow.ts'

export function CaptureReview({ flow }: { flow: CaptureFlow }) {
  const { outcome, setOutcome, result, editing, setEditing, locked, assist, setAssist, move } = flow
  return (
    <div className="sky-workstream-capture-review">
      <div className="sky-workstream-capture-review-label">
        <span>Outcome</span>
        {!editing && (
          <Button onClick={() => setEditing(true)} disabled={locked}>
            Edit outcome
          </Button>
        )}
      </div>
      {editing ? (
        <div className="sky-workstream-capture-edit">
          <Textarea
            label="Outcome"
            autosize
            minRows={2}
            maxRows={7}
            value={outcome}
            onChange={(event) => setOutcome(event.currentTarget.value)}
            disabled={locked}
          />
          {result?.suggestedOutcome && result.suggestedOutcome !== outcome && (
            <div className="sky-workstream-capture-suggestion">
              <span>Suggested wording</span>
              <p>{result.suggestedOutcome}</p>
              <Button onClick={() => setOutcome(result.suggestedOutcome!)} disabled={locked}>
                Use suggested wording
              </Button>
            </div>
          )}
          <Button onClick={() => setEditing(false)}>Done editing</Button>
        </div>
      ) : (
        <p className="sky-workstream-capture-outcome">{outcome}</p>
      )}
      {!editing && result?.suggestedOutcome && result.suggestedOutcome !== outcome && (
        <Button className="sky-workstream-capture-sharpen" onClick={() => setEditing(true)} disabled={locked}>
          Sharpen wording
        </Button>
      )}
      {outcome.trim().length > 2400 && (
        <p role="alert" className="sky-workstream-capture-hint">
          Shorten the outcome to 2,400 characters before saving. Your full intention is preserved.
        </p>
      )}
      <div className="sky-workstream-capture-review-timing">
        <span>Timing</span>
        <Button disabled={locked} onClick={() => move(1)}>
          {result!.horizonLabel} · Change
        </Button>
      </div>
      {result?.horizon === 'this-week' ? (
        <p className="sky-workstream-capture-hint">This will go into your week plan.</p>
      ) : (
        <Checkbox
          checked={assist}
          onChange={(event) => setAssist(event.currentTarget.checked)}
          label="Let Sky check in and prepare next steps"
          disabled={locked}
        />
      )}
      <CaptureContext result={result!} />
    </div>
  )
}
