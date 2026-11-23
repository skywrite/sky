import { Button } from '@mantine/core'
import type { FutureDecision } from '../../../service/handler/future/types.ts'
import { niceDate } from './dates.ts'
import { TieLink } from './TieLink.tsx'
import { listed } from './words.ts'

const GROUPS: Array<{ state: FutureDecision['state']; title: string }> = [
  { state: 'open', title: 'To decide' },
  { state: 'inForce', title: 'In force' },
  { state: 'decided', title: 'Decided' },
]

/** Every decision by where it stands: the open ones, the ones in force, and the ones made. */
export function DecisionsList({
  decisions,
  today,
  navigate,
  onAdd,
}: {
  decisions: FutureDecision[]
  today: string
  navigate: (to: string) => void
  onAdd: () => void
}) {
  if (!decisions.length)
    return (
      <div className="sky-future-empty">
        <h2>No decisions yet</h2>
        <p>
          Write down a decision you are facing, or one you have made. Sky keeps the open ones and the ones in force in
          view in every chat.
        </p>
        <Button variant="primary" onClick={onAdd}>
          ＋ Add a decision
        </Button>
      </div>
    )
  const when = (decision: FutureDecision): string | null => {
    const since = decision.since ? niceDate(decision.since, today) : null
    if (decision.state === 'open')
      return decision.target ? `Decide by ${niceDate(decision.target, today)}` : since && `Open since ${since}`
    return since && (decision.state === 'inForce' ? `Since ${since}` : `Decided ${since}`)
  }
  return (
    <>
      {GROUPS.map(({ state, title }) => {
        const group = decisions.filter((decision) => decision.state === state)
        if (!group.length) return null
        return (
          <section className="sky-future-section" key={state} aria-labelledby={`sky-future-decisions-${state}`}>
            <h2 id={`sky-future-decisions-${state}`}>
              {title}
              <small>{group.length}</small>
            </h2>
            <div className="sky-future-rows">
              {group.map((decision) => (
                <div className="sky-future-row" key={decision.file}>
                  <span>
                    <TieLink
                      kind="decision"
                      name={decision.name}
                      title={decision.title}
                      file={decision.file}
                      navigate={navigate}
                    />
                    <span className="sky-future-under">
                      {decision.goals.length
                        ? `Weighs on ${listed(decision.goals.map((goal) => goal.title))}`
                        : 'Not tied to a goal'}
                    </span>
                  </span>
                  {when(decision) && <span className="sky-future-meta">{when(decision)}</span>}
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </>
  )
}
