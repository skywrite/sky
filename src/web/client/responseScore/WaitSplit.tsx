import { useRef } from 'react'
import { RESPONSE_POINTS } from '#lib/needsResponse/marks.ts'
import { WAIT_GROUPS } from './markNames.ts'
import { useElementWidth } from './useElementWidth.ts'
import './WaitSplit.css'

const GAP = 2
/** The narrowest block that still fits its number. */
const ROOM_FOR_NUMBER = 28

/** How long people waited over the last 7 days: one block per group, as wide as its share. */
export function WaitSplit({ waits }: { waits: readonly number[] }) {
  const bar = useRef<HTMLDivElement>(null)
  const width = useElementWidth(bar)
  const total = waits.reduce((sum, count) => sum + count, 0)
  const shown = waits.map((count, group) => ({ count, group })).filter((part) => part.count > 0)
  const room = width - GAP * Math.max(0, shown.length - 1)
  // A block too narrow for its number hands it to the legend.
  const fits = (count: number) => width === 0 || (count / total) * room >= ROOM_FOR_NUMBER

  return (
    <div className="sky-rs-split">
      <div className="sky-rs-split-bar" ref={bar} role="list" aria-label="Messages by how long they waited">
        {shown.map(({ count, group }) => {
          const share = Math.round((100 * count) / total)
          const what = `${WAIT_GROUPS[group]}: ${count} ${count === 1 ? 'message' : 'messages'}, ${share}%. ${RESPONSE_POINTS[group]} points each.`
          return (
            <div
              key={group}
              className="sky-rs-split-part"
              role="listitem"
              tabIndex={0}
              data-level={5 - group}
              style={{ flex: `${count} 0 0` }}
              title={what}
              aria-label={what}
            >
              {fits(count) ? count : null}
            </div>
          )
        })}
      </div>
      <ul className="sky-rs-legend">
        {WAIT_GROUPS.map((name, group) => (
          <li key={name}>
            <i data-level={5 - group} />
            {name}
            {waits[group] > 0 && !fits(waits[group]) && <b>{waits[group]}</b>}
          </li>
        ))}
      </ul>
    </div>
  )
}
