import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

export const WEEK_WIDTH = 252
export const LABEL_WIDTH = 300

export function TimelineGrid({
  weeks,
  monday,
  todayLeft,
  laneLeft,
  height,
}: {
  weeks: number[]
  monday: PlainDate
  todayLeft: number
  laneLeft: number
  height: number
}) {
  return (
    <>
      {weeks.map((index) => {
        const week = monday.addDays(index * 7)
        return (
          <div
            key={index}
            className="sky-workstreams-week"
            style={{ left: LABEL_WIDTH + index * WEEK_WIDTH, width: WEEK_WIDTH, height }}
          >
            <strong>W{week.weekOfYear}</strong>
            <span>
              {week.ymd} — {week.addDays(6).ymd}
            </span>
          </div>
        )
      })}
      <div className="sky-workstreams-today-line" style={{ left: todayLeft, height }}>
        <span>Today</span>
      </div>
      <div className="sky-workstreams-label-column" style={{ left: laneLeft, height }}>
        <span>Workstreams</span>
      </div>
    </>
  )
}
