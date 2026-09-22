import { Loader, Skeleton } from '@mantine/core'
import { useEffect, useState } from 'react'
import type { MIProgress } from '#lib/mostImportant/types.ts'

export type MIAction = 'suggest' | 'question' | 'draft' | 'refine' | 'save'
export interface MIWorking {
  action: MIAction
  started: number
  progress: MIProgress | null
}

const thinking: Record<MIAction, string[]> = {
  suggest: ['Finding what matters most…', 'Weighing impact and urgency…', 'Looking for the strongest next action…'],
  question: [
    'Thinking through this task…',
    'Looking for what needs clarifying…',
    'Connecting this task to your context…',
  ],
  draft: ['Shaping a clear task…', 'Working out what done looks like…', 'Turning your answers into a useful draft…'],
  refine: [
    'Working through your changes…',
    'Sharpening the task and its outcome…',
    'Bringing your edits into the draft…',
  ],
  save: ['Preparing your task…', 'Adding useful references…'],
}
const writing: Record<MIAction, string> = {
  suggest: 'Writing your shortlist…',
  question: 'Preparing the next question…',
  draft: 'Writing your draft…',
  refine: 'Writing the revised draft…',
  save: 'Adding to the day…',
}
const stages: Record<MIAction, string[]> = {
  suggest: ['Read context', 'Choose priorities', 'Write options'],
  question: ['Read context', 'Consider task', 'Ask what matters'],
  draft: ['Read context', 'Shape the task', 'Write the draft'],
  refine: ['Read context', 'Work through edits', 'Revise the draft'],
  save: ['Prepare task', 'Save to day'],
}

export function MIActivity({ work }: { work: MIWorking }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const tick = () => setSeconds(Math.floor((performance.now() - work.started) / 1000))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [work.started])
  const stage = work.progress?.stage
  const active =
    work.action === 'save' ? (stage === 'saving' ? 1 : 0) : stage === 'writing' ? 2 : stage === 'thinking' ? 1 : 0
  const captions = thinking[work.action]
  const heading =
    stage === 'context'
      ? 'Reading your recent days and plans…'
      : stage === 'writing' || stage === 'saving'
        ? writing[work.action]
        : captions[Math.floor(seconds / 7) % captions.length]
  const description =
    seconds >= 45
      ? 'Still working. You can leave this open while Sky finishes.'
      : work.action === 'suggest'
        ? 'One recommendation and two alternatives, with a reason for each.'
        : work.action === 'question'
          ? 'A useful question about this task, only if one is needed.'
          : work.action === 'save'
            ? 'Your reviewed task and its place on the day.'
            : 'A clear outcome, why it matters, and what done looks like.'
  return (
    <section className="sky-mi-activity" aria-label="Sky activity">
      <div className="sky-mi-activity-heading">
        <Loader size={28} aria-hidden="true" />
        <div className="sky-mi-activity-copy" role="status" aria-live="polite">
          <strong key={heading}>{heading}</strong>
          <span>{description}</span>
        </div>
        <span className="sky-mi-elapsed" aria-hidden="true">
          {seconds}s
        </span>
      </div>
      <ol className="sky-mi-stages" aria-label="Progress">
        {stages[work.action].map((label, index) => (
          <li
            key={label}
            data-state={index < active ? 'done' : index === active ? 'active' : 'waiting'}
            aria-current={index === active ? 'step' : undefined}
          >
            <span className="sky-mi-stage-mark" aria-hidden="true">
              {index < active ? '✓' : index + 1}
            </span>
            <span>{label}</span>
          </li>
        ))}
      </ol>
      {work.progress?.documents !== undefined && (
        <p className="sky-mi-context-count">
          {work.progress.documents
            ? `${work.progress.documents} notes and plans in context`
            : 'Starting from what you share here'}
        </p>
      )}
    </section>
  )
}

export function MISuggestionSkeletons() {
  return (
    <div className="sky-mi-skeletons" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <div className="sky-mi-skeleton" key={index}>
          {index === 0 && <span className="sky-mi-recommendation">Finding your best option</span>}
          <Skeleton height={18} width={index === 0 ? '76%' : '62%'} radius="sm" />
          <Skeleton height={12} width={index === 2 ? '72%' : '90%'} radius="sm" />
        </div>
      ))}
    </div>
  )
}
