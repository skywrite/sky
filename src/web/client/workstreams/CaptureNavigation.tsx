import { Button } from '@mantine/core'
import type { CaptureFlow } from './useCaptureFlow.ts'

export function CaptureNavigation({ flow, busy }: { flow: CaptureFlow; busy: boolean }) {
  const {
    cursor,
    thinking,
    locked,
    error,
    saveLocked,
    ready,
    saving,
    outcome,
    result,
    question,
    canContinue,
    move,
    withoutSky,
    retry,
    close,
    save,
    skip,
    next,
  } = flow
  return (
    <div className="sky-workstream-capture-navigation">
      {(cursor > 0 || thinking) && (
        <Button disabled={locked} onClick={() => move(thinking ? cursor : cursor - 1)}>
          Back
        </Button>
      )}
      <div className="sky-workstream-capture-actions">
        {error && !saveLocked ? (
          <>
            <Button onClick={withoutSky}>Continue without Sky</Button>
            <Button variant="primary" onClick={retry}>
              Try again
            </Button>
          </>
        ) : thinking ? (
          <Button onClick={close}>Cancel</Button>
        ) : ready ? (
          <Button
            variant="primary"
            loading={saving}
            onClick={() => void save()}
            disabled={busy || !outcome.trim() || outcome.trim().length > 2400}
          >
            {saveLocked && error
              ? 'Retry saving'
              : result?.horizon === 'this-week'
                ? 'Add to this week'
                : 'Start workstream'}
          </Button>
        ) : (
          <>
            {question && question.field !== 'timing' && (
              <Button disabled={locked} onClick={skip}>
                {question.field === 'outcome' ? 'Keep it broad' : 'Nothing to add'}
              </Button>
            )}
            <Button variant="primary" disabled={locked || !canContinue} onClick={next}>
              Continue
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
