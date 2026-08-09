export type FileScore = {
  /** Predicted set equals the actual set */
  exact: boolean
  /** At least one predicted tag is in the actual set */
  overlap: boolean
  /** No overlap, but a predicted tag shares a two-level branch with an actual tag */
  family: boolean
  /** Predicted something, and nothing predicted shares even a top-level branch with the actual tags */
  harmful: boolean
  abstained: boolean
}

export function topLevel(tag: string): string {
  return tag.split('/')[0]
}

export function branchKey(tag: string): string {
  return tag.split('/').slice(0, 2).join('/')
}

export function scorePrediction(actual: string[], predicted: string[]): FileScore {
  const actualSet = new Set(actual)
  const overlap = predicted.some((t) => actualSet.has(t))
  const exact = overlap && predicted.length === actual.length && predicted.every((t) => actualSet.has(t))
  const actualBranches = new Set(actual.map(branchKey))
  const family = !overlap && predicted.some((t) => actualBranches.has(branchKey(t)))
  const actualTops = new Set(actual.map(topLevel))
  const harmful = predicted.length > 0 && !predicted.some((t) => actualTops.has(topLevel(t)))
  return { exact, overlap, family, harmful, abstained: predicted.length === 0 }
}

export type Aggregate = {
  files: number
  exact: number
  overlap: number
  family: number
  harmful: number
  abstained: number
}

export function aggregate(scores: FileScore[]): Aggregate {
  const agg: Aggregate = { files: scores.length, exact: 0, overlap: 0, family: 0, harmful: 0, abstained: 0 }
  for (const s of scores) {
    if (s.exact) agg.exact++
    if (s.overlap) agg.overlap++
    if (s.family) agg.family++
    if (s.harmful) agg.harmful++
    if (s.abstained) agg.abstained++
  }
  return agg
}

export function pct(n: number, d: number): string {
  return d === 0 ? '-' : `${Math.round((100 * n) / d)}%`
}
