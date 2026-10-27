import { LABEL_WIDTH, WEEK_WIDTH } from './TimelineGrid.tsx'

export function LaneInsertion({ laneLeft, top }: { laneLeft: number; top: number }) {
  return (
    <div
      className="sky-workstreams-lane-insertion"
      style={{ left: laneLeft, top, width: LABEL_WIDTH + WEEK_WIDTH * 4 - laneLeft }}
    />
  )
}
