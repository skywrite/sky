import { Button, Checkbox, SegmentedControl, Textarea, TextInput } from '@mantine/core'
import { useRef, useState } from 'react'
import type { FutureDecisionDraft, FutureGoal, FutureOpenQuestion } from '../../../service/handler/future/types.ts'
import { FutureLink } from './FutureLink.tsx'
import { futureRequest } from './request.ts'

/**
 * Add a decision. The person says it in their own words; Sky drafts the rest
 * from those words and the notebook (`decisions:clarify`), they correct the
 * draft, and it is saved (`decisions:create`). They can also write every field
 * themselves.
 */
export function NewDecision({
  goals,
  today,
  navigate,
  onCreated,
}: {
  goals: FutureGoal[]
  today: string
  navigate: (to: string) => void
  onCreated: () => Promise<void>
}) {
  const [stage, setStage] = useState<'say' | 'form'>('say')
  const [drafting, setDrafting] = useState(false)
  const [statement, setStatement] = useState('')
  const [title, setTitle] = useState('')
  const [decided, setDecided] = useState(false)
  const [decision, setDecision] = useState('')
  const [inForce, setInForce] = useState(false)
  const [when, setWhen] = useState('')
  const [target, setTarget] = useState('')
  const [context, setContext] = useState('')
  const [outcomes, setOutcomes] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [links, setLinks] = useState<string[]>([])
  const [category, setCategory] = useState('Professional')
  const [questions, setQuestions] = useState<Array<FutureOpenQuestion & { answer: string }>>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // A draft that comes back after the person moved on is dropped.
  const run = useRef(0)

  const draft = async (answers?: Array<{ question: string; answer: string }>) => {
    const at = ++run.current
    setDrafting(true)
    setError('')
    try {
      const drafted = await futureRequest<FutureDecisionDraft>('/decisions/draft', {
        statement: statement.trim(),
        ...(answers?.length ? { answers } : {}),
      })
      if (at !== run.current) return
      const named = drafted.rel.flatMap((entry) => (/^goals\//i.test(entry) ? [entry.slice(6).toLowerCase()] : []))
      setTitle(drafted.title)
      setDecided(Boolean(drafted.decision))
      setDecision(drafted.decision ?? '')
      setTarget(drafted.target && /^\d{4}-\d{2}-\d{2}/.test(drafted.target) ? drafted.target.slice(0, 10) : '')
      setContext(drafted.context)
      setOutcomes(drafted.desiredOutcomes)
      setChosen(goals.filter((goal) => named.includes(goal.name.toLowerCase())).map((goal) => goal.name))
      setLinks(drafted.rel.filter((entry) => !/^goals\//i.test(entry)))
      setQuestions(drafted.openQuestions.map((question) => ({ ...question, answer: question.proposed })))
      setStage('form')
    } catch (problem) {
      if (at === run.current) setError((problem as Error).message)
    } finally {
      if (at === run.current) setDrafting(false)
    }
  }
  const stopDrafting = () => {
    run.current++
    setDrafting(false)
  }
  const ready =
    title.trim() !== '' && context.trim() !== '' && outcomes.trim() !== '' && (!decided || decision.trim() !== '')

  return (
    <div className="sky-future-new">
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

      {drafting ? (
        <div className="sky-future-panel" role="status">
          <h3>Sky is drafting this</h3>
          <p>It is reading your notebook for what bears on “{statement.trim()}”. This usually takes under a minute.</p>
          <div className="sky-future-panel-actions">
            <Button variant="secondary" onClick={stopDrafting}>
              Stop
            </Button>
          </div>
        </div>
      ) : stage === 'say' ? (
        <form
          className="sky-future-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (statement.trim()) void draft()
          }}
        >
          <Textarea
            label="What’s the decision?"
            description="Say it the way you would out loud: one you are facing, or one you have already made."
            placeholder="e.g. Whether to hire a second engineer this quarter"
            size="md"
            autosize
            minRows={3}
            value={statement}
            onChange={(event) => setStatement(event.currentTarget.value)}
            data-autofocus
          />
          {error && (
            <p className="sky-future-form-error" role="alert">
              {error}
            </p>
          )}
          <div className="sky-future-new-actions">
            <Button variant="primary" type="submit" disabled={!statement.trim()}>
              Draft it with Sky
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                // The words go in as the title when they fit on one line; the rest is theirs to write.
                if (!title && statement.trim().length <= 160) setTitle(statement.trim())
                setStage('form')
              }}
            >
              Write it myself
            </Button>
          </div>
        </form>
      ) : (
        <form
          className="sky-future-form"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!ready || saving) return
            setSaving(true)
            setError('')
            try {
              await futureRequest('/decisions', {
                title: title.trim(),
                context: context.trim(),
                desiredOutcomes: outcomes.trim(),
                decision: decided ? decision.trim() : '',
                inForce: decided && inForce,
                when: when || null,
                target: decided ? null : target || null,
                goals: chosen,
                rel: links,
                category,
              })
              await onCreated()
            } catch (problem) {
              setError((problem as Error).message)
              setSaving(false)
            }
          }}
        >
          {questions.length > 0 && (
            <div className="sky-future-panel sky-future-questions">
              <h3>Sky wasn’t sure about {questions.length === 1 ? 'one thing' : `${questions.length} things`}</h3>
              <p>Each has the answer Sky assumed. Change any that are wrong, then redraft.</p>
              {questions.map((question, index) => (
                <TextInput
                  key={question.question}
                  label={question.question}
                  description={question.why}
                  value={question.answer}
                  onChange={(event) => {
                    const answer = event.currentTarget.value
                    setQuestions((all) => all.map((item, at) => (at === index ? { ...item, answer } : item)))
                  }}
                />
              ))}
              <div className="sky-future-panel-actions">
                <Button
                  variant="secondary"
                  disabled={!statement.trim()}
                  onClick={() =>
                    void draft(
                      questions
                        .filter((question) => question.answer.trim())
                        .map(({ question, answer }) => ({ question, answer: answer.trim() })),
                    )
                  }
                >
                  Redraft with these answers
                </Button>
              </div>
            </div>
          )}
          <TextInput
            label="The decision"
            description="A few words, as it will be listed."
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            maxLength={160}
          />
          <div>
            <div className="sky-future-form-label" id="sky-future-stands-label">
              Where does it stand?
            </div>
            <SegmentedControl
              aria-labelledby="sky-future-stands-label"
              data={[
                { value: 'open', label: 'Still open' },
                { value: 'decided', label: 'Already decided' },
              ]}
              value={decided ? 'decided' : 'open'}
              onChange={(value) => setDecided(value === 'decided')}
            />
          </div>
          {decided && (
            <>
              <Textarea
                label="What did you decide?"
                size="sm"
                autosize
                minRows={2}
                value={decision}
                onChange={(event) => setDecision(event.currentTarget.value)}
              />
              <Checkbox
                label="It’s still in force"
                description="A rule, a freeze, a quit: it keeps binding what you do until you end it. Sky keeps it in view in every chat."
                checked={inForce}
                onChange={(event) => setInForce(event.currentTarget.checked)}
              />
            </>
          )}
          <div className="sky-future-form-dates">
            <TextInput
              label={decided ? 'When did you decide?' : 'When did it come up?'}
              description="Leave empty for today."
              type="date"
              max={today}
              value={when}
              onChange={(event) => setWhen(event.currentTarget.value)}
            />
            {!decided && (
              <TextInput
                label="Decide by"
                description="Leave empty for no date."
                type="date"
                value={target}
                onChange={(event) => setTarget(event.currentTarget.value)}
              />
            )}
          </div>
          <Textarea
            label="What’s going on?"
            description="The situation, and why this needs deciding."
            size="sm"
            autosize
            minRows={4}
            value={context}
            onChange={(event) => setContext(event.currentTarget.value)}
          />
          <Textarea
            label="What do you want out of it?"
            size="sm"
            autosize
            minRows={3}
            value={outcomes}
            onChange={(event) => setOutcomes(event.currentTarget.value)}
          />
          {goals.length > 0 && (
            <fieldset className="sky-future-choices">
              <legend>Goals it weighs on</legend>
              {goals.map((goal) => (
                <Checkbox
                  key={goal.name}
                  label={goal.title}
                  checked={chosen.includes(goal.name)}
                  onChange={(event) => {
                    const on = event.currentTarget.checked
                    setChosen((all) => (on ? [...all, goal.name] : all.filter((name) => name !== goal.name)))
                  }}
                />
              ))}
            </fieldset>
          )}
          {links.length > 0 && (
            <fieldset className="sky-future-choices">
              <legend>Also linked</legend>
              <p className="sky-future-note">Sky found these in your notebook. Remove any that don’t belong.</p>
              <div className="sky-future-links">
                {links.map((link) => (
                  <span key={link} className="sky-future-linked">
                    {link}
                    <button
                      type="button"
                      aria-label={`Remove ${link}`}
                      onClick={() => setLinks((all) => all.filter((entry) => entry !== link))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </fieldset>
          )}
          <div>
            <div className="sky-future-form-label" id="sky-future-decision-area-label">
              Part of life
            </div>
            <SegmentedControl
              aria-labelledby="sky-future-decision-area-label"
              data={['Professional', 'Personal']}
              value={category}
              onChange={setCategory}
            />
          </div>
          {error && (
            <p className="sky-future-form-error" role="alert">
              {error}
            </p>
          )}
          <div className="sky-future-new-actions">
            <Button variant="primary" type="submit" loading={saving} disabled={!ready}>
              Add decision
            </Button>
            <Button variant="secondary" disabled={saving} onClick={() => navigate('/future/decisions')}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
