import { fileHref } from '../explorer/explorer.tsx'
import { FutureLink } from './FutureLink.tsx'
import { Mark, type MarkKind } from './Mark.tsx'
import { decisionHref, goalHref } from './routes.ts'

/**
 * One thing tied to a goal, as a link to where it lives: another goal's page,
 * a decision's page, a habit's page, or the file of an idea.
 */
export function TieLink({
  kind,
  name,
  title,
  file,
  navigate,
}: {
  kind: MarkKind
  name: string
  title: string
  /** An idea opens as its file */
  file?: string
  navigate: (to: string) => void
}) {
  const to =
    kind === 'goal'
      ? goalHref(name)
      : kind === 'decision'
        ? decisionHref(name)
        : kind === 'habit'
          ? `/streaks/${encodeURIComponent(name)}`
          : fileHref(file ?? '')
  return (
    <FutureLink to={to} navigate={navigate} className="sky-future-item">
      <Mark kind={kind} />
      <span>{title}</span>
    </FutureLink>
  )
}
