import { Fragment, useEffect, useId, useState } from 'react'

export interface TurnQueries {
  turn: number
  queries: string[]
}

/** Raw query text stays selectable and copies verbatim, including whitespace. */
function Query({ query, index }: { query: string; index: number }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (copy === 'idle') return
    const timer = setTimeout(() => setCopy('idle'), 2500)
    return () => clearTimeout(timer)
  }, [copy])
  return (
    <div className="sky-query">
      <div className="sky-query-head">
        <span>Query {index + 1}</span>
        <button
          type="button"
          className="sky-query-copy"
          onClick={() => {
            if (!navigator.clipboard) {
              setCopy('failed')
              return
            }
            void navigator.clipboard.writeText(query).then(
              () => setCopy('copied'),
              () => setCopy('failed'),
            )
          }}
        >
          {copy === 'copied' ? 'Copied' : 'Copy query'}
        </button>
      </div>
      {copy === 'failed' && <div role="status">Couldn’t copy. Select the query below to copy it.</div>}
      <pre tabIndex={0} aria-label={`GraphQL query ${index + 1}`}>
        <code>{query}</code>
      </pre>
    </div>
  )
}

export function GraphQLQueries({ queries }: { queries: string[] }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  if (queries.length === 0) return null
  return (
    <div className="sky-queries">
      <button
        type="button"
        className="sky-queries-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" data-open={open}>
          <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        GraphQL queries
      </button>
      <div id={id} hidden={!open} className="sky-queries-body">
        <p>Queries behind this turn’s notebook context. Earlier queries may carry forward between messages.</p>
        {queries.map((query, index) => (
          <Fragment key={`${index}-${query}`}>
            <Query query={query} index={index} />
          </Fragment>
        ))}
      </div>
    </div>
  )
}

const THINKING = ['Thinking it through', 'Working through your question', 'Putting the reply together']
const READING = ['Finding relevant context', 'Looking through your notebook', 'Gathering what matters']

function activityLabel(text: string, seconds: number): string {
  const step = Math.floor(seconds / 8)
  if (text === 'thinking' || text === 'still working') return THINKING[step % THINKING.length]!
  if (text === 'finding what matters for this') return READING[step % READING.length]!
  if (text === 'not reading your notebook') return 'Preparing a reply · notebook closed'
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Lives with the user message, so opening a query survives the first token and the end of the reply. */
export function ChatActivity({
  active,
  text,
  queries = [],
}: {
  active: boolean
  text: string | null
  queries?: string[]
}) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) return
    const start = performance.now()
    setSeconds(0)
    const timer = setInterval(() => setSeconds(Math.floor((performance.now() - start) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [active])
  if ((!active || !text) && queries.length === 0) return null
  return (
    <div className="sky-chat-activity" data-active={active || undefined}>
      {active && text && (
        <div className="sky-chat-progress">
          <span className="sky-chat-pulse" aria-hidden="true" />
          <span role="status">{activityLabel(text, seconds)}</span>
          {seconds >= 3 && (
            <span className="sky-chat-elapsed">
              {seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}
            </span>
          )}
        </div>
      )}
      <GraphQLQueries queries={queries} />
    </div>
  )
}
