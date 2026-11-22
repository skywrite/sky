export type MarkKind = 'goal' | 'decision' | 'idea' | 'habit'

/** The small shape that says what kind of thing a line is: a goal, a decision, an idea or a habit. */
export function Mark({ kind }: { kind: MarkKind }) {
  return <i className="sky-future-mark" data-kind={kind} aria-hidden="true" />
}
