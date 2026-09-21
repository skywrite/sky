/** Completed tasks first; to-dos keep their relative order, commitments use time within each group. */
export function comparePlanItems(
  a: { done: boolean; time: string | null },
  b: { done: boolean; time: string | null },
  timed: boolean,
): number {
  const completed = Number(b.done) - Number(a.done)
  if (completed || !timed) return completed
  const minutes = (time: string | null) => {
    const match = /^(\d{1,2}):([0-5]\d)$/.exec(time ?? '')
    return match ? Number(match[1]) * 60 + Number(match[2]) : Number.POSITIVE_INFINITY
  }
  const left = minutes(a.time)
  const right = minutes(b.time)
  return left === right ? 0 : left - right
}
