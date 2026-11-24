import type { ReactNode } from 'react'
import type { DecidedAnswers } from '#lib/decisionWizard/answers.ts'
import { BANDS, type Band, type DecidedPlan } from '#lib/decisionWizard/plan.ts'
import { decidedRecord } from '#lib/decisionWizard/record.ts'
import { niceDate } from '../dates.ts'
import { Chips } from './Chips.tsx'
import { type Choice, Choices } from './Choices.tsx'
import { RecordView } from './RecordView.tsx'

const toggled = (list: string[], value: string): string[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
const SKY = { tag: 'Sky would use this', tagKind: 'sky' as const }

function Step({ q, lede, children }: { q: string; lede: string; children: ReactNode }) {
  return (
    <>
      <h2>{q}</h2>
      <p className="sky-wizard-lede">{lede}</p>
      {children}
    </>
  )
}

/**
 * One step of recording a decision that was already made. The answers are the
 * person's own facts, so nothing typed in here sends Sky back to think.
 */
export function DecidedStep({
  screen,
  plan,
  answers,
  set,
  today,
}: {
  screen: string
  plan: DecidedPlan
  answers: DecidedAnswers
  set: (patch: Partial<DecidedAnswers>) => void
  today: string
}) {
  const own = answers.own ?? {}
  const mine = (texts: string[] = []): Choice[] =>
    texts.map((text) => ({ id: text, title: text, why: 'In your words.' }))

  if (screen === 'wording')
    return (
      <Step q="What did you decide?" lede="As you said it, and with anything you added later.">
        <Choices
          items={[
            ...plan.wordings.map((wording, at) => ({
              id: wording.title,
              title: wording.title,
              why: wording.why,
              ...(at === plan.wording ? SKY : {}),
            })),
            ...mine(own.wordings),
          ]}
          picked={answers.wording ? [answers.wording] : []}
          onPick={(text) => set({ wording: text })}
          other={{
            label: 'Put it another way…',
            hint: 'Your own words for what you decided.',
            onUse: (text) => set({ wording: text, own: { ...own, wordings: [...(own.wordings ?? []), text] } }),
          }}
        />
      </Step>
    )

  if (screen === 'when') {
    const known = plan.when.map((day) => day.date)
    return (
      <Step
        q="When did you decide it?"
        lede={
          known.length
            ? 'A decision is dated by the day it was made, not the day it was written down.'
            : 'Your notebook does not show the day. A decision is dated by the day it was made, so pick it.'
        }
      >
        <Choices
          items={[
            ...plan.when.map((day, at) => ({
              id: day.date,
              title: niceDate(day.date, today),
              why: day.why,
              ...(at === 0 ? SKY : {}),
            })),
            ...(answers.when && !known.includes(answers.when)
              ? [{ id: answers.when, title: niceDate(answers.when, today), why: 'The day you chose.' }]
              : []),
            ...(known.includes(today) || answers.when === today
              ? []
              : [{ id: today, title: 'Today', why: 'You are deciding it now.' }]),
          ]}
          picked={answers.when ? [answers.when] : []}
          onPick={(day) => set({ when: day })}
          other={{
            label: 'Another day…',
            hint: 'If the notebook has it wrong.',
            kind: 'date',
            max: today,
            onUse: (day) => set({ when: day }),
          }}
        />
      </Step>
    )
  }

  if (screen === 'knew') {
    const picked = answers.knew ?? []
    const pick = (text: string) => set({ knew: toggled(picked, text) })
    return (
      <Step
        q="What did you know that day?"
        lede="A record written later tends to borrow from what happened next. Sky split your notes by date, so the record rests only on what you knew then."
      >
        {plan.knew.length > 0 && (
          <>
            <p className="sky-wizard-group">Known by {answers.when ? niceDate(answers.when, today) : 'that day'}</p>
            <Choices
              multi
              label="Known that day"
              items={plan.knew.map((item) => ({ id: item.text, title: item.text, why: item.source }))}
              picked={picked}
              onPick={pick}
            />
          </>
        )}
        {plan.since.length > 0 && (
          <>
            <p className="sky-wizard-group">Learned since, and kept out of the reasons</p>
            <Choices
              multi
              label="Learned since"
              items={plan.since.map((item) => ({ id: item.text, title: item.text, why: item.source }))}
              picked={picked}
              onPick={pick}
            />
            <p className="sky-wizard-note">Tick one of these only if you did know it on the day.</p>
          </>
        )}
      </Step>
    )
  }

  if (screen === 'wants') {
    const picked = answers.wants ?? []
    return (
      <Step
        q="What did you want from it?"
        lede="Sky’s read of your notes from that time. Untick anything that was not on your mind."
      >
        <Choices
          multi
          items={[
            ...plan.wants.map((want) => ({ id: want.title, title: want.title, why: want.why })),
            ...mine(own.wants),
          ]}
          picked={picked}
          onPick={(text) => set({ wants: toggled(picked, text) })}
          other={{
            label: 'Add another…',
            hint: 'Something you wanted that is not listed.',
            onUse: (text) => set({ wants: [...picked, text], own: { ...own, wants: [...(own.wants ?? []), text] } }),
          }}
        />
      </Step>
    )
  }

  if (screen === 'others') {
    const picked = answers.others ?? []
    return (
      <Step
        q="What else was on the table?"
        lede={
          plan.others.length
            ? 'The options you did not take belong in the record. They show what you chose over.'
            : 'Your notes show no other options. Add any you weighed, or go on.'
        }
      >
        <Choices
          multi
          items={[
            ...plan.others.map((other) => ({ id: other.title, title: other.title, why: other.why })),
            ...mine(own.others),
          ]}
          picked={picked}
          onPick={(text) => set({ others: toggled(picked, text) })}
          other={{
            label: 'Add an option…',
            hint: 'Another one you weighed.',
            onUse: (text) => set({ others: [...picked, text], own: { ...own, others: [...(own.others ?? []), text] } }),
          }}
        />
      </Step>
    )
  }

  if (screen === 'force') {
    const until = answers.until ?? plan.force.until
    const suggested = (id: string) => (plan.force.suggest === id ? { ...SKY, why: plan.force.why } : {})
    return (
      <Step
        q="Does it still bind what you do?"
        lede="A decision in force stays in view in every chat until you end it."
      >
        <Choices
          items={[
            ...(until
              ? [
                  {
                    id: 'until',
                    title: `Yes, until ${until.replace(/[.]$/, '')}`,
                    why: 'It holds until that happens.',
                    ...suggested('until'),
                  },
                ]
              : []),
            { id: 'noEnd', title: 'Yes, with no end', why: 'It becomes how you do things.', ...suggested('noEnd') },
            {
              id: 'once',
              title: 'No. It was carried out once',
              why: 'There is nothing left to keep.',
              ...suggested('once'),
            },
          ]}
          picked={answers.force ? [answers.force] : []}
          onPick={(id) => set({ force: id as DecidedAnswers['force'], ...(id === 'until' && until ? { until } : {}) })}
          other={{
            label: 'Until something else…',
            hint: 'What would end it.',
            onUse: (text) => set({ force: 'until', until: text }),
          }}
        />
      </Step>
    )
  }

  if (screen === 'expect')
    return (
      <Step q="What did you expect to happen?" lede="What you expected on the day, not what you expect now.">
        {plan.quote && (
          <div className="sky-wizard-read">
            <h3>{plan.quote.source}</h3>
            <p>“{plan.quote.text.replace(/^[“"]|[”"]$/g, '')}”</p>
          </div>
        )}
        <Choices
          items={[
            ...plan.expect.map((item) => ({ id: item.text, title: item.text, why: item.why })),
            ...mine(own.expect),
          ]}
          picked={answers.expect ? [answers.expect] : []}
          onPick={(text) => set({ expect: text })}
          other={{
            label: 'Say it another way…',
            hint: 'What you expected to see, and by when.',
            onUse: (text) => set({ expect: text, own: { ...own, expect: [...(own.expect ?? []), text] } }),
          }}
        />
      </Step>
    )

  if (screen === 'sure') {
    const look = answers.look ?? []
    const days = plan.look
    const labels = [...days.map((day) => niceDate(day, today)), ...(days.length > 1 ? ['Both'] : [])]
    const picked =
      days.length > 1 && days.every((day) => look.includes(day))
        ? [days.length]
        : days.flatMap((day, n) => (look.includes(day) ? [n] : []))
    return (
      <Step q="How sure were you?" lede="As honestly as you can remember it. Sky cannot check this one.">
        <Chips
          label="How sure"
          labels={[...BANDS]}
          picked={answers.sure === undefined ? [] : [answers.sure]}
          onPick={(band) => set({ sure: band as Band })}
        />
        <h3 className="sky-wizard-ask">When should Sky ask how it went?</h3>
        <p className="sky-wizard-note">A reminder appears on your day page that day.</p>
        <Chips
          label="When to look back"
          labels={labels}
          picked={picked}
          onPick={(n) => set({ look: n === days.length ? [...days] : [days[n]!] })}
        />
      </Step>
    )
  }

  if (screen === 'record')
    return (
      <Step q="The record" lede="This is what gets saved, in the decision’s own file, dated the day you made it.">
        <RecordView record={decidedRecord(plan, answers)} today={today} />
        <h3 className="sky-wizard-ask">Which part of life is it?</h3>
        <Chips
          label="Part of life"
          labels={['Professional', 'Personal']}
          picked={[(answers.category ?? plan.category) === 'Personal' ? 1 : 0]}
          onPick={(n) => set({ category: n === 1 ? 'Personal' : 'Professional' })}
        />
      </Step>
    )

  return null
}
