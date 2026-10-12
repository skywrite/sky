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
  suggest: [
    'Finding what matters most…',
    'Weighing impact and urgency…',
    'Looking for the strongest next action…',
    'Connecting your plans to today…',
    'Considering what needs your attention…',
    'Looking for work that moves things forward…',
    'Weighing the competing priorities…',
    'Thinking about what you can finish today…',
    'Looking for a task that unblocks other work…',
    'Considering the most useful alternatives…',
  ],
  question: [
    'Thinking through this task…',
    'Looking for what needs clarifying…',
    'Connecting this task to your context…',
    'Considering whether a question would help…',
    'Looking for a useful boundary…',
    'Considering who the task is for…',
    'Separating missing context from the work itself…',
    'Thinking about what would make the task clearer…',
    'Looking for ambiguity in the scope…',
    'Focusing on what only you can clarify…',
  ],
  draft: [
    'Shaping a clear task…',
    'Working out what done looks like…',
    'Turning your answers into a useful draft…',
    'Finding the main action…',
    'Keeping the scope focused on today…',
    'Connecting the task to its purpose…',
    'Bringing the relevant context together…',
    'Separating the outcome from the background…',
    'Thinking through a useful starting point…',
    'Choosing the details that help you act…',
  ],
  refine: [
    'Working through your changes…',
    'Sharpening the task and its outcome…',
    'Bringing your edits into the draft…',
    'Considering what needs to change…',
    'Keeping your intent in focus…',
    'Thinking through the revised scope…',
    'Looking for a clearer way to say it…',
    'Separating useful detail from repetition…',
    'Working your feedback into the task…',
    'Considering how the changes fit together…',
  ],
  save: ['Preparing your task…', 'Adding useful references…'],
}
const writing: Record<MIAction, string[]> = {
  suggest: [
    'Writing your shortlist…',
    'Putting the strongest option into words…',
    'Giving each option a clear action…',
    'Writing the reasons behind the choices…',
    'Shaping the alternatives…',
    'Keeping the options easy to compare…',
    'Making the recommendation concrete…',
    'Keeping the shortlist focused on today…',
    'Turning the priorities into useful options…',
    'Making each choice easy to act on…',
  ],
  question: [
    'Preparing the next question…',
    'Putting the missing context into words…',
    'Keeping the question focused…',
    'Making the question easy to answer…',
    'Asking only what helps define the task…',
    'Keeping the setup separate from the work…',
    'Finding the clearest way to ask…',
    'Keeping the question grounded in your task…',
    'Making room for your direction…',
    'Focusing the question on what matters…',
  ],
  draft: [
    'Writing your draft…',
    'Giving the task a clear title…',
    'Putting the outcome into words…',
    'Explaining why this matters…',
    'Making the finish line clear…',
    'Keeping the useful context close…',
    'Turning the details into clear instructions…',
    'Keeping the draft easy to scan…',
    'Making the next action concrete…',
    'Bringing the task into focus…',
  ],
  refine: [
    'Writing the revised draft…',
    'Putting your feedback into words…',
    'Making the requested changes…',
    'Clarifying the action…',
    'Keeping the outcome easy to see…',
    'Making the wording more direct…',
    'Keeping the details that matter…',
    'Bringing the revised scope into focus…',
    'Making the draft easier to act on…',
    'Keeping the revision true to your intent…',
  ],
  save: ['Adding to the day…'],
}
const stages: Record<MIAction, string[]> = {
  suggest: ['Read context', 'Choose priorities', 'Write options'],
  question: ['Read context', 'Consider task', 'Ask what matters'],
  draft: ['Read context', 'Shape the task', 'Write the draft'],
  refine: ['Read context', 'Work through edits', 'Revise the draft'],
  save: ['Prepare task', 'Save to day'],
}

export function MIActivity({ work }: { work: MIWorking }) {
  const stage = work.progress?.stage
  const [{ seconds, caption }, setTiming] = useState({ seconds: 0, caption: 0 })
  useEffect(() => {
    const stageStarted = performance.now()
    const tick = () => {
      const now = performance.now()
      setTiming({
        seconds: Math.floor((now - work.started) / 1000),
        caption: Math.floor((now - stageStarted) / 7000),
      })
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [work.started, work.action, stage])
  const active =
    work.action === 'save' ? (stage === 'saving' ? 1 : 0) : stage === 'writing' ? 2 : stage === 'thinking' ? 1 : 0
  const captions = stage === 'writing' || stage === 'saving' ? writing[work.action] : thinking[work.action]
  const heading = stage === 'context' ? 'Reading your recent days and plans…' : captions[caption % captions.length]
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
