import { normalizeEntityName } from '#lib/notebook/enrich/resolve.ts'

export type RelScore = {
  /** Predicted set equals the actual set (normalized comparison) */
  exact: boolean
  /** At least one predicted entry matches an actual entry */
  overlap: boolean
  /** Predicted something, none of it right — the harmful analog; rel has no partial credit */
  wrongEntity: boolean
  abstained: boolean
}

/** Spelling variance ("Jane Doe" vs "Jane-Doe") must not fail scoring — compare normalized. */
export function scoreRel(actual: string[], predicted: string[]): RelScore {
  const actualNorms = new Set(actual.map(normalizeEntityName))
  const predictedNorms = [...new Set(predicted.map(normalizeEntityName))]
  const matched = predictedNorms.filter((p) => actualNorms.has(p))
  const overlap = matched.length > 0
  const exact = overlap && predictedNorms.length === actualNorms.size && matched.length === actualNorms.size
  return {
    exact,
    overlap,
    wrongEntity: predictedNorms.length > 0 && !overlap,
    abstained: predictedNorms.length === 0,
  }
}

export type EntryTallies = {
  /** Distinct predicted entries */
  predicted: number
  /** Predicted entries present in the actual set */
  correct: number
  /** Distinct actual entries */
  actual: number
  /** Actual entries recovered by the prediction */
  recovered: number
}

/** Per-entry counts for precision/recall, normalized both sides. */
export function entryTallies(actual: string[], predicted: string[]): EntryTallies {
  const actualNorms = new Set(actual.map(normalizeEntityName))
  const predictedNorms = new Set(predicted.map(normalizeEntityName))
  let correct = 0
  for (const p of predictedNorms) if (actualNorms.has(p)) correct++
  let recovered = 0
  for (const a of actualNorms) if (predictedNorms.has(a)) recovered++
  return { predicted: predictedNorms.size, correct, actual: actualNorms.size, recovered }
}

export type RelAggregate = {
  files: number
  exact: number
  overlap: number
  wrongEntity: number
  abstained: number
}

export function aggregateRel(scores: RelScore[]): RelAggregate {
  const agg: RelAggregate = { files: scores.length, exact: 0, overlap: 0, wrongEntity: 0, abstained: 0 }
  for (const s of scores) {
    if (s.exact) agg.exact++
    if (s.overlap) agg.overlap++
    if (s.wrongEntity) agg.wrongEntity++
    if (s.abstained) agg.abstained++
  }
  return agg
}
