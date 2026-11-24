import { Button } from '@mantine/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DecidedAnswers, DecidingAnswers, WizardAnswers } from '#lib/decisionWizard/answers.ts'
import { decidedDefaults, decidingDefaults } from '#lib/decisionWizard/defaults.ts'
import {
  decidedReady,
  decidedScreens,
  decidingReady,
  decidingScreens,
  pathOf,
  STAGES,
} from '#lib/decisionWizard/screens.ts'
import type { WizardSaved } from '#lib/decisionWizard/session.ts'
import { niceDate } from '../dates.ts'
import { FutureLink } from '../FutureLink.tsx'
import { futureRequest } from '../request.ts'
import { wizardHref } from '../routes.ts'
import { DecidedStep } from './DecidedStep.tsx'
import { DecidingStep } from './DecidingStep.tsx'
import { Rail } from './Rail.tsx'
import { Thinking } from './Thinking.tsx'
import { useRun } from './useRun.ts'
import { useWizardKeys } from './useWizardKeys.ts'
import './Wizard.css'

const listed = (days: string[], today: string): string => days.map((day) => niceDate(day, today)).join(' and ')
const withAll = (list: number[], from: number, to: number): number[] => {
  const added = Array.from({ length: Math.max(0, to - from) }, (_, n) => from + n)
  return [...list, ...added.filter((at) => !list.includes(at))]
}

/** What the person sees once the decision is in the notebook, and what happens next. */
function Saved({ saved, today, navigate }: { saved: WizardSaved; today: string; navigate: (to: string) => void }) {
  return (
    <section className="sky-wizard-q sky-wizard-start">
      <h2>{saved.open ? 'Saved as open' : 'Saved'}</h2>
      <p className="sky-wizard-lede">
        {saved.open
          ? 'It is on your Decisions list under To decide, with everything you have worked through. Pick it up there when you are ready to make the call.'
          : `It is on your Decisions list under ${saved.inForce ? 'In force' : 'Decided'}, dated ${saved.when ? niceDate(saved.when, today) : 'today'}.`}
      </p>
      <div className="sky-wizard-read">
        <h3>What happens next</h3>
        {saved.open ? (
          <p>
            {saved.todos.length
              ? `Added to today’s to-dos: ${saved.todos.join('; ')}.`
              : 'Nothing was added to your to-dos.'}{' '}
            Sky keeps the decision in view in every chat until you make it.
          </p>
        ) : saved.look.length ? (
          <p>
            A reminder to look back appears on your day page on {listed(saved.look, today)}. It asks whether it went the
            way you expected.
          </p>
        ) : (
          <p>No day was set to look back on it.</p>
        )}
      </div>
      {saved.warnings.map((warning) => (
        <p key={warning} className="sky-wizard-flag" role="alert">
          {warning}
        </p>
      ))}
      <div className="sky-wizard-actions">
        <Button onClick={() => navigate(wizardHref())}>Add another</Button>
        <Button variant="primary" onClick={() => navigate('/future/decisions')}>
          See your decisions
        </Button>
      </div>
    </section>
  )
}

/**
 * One run of the decision wizard. Sky has thought the decision through once;
 * each step reads that plan and asks one question, answered by a click. The
 * person's answers are kept as they go, so a reload or a later visit picks up
 * at the same step.
 */
export function Wizard({
  id,
  today,
  navigate,
  onTitle,
  onChanged,
}: {
  id: string
  today: string
  navigate: (to: string) => void
  /** The page's tab title follows the run: thinking, then the decision's wording */
  onTitle: (title: string) => void
  /** The notebook or the list of runs changed: the lists behind this page should be read again */
  onChanged: () => Promise<void>
}) {
  const { run, error, act } = useRun(id)
  const [answers, setAnswers] = useState<WizardAnswers>({})
  const [at, setAt] = useState<string | null>(null)
  const [saved, setSaved] = useState<WizardSaved | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const plan = run?.status === 'ready' ? run.plan : null
  const adding = Boolean(run?.adding && !run.adding.error)

  // The page takes its answers from the server once per plan. A plan that changed (Sky thought again
  // from new wording, or worked out what the person typed in) brings the answers kept for it.
  const adopted = useRef<{ shape: string; options: number; wants: number } | null>(null)
  const counts = plan?.kind === 'deciding' ? { options: plan.options.length, wants: plan.wants.length } : null
  const shape = plan && run ? `${run.statement}:${plan.kind}:${counts?.options ?? 0}.${counts?.wants ?? 0}` : ''
  useEffect(() => {
    if (!plan || !run) {
      // Sky is thinking again: whatever comes back is a new plan, even under the same wording.
      if (run && run.status !== 'ready') adopted.current = null
      return
    }
    if (adopted.current?.shape === shape) return
    const before = adopted.current
    let next: WizardAnswers = run.answers
    if (before && counts) {
      // What the person typed in joins what they had ticked, whichever of the page and Sky wrote last.
      let mine = next as DecidingAnswers
      if (counts.options > before.options)
        mine = { ...mine, options: withAll(mine.options ?? [], before.options, counts.options) }
      if (counts.wants > before.wants) mine = { ...mine, wants: withAll(mine.wants ?? [], before.wants, counts.wants) }
      next = mine
    }
    adopted.current = { shape, options: counts?.options ?? 0, wants: counts?.wants ?? 0 }
    setAnswers(next)
    setAt(run.step)
  }, [plan, run, shape, counts?.options, counts?.wants])

  const screens = !plan
    ? []
    : plan.kind === 'deciding'
      ? decidingScreens(plan, answers as DecidingAnswers)
      : decidedScreens(plan)
  const index = Math.max(
    0,
    screens.findIndex((screen) => screen.id === at),
  )
  const screen = screens[index]
  const ready =
    !plan || !screen
      ? false
      : plan.kind === 'deciding'
        ? decidingReady(screen.id, plan, answers as DecidingAnswers)
        : decidedReady(screen.id, answers as DecidedAnswers)

  // Answers are kept on the server a moment after each change, one write after another.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const keep = useCallback(
    (next: WizardAnswers, step: string | null) => {
      queue.current = queue.current
        .catch(() => {})
        .then(() => futureRequest(`/decisions/wizard/${id}/progress`, { answers: next, step }))
      return queue.current
    },
    [id],
  )
  useEffect(() => {
    // While Sky works out an addition the answers are Sky's to change, so the page writes nothing.
    if (!plan || adopted.current?.shape !== shape || saved || adding) return
    pending.current = setTimeout(() => void keep(answers, screen?.id ?? null).catch(() => {}), 400)
    return () => clearTimeout(pending.current)
  }, [answers, screen?.id, plan, shape, saved, adding, keep])
  /** Keep the answers now, ahead of a step that depends on the server having them. */
  const flush = () => {
    clearTimeout(pending.current)
    return keep(answers, screen?.id ?? null)
  }

  // The decision keeps the person's own words until they choose a wording. Sky's suggestion is an offer, not a rename.
  const worded =
    plan?.kind === 'deciding'
      ? plan.frames[(answers as DecidingAnswers).frame ?? -1]?.title
      : plan?.kind === 'decided'
        ? (answers as DecidedAnswers).wording
        : undefined
  const title = saved ? saved.title : (worded ?? run?.statement ?? 'Add a decision')
  const thinking = run?.status === 'thinking'
  useEffect(() => {
    onTitle(saved ? `Saved: ${title}` : thinking ? `Thinking… ${title}` : title)
  }, [onTitle, saved, thinking, title])

  const set = (patch: Partial<DecidingAnswers> | Partial<DecidedAnswers>) => {
    // A save in flight has already read the answers; a change now would be lost or half kept.
    if (busy) return
    setAnswers((current) => ({ ...current, ...patch }) as WizardAnswers)
  }
  const go = (to: number) => {
    const target = screens[to]
    if (!target || !plan) return
    setProblem('')
    setAnswers((current) =>
      plan.kind === 'deciding'
        ? decidingDefaults(target.id, plan, current as DecidingAnswers)
        : decidedDefaults(target.id, plan, current as DecidedAnswers),
    )
    setAt(target.id)
    document.querySelector('.sky-future .sky-scroll')?.scrollTo(0, 0)
  }
  const guarded = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setProblem('')
    try {
      await work()
    } catch (failure) {
      setProblem((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const next = () => {
    if (!plan || !screen || !ready || busy || adding || saved) return
    if (screen.id === 'answer' && (answers as DecidingAnswers).final === 'again') {
      // "Look at the options again" is a way back, not an answer to keep.
      setAnswers((current) => ({ ...current, final: undefined }))
      setAt('call')
      return
    }
    if (screen.id === 'open' || screen.id === 'record') {
      void guarded(async () => {
        await flush()
        const path = screen.id === 'open' ? 'open' : 'save'
        setSaved(await futureRequest<WizardSaved>(`/decisions/wizard/${id}/${path}`, {}))
        await onChanged()
      })
      return
    }
    go(index + 1)
  }
  useWizardKeys(next)

  const crumbs = (
    <nav className="sky-future-crumbs" aria-label="Breadcrumb">
      <FutureLink to="/future" navigate={navigate}>
        Future
      </FutureLink>
      <span aria-hidden="true">›</span>
      <FutureLink to="/future/decisions" navigate={navigate}>
        Decisions
      </FutureLink>
    </nav>
  )
  if (saved)
    return (
      <div className="sky-wizard">
        {crumbs}
        <h1>{title}</h1>
        <Saved saved={saved} today={today} navigate={navigate} />
      </div>
    )
  if (!run)
    return (
      <div className="sky-wizard">
        {crumbs}
        <h1>Add a decision</h1>
        {error ? (
          <div className="sky-future-empty">
            <h2>This decision isn’t being worked through</h2>
            <p>{error}</p>
            <Button variant="primary" onClick={() => navigate('/future/decisions')}>
              See your decisions
            </Button>
          </div>
        ) : (
          <p className="sky-future-hint" role="status">
            Loading…
          </p>
        )}
      </div>
    )
  if (!plan || !screen)
    return (
      <div className="sky-wizard">
        {crumbs}
        <h1>{title}</h1>
        <section className="sky-wizard-q sky-wizard-start">
          <Thinking
            run={run}
            onRetry={() => void guarded(async () => void (await act('/retry')))}
            onDiscard={() =>
              void guarded(async () => {
                await futureRequest(`/decisions/wizard/${id}/discard`, {})
                await onChanged()
                navigate('/future/decisions')
              })
            }
          />
          {problem && (
            <p className="sky-wizard-flag" role="alert">
              {problem}
            </p>
          )}
        </section>
      </div>
    )

  const stages = STAGES[pathOf(plan, answers)]
  const wide = screen.id === 'call' || screen.id === 'record'
  const later = () =>
    void guarded(async () => {
      await flush()
      await onChanged()
      navigate('/future/decisions')
    })
  return (
    <div className="sky-wizard" data-view="steps">
      {crumbs}
      <div className="sky-wizard-head">
        <h1>{title}</h1>
        <Button disabled={busy} onClick={later}>
          Finish later
        </Button>
      </div>
      <ol className="sky-wizard-path" aria-label="Where you are">
        {stages.map((stage, n) => (
          <li
            key={stage}
            data-state={n < screen.stage ? 'done' : n === screen.stage ? 'now' : undefined}
            aria-current={n === screen.stage ? 'step' : undefined}
          >
            {stage}
          </li>
        ))}
      </ol>
      <p className="sky-wizard-where">
        <b>{stages[screen.stage]}</b>, step {screen.stage + 1} of {stages.length}
      </p>
      <div className="sky-wizard-cols" data-wide={wide}>
        <section className="sky-wizard-q" aria-label={stages[screen.stage]}>
          {plan.kind === 'deciding' ? (
            <DecidingStep
              screen={screen.id}
              plan={plan}
              answers={answers as DecidingAnswers}
              set={set}
              today={today}
              adding={run.adding}
              onAdd={async (kind, text) => {
                await flush()
                await act('/add', { kind, text })
              }}
              onDropAddition={() => void guarded(async () => void (await act('/drop')))}
              onReword={async (text) => {
                await flush()
                await act('/reword', { text })
              }}
            />
          ) : (
            <DecidedStep screen={screen.id} plan={plan} answers={answers as DecidedAnswers} set={set} today={today} />
          )}
          {problem && (
            <p className="sky-wizard-flag" role="alert">
              {problem}
            </p>
          )}
          <div className="sky-wizard-actions">
            {index > 0 ? (
              <Button disabled={busy || adding} onClick={() => go(index - 1)}>
                Back
              </Button>
            ) : (
              <span />
            )}
            <span className="sky-wizard-hint">Number keys choose, Enter continues</span>
            <Button variant="primary" loading={busy} disabled={!ready || adding} onClick={next}>
              {screen.id === 'open' ? 'Save as open' : screen.id === 'record' ? 'Save decision' : 'Continue'}
            </Button>
          </div>
        </section>
        {!wide && <Rail plan={plan} answers={answers} today={today} />}
      </div>
    </div>
  )
}
