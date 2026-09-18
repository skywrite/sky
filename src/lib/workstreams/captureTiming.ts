import { CAPTURE_HORIZON_CHOICES, type CaptureHorizon, type CaptureRequest } from './captureTypes.ts'

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
const uncertain = /\b(?:not sure|unsure|don['’]?t know|no idea|haven['’]?t decided)\b/i
const qualifiers =
  /\b(?:not|never|no|don['’]?t|can['’]?t|cannot|won['’]?t|isn['’]?t|wasn['’]?t|if|unless|might|maybe|perhaps|could|possibly|probably|tentative(?:ly)?|hypothetical|suggest(?:ed|ion)?|consider(?:ing)?|would|should|ideally|after|once|until|pending|depending|either|or|last|previous|ago|yesterday|was|were|had|spent|since|already|planned|expected|estimated|hoped|intended|scheduled|every|each|per|recurring|regularly|cadence)\b/i
const starting =
  /\b(?:start(?:ing|ed)?|begin(?:ning)?|began|kick[ -]?off|work(?:ing)? on|make progress|focus(?:ing)? on|prioriti[sz](?:e|ing)|spend(?:ing)?)\b/i
const completion =
  /\b(?:finish|complete|finali[sz]e|deliver|ship|launch|publish|approve|resolve|close|reach|achieve|obtain|submit|release|raise|land|secure|sign|create|build|write|prepare|produce|decide)(?:d|s|ing)?\b/i
const forward = /\b(?:in|within|over|by|before)\s+(?:(?:a|an|the|next|about|roughly|around|approximately)\s+)*$/i
const amounts: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  couple: 2,
}
const durations =
  /\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple|few|several)(?:\s+of)?[ -]+(weeks?|months?|years?)\b/gi

function quotedTimings(quote: string): { index: number; horizon: CaptureHorizon }[] {
  const result: { index: number; horizon: CaptureHorizon }[] = []
  for (const match of quote.matchAll(/\bthis week\b/gi)) result.push({ index: match.index, horizon: 'this-week' })
  for (const match of quote.matchAll(/\blong(?:er)?[ -]term\b/gi))
    result.push({ index: match.index, horizon: 'longer-term' })
  for (const match of quote.matchAll(durations)) {
    const quantity = match[1]!.toLowerCase()
    const count = amounts[quantity] ?? (/^\d+$/.test(quantity) ? Number(quantity) : undefined)
    if (count !== undefined && count < 1) continue
    const unit = match[2]!.toLowerCase()
    const horizon = unit.startsWith('year')
      ? 'longer-term'
      : unit.startsWith('month')
        ? count !== undefined && count > 6
          ? 'longer-term'
          : 'few-months'
        : count !== undefined && count > 26
          ? 'longer-term'
          : count !== undefined && count > 6
            ? 'few-months'
            : 'few-weeks'
    result.push({ index: match.index, horizon })
  }
  return result
}

function supportsHorizon(text: string, quote: string, horizon: CaptureHorizon, timingAnswer: boolean): boolean {
  if (!timingAnswer) {
    // Only a single, direct intention can supply timing without asking. In richer
    // context a dated action may be a subtask or a reported note, not the outcome.
    const intention = text
      .trim()
      .replace(/[.!]+$/, '')
      .replace(/\bwould like\b/gi, 'want')
    const action = intention.replace(/^(?:I|we)\s+(?:want|need|plan|hope|aim|intend)\s+to\s+/i, '')
    if (
      /[.!?;\n"“”():]/.test(intention) ||
      /\b(?:and|but|then|while|also)\b/i.test(intention) ||
      action.search(completion) !== 0 ||
      [...action.matchAll(new RegExp(completion.source, 'gi'))].length !== 1
    )
      return false
  }
  const timings = quotedTimings(quote)
  if (!timings.length || timings.some((timing) => timing.horizon !== horizon)) return false
  // A quote cannot remove qualifiers such as "not", "last", or "kick off" from the owner's sentence.
  for (const raw of text.split(/[.!?;\n]/)) {
    const clause = normalize(raw)
    if (qualifiers.test(clause.replace(/\bwould like\b/gi, 'want')) || starting.test(clause)) continue
    for (let offset = clause.indexOf(quote); offset !== -1; offset = clause.indexOf(quote, offset + 1)) {
      if (
        timings.every((timing) => {
          const prefix = clause.slice(0, offset + timing.index)
          const action = prefix.split(/\b(?:and|but|then)\b/i).at(-1) ?? prefix
          return (
            timingAnswer ||
            (completion.test(action) &&
              (forward.test(prefix) ||
                horizon === 'this-week' ||
                (horizon === 'longer-term' && /\blong(?:er)?[ -]term\b/i.test(quote))))
          )
        })
      )
        return true
    }
  }
  return false
}

/** Conservative extraction of the owner's stated timing; notebook evidence has no authority here. */
export function resolveCaptureHorizon(
  request: CaptureRequest,
  modelHorizon: CaptureHorizon | null,
  horizonEvidence: string | null | undefined,
): CaptureHorizon | null {
  if (request.horizon) return request.horizon
  const timingAnswer = request.answers.findLast((answer) => answer.field === 'timing')
  if (timingAnswer) {
    if (uncertain.test(timingAnswer.answer)) return 'unsure'
    const value = normalize(timingAnswer.answer)
      .replace(/[.!]+$/, '')
      .toLowerCase()
    const choice = CAPTURE_HORIZON_CHOICES.find((entry) => entry.value === value || entry.label.toLowerCase() === value)
    if (choice) return choice.value
  }
  const unknown = timingAnswer ? 'unsure' : null
  const quote = normalize(horizonEvidence ?? '').replace(/[.!]+$/, '')
  if (!modelHorizon || !quote) return unknown
  // A later freeform timing answer replaces earlier timing, even when it cannot be mapped to a bucket.
  const statements = timingAnswer ? [timingAnswer.answer] : [request.intent]
  return statements.some((statement) => supportsHorizon(statement, quote, modelHorizon, Boolean(timingAnswer)))
    ? modelHorizon
    : unknown
}
