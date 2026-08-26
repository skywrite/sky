import { type ExtractedMessage, renameSenders } from './extractFromImage.ts'
import type { ParsedCorrections } from './parseCorrections.ts'

/** `from:`/`to:` values the user typed literally in a freeform correction. */
export interface TypedParticipants {
  from?: string
  to?: string
}

/**
 * Lift explicitly labelled `from:` / `to:` values out of a freeform correction
 * string. Corrections are prompted as `from: Alice, to: Bob`, and an explicit
 * participant needs a regex, not a language model — read here, the value lands
 * in the field verbatim and cannot be reinterpreted as a sender rename or
 * overwritten by one (correcting a reversed direction was once parsed as
 * "rename each person", relabelling every message in the dialogue).
 *
 * Only the labelled form is matched. Freeform phrasing ("this was actually
 * from Alice") falls through to the AI parse, and a `from`/`to` inside another
 * segment ("summary: figures from: the audit") is left alone.
 */
export function extractTypedParticipants(correction: string): TypedParticipants {
  const result: TypedParticipants = {}
  const from = correction.match(/(?:^|[,;\n])\s*from\s*:\s*([^,;\n]+)/i)?.[1].trim()
  const to = correction.match(/(?:^|[,;\n])\s*to\s*:\s*([^,;\n]+)/i)?.[1].trim()
  if (from) result.from = from
  if (to) result.to = to
  return result
}

export interface ParticipantState {
  from?: string
  to?: string
  messages: ExtractedMessage[]
}

/**
 * Apply parsed corrections to the from/to fields and the dialogue senders.
 *
 * Precedence, most binding first: typed `from:`/`to:` values, then the model's
 * field corrections, then rename side effects. A rename asserts "same person,
 * new name", so it relabels dialogue senders and follows through into a
 * from/to field — but only one that was not explicitly corrected. An explicit
 * correction may reassign the field to a different person entirely (fixing a
 * reversed direction), and a rename must never overwrite that.
 */
export function applyParticipantCorrections(
  current: ParticipantState,
  typed: TypedParticipants,
  parsed: ParsedCorrections,
): ParticipantState {
  let { from, to } = current
  if (parsed.from !== undefined) from = parsed.from ?? undefined
  if (parsed.to !== undefined) to = parsed.to ?? undefined
  if (typed.from !== undefined) from = typed.from
  if (typed.to !== undefined) to = typed.to

  let messages = current.messages
  const renames = parsed.senderRenames ?? []
  if (renames.length > 0) {
    messages = renameSenders(messages, renames)
    const fromExplicit = typed.from !== undefined || parsed.from !== undefined
    const toExplicit = typed.to !== undefined || parsed.to !== undefined
    for (const r of renames) {
      if (!fromExplicit && from === r.from) from = r.to
      if (!toExplicit && to === r.from) to = r.to
    }
  }

  return { from, to, messages }
}
