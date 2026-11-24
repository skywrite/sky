import type { ReactNode } from 'react'
import type { DecidingAnswers } from '#lib/decisionWizard/answers.ts'
import { BANDS, type Band, type DecidingPlan, type Feel } from '#lib/decisionWizard/plan.ts'
import { decidingRecord } from '#lib/decisionWizard/record.ts'
import { chosenOptions, finalCall, oddsFarApart, skyPick } from '#lib/decisionWizard/screens.ts'
import type { WizardSession } from '#lib/decisionWizard/session.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { niceDate } from '../dates.ts'
import { Chips } from './Chips.tsx'
import { type Choice, Choices } from './Choices.tsx'
import { CompareGrid } from './CompareGrid.tsx'
import { OddsScale } from './OddsScale.tsx'
import { RecordView } from './RecordView.tsx'

const FEEL: Record<Feel, string> = { like: 'You’d like this', mixed: 'Mixed', dislike: 'You’d dislike this' }
const NEXT_FEEL: Record<Feel, Feel> = { like: 'mixed', mixed: 'dislike', dislike: 'like' }
const toggled = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
const asChoices = (texts: string[]): Choice[] => texts.map((text) => ({ id: text, title: text }))
/** Said when the person is back from checking: the wizard has no way to know what they found. */
const CHECKED = (
  <p>
    Sky does not know how the checks came out. If what you found changed things, go back and change your odds, or untick
    an option that is off the table.
  </p>
)

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
 * One of Sky's answers, said big, with its reason under it. Sky writes each as a sentence that opens
 * with the answer ("Yes: …", "Very hard to undo. …"), so the opening is what gets said big.
 */
function Verdict({ question, text }: { question: string; text: string }) {
  const cut = /^(.{1,60}?)[:.]\s+(\S[\s\S]*)$/.exec(text.trim())
  const answer = cut ? cut[1]! : text.trim().replace(/[.]$/, '')
  const reason = cut ? cut[2]!.charAt(0).toUpperCase() + cut[2]!.slice(1) : ''
  return (
    <div className="sky-wizard-verdict">
      <span className="sky-wizard-verdict-q">{question}</span>
      <strong data-long={answer.length > 26 || undefined}>{answer}</strong>
      {reason && <p>{reason}</p>}
    </div>
  )
}

function Sky({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="sky-wizard-read">
      <h3>{title}</h3>
      {children}
    </div>
  )
}

export interface DecidingStepProps {
  screen: string
  plan: DecidingPlan
  answers: DecidingAnswers
  set: (patch: Partial<DecidingAnswers>) => void
  today: string
  /** What Sky is working out because the person typed it in */
  adding: WizardSession['adding']
  onAdd: (kind: 'option' | 'want', text: string) => Promise<void>
  onDropAddition: () => void
  onReword: (text: string) => Promise<void>
}

/** While Sky works out something the person typed in, the step says so instead of offering more choices. */
function Adding({ adding, onDrop }: { adding: NonNullable<WizardSession['adding']>; onDrop: () => void }) {
  return (
    <div className="sky-wizard-read" role="status">
      <h3>{adding.error ? 'Sky could not work that out' : `Sky is working out “${adding.text}”`}</h3>
      <p>
        {adding.error ??
          (adding.kind === 'option'
            ? 'It is going through what could happen, the odds, and what could go wrong, as it did for the others. This takes a few minutes.'
            : 'It is going through how each option affects it. This takes a minute or two.')}
      </p>
      {adding.error && (
        <button type="button" className="sky-wizard-link" onClick={onDrop}>
          Go on without it
        </button>
      )}
    </div>
  )
}

/** One step of deciding: a question, and Sky's choices for answering it. */
export function DecidingStep(props: DecidingStepProps) {
  const { screen, plan, answers, set, today, adding, onAdd, onDropAddition, onReword } = props
  const chosen = chosenOptions(plan, answers)
  const call = finalCall(plan, answers)

  if (screen === 'frame')
    return (
      <Step
        q="Which of these are you deciding?"
        lede="The same worry can be put as a narrower or a wider decision. The wider it is, the more options it leaves open."
      >
        <Choices
          items={plan.frames.map((frame, at) => ({
            id: String(at),
            title: frame.title,
            why: frame.why,
            ...(at === plan.frame ? { tag: 'Sky would start here', tagKind: 'sky' as const } : {}),
          }))}
          picked={answers.frame === undefined ? [] : [String(answers.frame)]}
          onPick={(id) => set({ frame: Number(id) })}
          other={{
            label: 'Put it another way…',
            hint: 'Your own words for the decision.',
            note: 'Sky thinks it through again from your wording. That takes several minutes.',
            onUse: onReword,
          }}
        />
      </Step>
    )

  if (screen === 'care')
    return (
      <Step
        q="How much care does it deserve?"
        lede="A choice that is cheap to undo should be made fast. One that is hard to undo is worth slowing down for."
      >
        <Choices
          sideBySide
          items={[
            {
              id: 'full',
              title: 'Take the full path',
              why: 'Weigh the options, put odds on them, and plan for what could go wrong.',
              ...(plan.care.suggest === 'full' ? { tag: 'Sky suggests this', tagKind: 'sky' as const } : {}),
            },
            {
              id: 'fast',
              title: 'Decide fast',
              why: 'Pick an option and say what you expect.',
              ...(plan.care.suggest === 'fast' ? { tag: 'Sky suggests this', tagKind: 'sky' as const } : {}),
            },
          ]}
          picked={answers.care ? [answers.care] : []}
          onPick={(id) => set({ care: id as 'full' | 'fast' })}
        />
        <Sky title="Why: Sky’s read">
          <div className="sky-wizard-verdicts">
            <Verdict question="Will it still matter in a year?" text={plan.care.year} />
            <Verdict question="How hard is it to undo?" text={plan.care.undo} />
          </div>
          <div className="sky-wizard-undo">
            <span className="sky-wizard-verdict-q">To undo, option by option</span>
            <ul>
              {plan.options.map((option) => (
                <li key={option.title}>
                  {option.short}
                  <em className="sky-wizard-level" data-level={option.undo}>
                    {option.undo}
                  </em>
                </li>
              ))}
            </ul>
          </div>
        </Sky>
      </Step>
    )

  if (screen === 'wants')
    return (
      <Step
        q="What do you want from it?"
        lede="Sky found these in your goals, your decisions in force, and your notes. Tick the ones that matter here."
      >
        {adding?.kind === 'want' ? (
          <Adding adding={adding} onDrop={onDropAddition} />
        ) : (
          <Choices
            multi
            items={plan.wants.map((want, at) => ({
              id: String(at),
              title: want.title,
              why: want.why,
              ...(want.inForce ? { tag: 'In force', tagKind: 'force' as const } : {}),
            }))}
            picked={(answers.wants ?? []).map(String)}
            onPick={(id) => set({ wants: toggled(answers.wants ?? [], Number(id)) })}
            other={{
              label: 'Add another…',
              hint: 'Something you want that is not listed.',
              note: 'Sky works out how each option affects it. That takes a minute or two.',
              onUse: (text) => onAdd('want', text),
            }}
          />
        )}
      </Step>
    )

  if (screen === 'top') {
    const picked = plan.wants.map((_, at) => at).filter((at) => (answers.wants ?? []).includes(at))
    return (
      <Step
        q="When these pull apart, which one comes first?"
        lede="Most options help one thing you want and cost another. Knowing which comes first makes the choice clearer."
      >
        <Choices
          items={picked.map((at) => ({ id: String(at), title: plan.wants[at]!.title, why: plan.wants[at]!.why }))}
          picked={answers.top === undefined ? [] : [String(answers.top)]}
          onPick={(id) => set({ top: Number(id) })}
        />
        {picked.some((at) => plan.wants[at]!.inForce) && (
          <p className="sky-wizard-flag">
            One of these is a decision in force. An option that breaks it means reopening that decision first.
          </p>
        )}
      </Step>
    )
  }

  if (screen === 'options') {
    const yours = plan.options.filter((option) => option.mine).length
    const number = (count: number) => ['none', 'one', 'two', 'three', 'four', 'five'][count] ?? String(count)
    return (
      <Step
        q="Which options are worth weighing?"
        lede={`You named ${number(yours)}. Sky added ${number(plan.options.length - yours)}. Keep at least two.`}
      >
        {adding?.kind === 'option' ? (
          <Adding adding={adding} onDrop={onDropAddition} />
        ) : (
          <Choices
            multi
            items={plan.options.map((option, at) => ({
              id: String(at),
              title: option.title,
              why: option.why,
              tag: option.mine ? 'You named this' : 'Sky added this',
              ...(option.mine ? {} : { tagKind: 'sky' as const }),
            }))}
            picked={chosen.map(String)}
            onPick={(id) => set({ options: toggled(chosen, Number(id)) })}
            other={{
              label: 'Add an option…',
              hint: 'One that Sky did not think of.',
              note: 'Sky works it out like the others: what could happen, the odds, what could go wrong. That takes a few minutes.',
              onUse: (text) => onAdd('option', text),
            }}
          />
        )}
      </Step>
    )
  }

  if (screen.startsWith('out:')) {
    const at = Number(screen.slice(4))
    const option = plan.options[at]!
    const mine = answers.odds?.[at]
    const far = oddsFarApart(plan, answers, at)
    const use = answers.oddsUse?.[at]
    return (
      <Step
        q={`What could happen if you choose “${option.title}”?`}
        lede="The ways it could go, with how much you would like each."
      >
        {option.breaks && <p className="sky-wizard-flag">This option breaks a decision in force: {option.breaks}.</p>}
        <div className="sky-wizard-outs">
          {option.outcomes.map((outcome, n) => {
            const feel = answers.feels?.[`${at}.${n}`] ?? outcome.feel
            return (
              <div className="sky-wizard-out" key={outcome.text}>
                <span className="sky-wizard-out-n">{n + 1}</span>
                <span>{outcome.text}</span>
                <button
                  type="button"
                  className="sky-wizard-feel"
                  data-feel={feel}
                  aria-label={`${FEEL[feel]}. Change`}
                  onClick={() => set({ feels: { ...answers.feels, [`${at}.${n}`]: NEXT_FEEL[feel] } })}
                >
                  {FEEL[feel]}
                </button>
              </div>
            )
          })}
        </div>
        <p className="sky-wizard-note">The marks are Sky’s read of what you said you want. Click one to change it.</p>
        <h3 className="sky-wizard-ask">{option.question}</h3>
        <p className="sky-wizard-note">Your read first. Sky shows its own once you have answered.</p>
        <OddsScale
          label={option.question}
          mine={mine}
          sky={option.odds}
          onPick={(band) => {
            // New odds reopen the question of whose to use.
            const { [at]: _settled, ...rest } = answers.oddsUse ?? {}
            set({ odds: { ...answers.odds, [at]: band }, oddsUse: rest })
          }}
        />
        {mine !== undefined && (
          <>
            <Sky title={`Sky’s read: ${BANDS[option.odds]}`}>
              <p>{option.oddsWhy}</p>
              {option.outside && <p>{option.outside}</p>}
            </Sky>
            {far ? (
              <>
                <p className="sky-wizard-gap">
                  You are well {mine > option.odds ? 'above' : 'below'} Sky. What do you know that Sky doesn’t?
                </p>
                <Chips
                  label="Whose odds to use"
                  labels={['Keep mine', 'Use Sky’s', 'Meet in the middle']}
                  picked={use === undefined ? [] : [(['mine', 'sky', 'middle'] as const).indexOf(use)]}
                  onPick={(n) =>
                    set({ oddsUse: { ...answers.oddsUse, [at]: (['mine', 'sky', 'middle'] as const)[n]! } })
                  }
                />
                {answers.oddsNote?.[at] ? (
                  <p className="sky-wizard-note">You told Sky: “{answers.oddsNote[at]}”</p>
                ) : (
                  <Choices
                    items={[]}
                    picked={[]}
                    onPick={() => {}}
                    label="Tell Sky what it is missing"
                    other={{
                      label: 'Tell Sky what it is missing…',
                      hint: 'Keeps your odds, and puts what you know in the record.',
                      onUse: (text) =>
                        set({
                          oddsNote: { ...answers.oddsNote, [at]: text },
                          oddsUse: { ...answers.oddsUse, [at]: 'mine' },
                        }),
                    }}
                  />
                )}
              </>
            ) : (
              <p className="sky-wizard-gap">
                {mine === option.odds ? 'You and Sky land in the same place.' : 'You and Sky are close.'}
              </p>
            )}
          </>
        )}
      </Step>
    )
  }

  if (screen === 'hinge') {
    const rows = chosen.flatMap((at) => plan.options[at]!.hinges.map((hinge) => ({ hinge, option: plan.options[at]! })))
    return (
      <Step
        q="What would change your mind?"
        lede="The choice rests on a few things you believe and have not checked. Where a check is cheap, it is worth doing first."
      >
        <div className="sky-wizard-outs">
          {rows.map(({ hinge, option }, n) => (
            <div className="sky-wizard-out" key={`${option.title}:${hinge.belief}`}>
              <span className="sky-wizard-out-n">{n + 1}</span>
              <span>
                {hinge.belief}
                <span className="sky-wizard-opt-why">
                  {hinge.sure} To check: {hinge.cost}
                </span>
              </span>
              <span className="sky-wizard-tag">Bears on: {option.short}</span>
            </div>
          ))}
        </div>
        {answers.hinge === 'checked' ? (
          <Sky title="You set these aside to check">{CHECKED}</Sky>
        ) : (
          <Choices
            items={[
              {
                id: 'check',
                title: 'Check first, then decide',
                why: 'Stop here for now. Sky sets a day to decide by and adds the checks to your to-dos.',
              },
              {
                id: 'now',
                title: 'Decide now',
                why: 'With what you know today. The unchecked guesses go into the record.',
              },
            ]}
            picked={answers.hinge ? [answers.hinge] : []}
            onPick={(id) => set({ hinge: id as 'check' | 'now' })}
          />
        )}
      </Step>
    )
  }

  if (screen === 'open') {
    const day = new PlainDate(today)
    const days = [day.addDays(7).ymd, day.addDays(14).ymd]
    const checks = chosen.flatMap((at) => plan.options[at]!.hinges).map((hinge, n) => ({ n, todo: hinge.todo }))
    const todos = checks.filter((check) => check.todo)
    return (
      <Step q="When will you decide?" lede="Sky keeps an open decision in view in every chat until it is made.">
        <Choices
          items={[
            { id: days[0]!, title: niceDate(days[0]!, today), why: 'In a week.' },
            { id: days[1]!, title: niceDate(days[1]!, today), why: 'In two weeks.' },
            ...(answers.by && !days.includes(answers.by)
              ? [{ id: answers.by, title: niceDate(answers.by, today), why: 'The day you chose.' }]
              : []),
          ]}
          picked={answers.by ? [answers.by] : []}
          onPick={(id) => set({ by: id })}
          other={{
            label: 'Another day…',
            hint: 'Any date.',
            kind: 'date',
            min: today,
            onUse: (text) => set({ by: text }),
          }}
        />
        {todos.length > 0 && (
          <>
            <h3 className="sky-wizard-ask">Add the checks to today’s to-dos?</h3>
            <Choices
              multi
              label="The checks to add as to-dos"
              items={todos.map((check) => ({ id: String(check.n), title: check.todo! }))}
              picked={(answers.todos ?? []).map(String)}
              onPick={(id) => set({ todos: toggled(answers.todos ?? [], Number(id)) })}
            />
          </>
        )}
      </Step>
    )
  }

  if (screen === 'call') {
    const fast = answers.care === 'fast'
    const close = plan.close && plan.close.every((at) => chosen.includes(at)) ? plan.close : null
    return (
      <Step
        q="Your call"
        lede={
          fast
            ? 'The options you named, and the ones Sky added.'
            : 'Each option against what you want, with the odds you gave and how hard it is to undo.'
        }
      >
        {answers.hinge === 'checked' && <Sky title="You saved this as open to check a few things first">{CHECKED}</Sky>}
        {!fast && (
          <>
            <CompareGrid
              plan={plan}
              answers={answers}
              onEffect={(key, effect) => set({ effects: { ...answers.effects, [key]: effect } })}
            />
            <p className="sky-wizard-note">Helps, Costs and No effect are Sky’s read. Click a cell to change it.</p>
            {close && (
              <Sky title="Two of these are close">
                <p>
                  “{plan.options[close[0]]!.title}” and “{plan.options[close[1]]!.title}” come out close. Between two
                  close options you cannot be far wrong, so this need not take long.
                </p>
              </Sky>
            )}
          </>
        )}
        <h3 className="sky-wizard-ask">Which one?</h3>
        <p className="sky-wizard-note">Choose before Sky says what it would do.</p>
        <Choices
          label="Your call"
          items={chosen.map((at) => ({ id: String(at), title: plan.options[at]!.title, why: plan.options[at]!.why }))}
          picked={answers.call === undefined ? [] : [String(answers.call)]}
          onPick={(id) => set({ call: Number(id), final: undefined })}
        />
      </Step>
    )
  }

  if (screen === 'answer' && answers.call !== undefined) {
    const mine = plan.options[answers.call]!
    const sky = skyPick(plan, answers)
    const same = sky === answers.call
    return (
      <Step
        q={same ? 'Sky would make the same call' : `Sky would choose “${plan.options[sky]!.title}”`}
        lede="Sky held its answer back until you gave yours."
      >
        {same ? (
          <Sky title="The strongest case against it">
            <p>{mine.against}</p>
          </Sky>
        ) : (
          <>
            <Sky title="Why">
              <p>{plan.options[sky]!.for}</p>
            </Sky>
            <Sky title="What your call has going for it">
              <p>{mine.for}</p>
            </Sky>
            <Sky title="The strongest case against your call">
              <p>{mine.against}</p>
            </Sky>
            {mine.breaks && (
              <p className="sky-wizard-flag">
                Your call breaks a decision in force: {mine.breaks}. Keeping it means reopening that decision first.
              </p>
            )}
          </>
        )}
        <Choices
          label="Keep your call or change it"
          items={[
            { id: 'keep', title: 'Keep my call', why: mine.title },
            same
              ? { id: 'again', title: 'Look at the options again', why: 'Back to the comparison.' }
              : { id: 'switch', title: 'Switch to Sky’s', why: plan.options[sky]!.title },
          ]}
          picked={answers.final ? [answers.final] : []}
          onPick={(id) => set({ final: id as DecidingAnswers['final'] })}
        />
      </Step>
    )
  }

  if (call === undefined) return null
  const option = plan.options[call]!

  if (screen === 'wrong') {
    const own = answers.ownWrong?.[call] ?? []
    const picked = answers.wrong?.[call] ?? []
    const pick = (text: string) => set({ wrong: { ...answers.wrong, [call]: toggled(picked, text) } })
    return (
      <Step
        q="It is a year from now and this went badly. Why?"
        lede="Picturing the failure now shows what to guard against. Tick the ones that worry you."
      >
        <p className="sky-wizard-group">In your hands</p>
        <Choices
          multi
          label="Reasons in your hands"
          items={asChoices([...option.wrongMine, ...own])}
          picked={picked}
          onPick={pick}
        />
        <p className="sky-wizard-group">Out of your hands</p>
        <Choices
          multi
          label="Reasons out of your hands"
          items={asChoices(option.wrongLuck)}
          picked={picked}
          onPick={pick}
          other={{
            label: 'Add a reason…',
            hint: 'Something else that could sink it.',
            onUse: (text) =>
              set({
                ownWrong: { ...answers.ownWrong, [call]: [...own, text] },
                wrong: { ...answers.wrong, [call]: [...picked, text] },
              }),
          }}
        />
      </Step>
    )
  }

  if (screen === 'rules') {
    const own = answers.ownRules?.[call] ?? []
    const picked = answers.rules?.[call] ?? []
    return (
      <Step
        q="What will you do if it starts going wrong?"
        lede="Sky turned the worries into rules you can set now, while nothing is on fire. Tick the ones you will hold to."
      >
        <Choices
          multi
          items={asChoices([...option.rules, ...own])}
          picked={picked}
          onPick={(text) => set({ rules: { ...answers.rules, [call]: toggled(picked, text) } })}
          other={{
            label: 'Add a rule…',
            hint: 'If this happens by this date, then I will…',
            onUse: (text) =>
              set({
                ownRules: { ...answers.ownRules, [call]: [...own, text] },
                rules: { ...answers.rules, [call]: [...picked, text] },
              }),
          }}
        />
      </Step>
    )
  }

  if (screen === 'expect') {
    const own = answers.ownExpect?.[call] ?? []
    return (
      <Step
        q="What do you expect to happen?"
        lede="This is the part you cannot rebuild later. Once you know how it went, you will not remember what you thought today."
      >
        <Choices
          items={asChoices([...option.expect, ...own])}
          picked={answers.expect?.[call] ? [answers.expect[call]!] : []}
          onPick={(text) => set({ expect: { ...answers.expect, [call]: text } })}
          other={{
            label: 'Say it another way…',
            hint: 'What you expect to see, and by when.',
            onUse: (text) =>
              set({
                ownExpect: { ...answers.ownExpect, [call]: [...own, text] },
                expect: { ...answers.expect, [call]: text },
              }),
          }}
        />
      </Step>
    )
  }

  if (screen === 'sure') {
    const look = answers.look ?? []
    const days = option.look
    const labels = [...days.map((day) => niceDate(day, today)), ...(days.length > 1 ? ['Both'] : [])]
    const picked =
      days.length > 1 && days.every((day) => look.includes(day))
        ? [days.length]
        : days.flatMap((day, n) => (look.includes(day) ? [n] : []))
    return (
      <Step
        q="How sure are you that it turns out that way?"
        lede="It starts from the odds you gave earlier. Change it if writing the expectation down moved you."
      >
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
      <Step
        q="The record"
        lede="This is what gets saved, in the decision’s own file. Every line is yours or one you chose."
      >
        <RecordView record={decidingRecord(plan, answers)} today={today} />
        <h3 className="sky-wizard-ask">Once it is carried out, is there anything left to keep?</h3>
        <Chips
          label="Whether it stays in force"
          labels={['No. Once it is done, it is done', 'Yes. It stays in force']}
          picked={[answers.force ? 1 : 0]}
          onPick={(n) => set({ force: n === 1 })}
        />
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
