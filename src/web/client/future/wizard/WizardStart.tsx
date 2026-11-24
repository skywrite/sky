import { Button } from '@mantine/core'
import { useEffect, useState } from 'react'
import type { FindsView, WizardSession } from '#lib/decisionWizard/session.ts'
import { FutureLink } from '../FutureLink.tsx'
import { futureRequest } from '../request.ts'
import { wizardHref } from '../routes.ts'
import { Chips } from './Chips.tsx'
import { Choices } from './Choices.tsx'
import { useWizardKeys } from './useWizardKeys.ts'
import './Wizard.css'

/**
 * Where a decision starts: the ones Sky found in the last two weeks of the
 * notebook, or the person's own words. Then one question, whether it is still
 * open or already made, and Sky starts thinking.
 */
export function WizardStart({
  navigate,
  onChanged,
}: {
  navigate: (to: string) => void
  /** A run was started: the list of decisions being worked through should be read again */
  onChanged: () => Promise<void>
}) {
  const [finds, setFinds] = useState<FindsView | null>(null)
  const [own, setOwn] = useState<string[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [decided, setDecided] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [looks, setLooks] = useState(0)

  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const next = await futureRequest<FindsView>('/decisions/finds')
        if (!live) return
        setFinds(next)
        if (next.status === 'looking') timer = setTimeout(() => void read(), 2000)
      } catch (problem) {
        if (live) setFinds({ status: 'failed', finds: [], error: (problem as Error).message })
      }
    }
    void read()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [looks])

  const found = finds?.finds ?? []
  const find = found.find((item) => item.title === picked)
  const pick = (title: string) => {
    setPicked(title)
    // Sky's read of a find is a starting point; the chips below let the person say otherwise.
    setDecided(found.find((item) => item.title === title)?.decided ?? null)
  }
  const start = async () => {
    if (!picked || decided === null || busy) return
    setBusy(true)
    setError('')
    try {
      const run = await futureRequest<WizardSession>('/decisions/wizard', {
        statement: picked,
        why: find?.why ?? null,
        decided,
      })
      void onChanged()
      navigate(wizardHref(run.id))
    } catch (problem) {
      setError((problem as Error).message)
      setBusy(false)
    }
  }
  useWizardKeys(() => void start())
  const lookAgain = async () => {
    setFinds({ status: 'looking', finds: [], error: null })
    await futureRequest('/decisions/finds', { again: true }).catch(() => {})
    setLooks((count) => count + 1)
  }

  return (
    <div className="sky-wizard">
      <nav className="sky-future-crumbs" aria-label="Breadcrumb">
        <FutureLink to="/future" navigate={navigate}>
          Future
        </FutureLink>
        <span aria-hidden="true">›</span>
        <FutureLink to="/future/decisions" navigate={navigate}>
          Decisions
        </FutureLink>
      </nav>
      <h1>Add a decision</h1>
      <section className="sky-wizard-q sky-wizard-start">
        <h2>What’s the decision?</h2>
        <p className="sky-wizard-lede">
          {finds?.status === 'looking'
            ? 'Sky is looking through your last two weeks for decisions you are facing, or made without writing down. You can also say your own.'
            : found.length
              ? 'Sky went through your last two weeks and found these. Pick one, or say your own.'
              : 'Say it the way you would out loud: one you are facing, or one you have already made.'}
        </p>
        {finds?.status === 'looking' && (
          <p className="sky-wizard-note" role="status">
            Looking through your notebook…
          </p>
        )}
        {finds?.status === 'failed' && (
          <p className="sky-wizard-flag" role="alert">
            {finds.error}{' '}
            <button type="button" className="sky-wizard-link" onClick={() => void lookAgain()}>
              Look again
            </button>
          </p>
        )}
        {finds?.status === 'ready' && !found.length && (
          <p className="sky-wizard-note">
            Sky found no decisions in your last two weeks that are not already written down.{' '}
            <button type="button" className="sky-wizard-link" onClick={() => void lookAgain()}>
              Look again
            </button>
          </p>
        )}
        <Choices
          items={[
            ...found.map((item) => ({
              id: item.title,
              title: item.title,
              why: item.why,
              tag: item.decided ? 'Looks decided' : 'Still deciding',
              ...(item.decided ? { tagKind: 'force' as const } : {}),
            })),
            ...own.map((text) => ({ id: text, title: text, why: 'In your words.' })),
          ]}
          picked={picked ? [picked] : []}
          onPick={pick}
          other={{
            label: 'Something else…',
            hint: 'Say it the way you would out loud.',
            placeholder: 'e.g. Whether to renew the office lease',
            onUse: (text) => {
              setOwn((all) => (all.includes(text) ? all : [...all, text]))
              setPicked(text)
              setDecided(null)
            },
          }}
        />
        {picked && (
          <>
            <h3 className="sky-wizard-ask">Where does it stand?</h3>
            <Chips
              label="Where it stands"
              labels={['I’m still deciding', 'I’ve already decided']}
              picked={decided === null ? [] : [decided ? 1 : 0]}
              onPick={(at) => setDecided(at === 1)}
            />
          </>
        )}
        {error && (
          <p className="sky-wizard-flag" role="alert">
            {error}
          </p>
        )}
        <div className="sky-wizard-actions">
          <span />
          <Button variant="primary" loading={busy} disabled={!picked || decided === null} onClick={() => void start()}>
            Continue
          </Button>
        </div>
        <p className="sky-wizard-note">
          Sky then thinks it through once, at full effort. That can take 10 to 15 minutes, and you can leave while it
          does.
        </p>
      </section>
    </div>
  )
}
