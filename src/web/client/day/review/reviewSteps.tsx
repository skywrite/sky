import {
  REVIEW_STEPS,
  reviewItemStep,
  type ReviewStep,
  type ReviewView,
} from '../../../../service/handler/day/review/types.ts'

export const steps: Record<ReviewStep, { label: string; title: string; description: string; empty: string }> = {
  carry: {
    label: 'Tasks',
    title: 'What’s coming with you?',
    description: 'Bring unfinished todos and reminders into today, or skip anything you want to leave on this day.',
    empty: 'No unfinished todos or reminders to move.',
  },
  streak: {
    label: 'Streaks',
    title: 'Did you do these?',
    description: 'Give yourself credit for the habits you completed on this day.',
    empty: 'No streaks need a check-in for this day.',
  },
  tracking: {
    label: 'Tracking',
    title: 'Fill in the missing pieces',
    description: 'Add any tracking you missed. Your answers are saved to the day you’re reviewing.',
    empty: 'No tracking is waiting for an answer.',
  },
  meeting: {
    label: 'Meetings',
    title: 'Anything worth keeping?',
    description: 'File meeting notes and check any loose ends. Skip what you don’t need to sort out now.',
    empty: 'No meeting notes or loose ends need attention.',
  },
  summary: {
    label: 'Summary',
    title: 'Your day, brought together',
    description: 'Sky uses the day’s saved notes, activity, tracking, and recaps to write your summary.',
    empty: '',
  },
  chat: {
    label: 'Chats',
    title: 'Keep the conversation going',
    description:
      'These open chats will follow you into Today. Keep going later, or save and close any you’ve finished.',
    empty: 'No open chats to carry forward.',
  },
}

export function ReviewSteps({
  view,
  busy,
  goTo,
}: {
  view: ReviewView
  busy: boolean
  goTo: (step: ReviewStep) => void
}) {
  return (
    <nav aria-label="Review steps" className="sky-review-steps">
      <ol>
        {REVIEW_STEPS.map((step, index) => {
          const pending = view.items.filter((item) => reviewItemStep(item) === step).length
          const complete =
            step === 'summary'
              ? Boolean(view.summaryHref)
              : step === 'chat'
                ? !view.chats.length || view.step === 'summary'
                : pending === 0
          return (
            <li key={step}>
              <button
                type="button"
                aria-current={view.step === step ? 'step' : undefined}
                aria-label={`${steps[step].label}${complete ? ', complete' : pending ? `, ${pending} remaining` : ''}`}
                data-complete={complete || undefined}
                disabled={busy}
                onClick={() => goTo(step)}
              >
                <span className="sky-review-step-number" aria-hidden="true">
                  {complete ? '✓' : index + 1}
                </span>
                <span>{steps[step].label}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
