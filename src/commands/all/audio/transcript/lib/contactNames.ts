/**
 * Which corrections the glossary may learn without a person ruling on them.
 *
 * High-confidence fixes are applied without review, and until now they left
 * no trace: a mishearing of a contact's name fixed on one recording had to
 * be found again on the next, and one day it was not. A high-confidence
 * name fix whose target is a contact — a full name from the contacts list,
 * or one token of one — is the model landing on a profile the notebook
 * already knows, the safest ruling the glossary can hold. Those enter it as
 * confirmed corrections, so they replay at high confidence and reach the
 * transcriber's vocabulary. Every other auto-fix stays as it was, applied
 * once and forgotten: a wrong fix cemented is a wrong fix forever.
 *
 * The contacts arrive as the lines rendered into the analysis prompt —
 * "Jane Doe (42)", "Sam Rivera (new)". A handle (`org/handle`) carries no
 * token a spelling could land on and is left out.
 */

import { normalizeTerm } from './dedupeIssues.ts'

/** Below this many characters a name token is prose, not a name ("de", "Al"). */
const MIN_TOKEN_CHARS = 3

/** Every contact name and name token a fix could land on, normalized. */
export function contactNameSet(knownPeople: string): Set<string> {
  const names = new Set<string>()
  for (const line of knownPeople.split('\n')) {
    const name = line.replace(/\s*\([^)]*\)\s*$/, '').trim()
    if (!name || name.includes('/')) continue
    names.add(normalizeTerm(name))
    for (const token of name.split(/\s+/)) {
      if (token.length >= MIN_TOKEN_CHARS) names.add(normalizeTerm(token))
    }
  }
  return names
}

/** A fix lands on a contact when its target is a contact's name or one token of it. */
export function landsOnContact(fix: string | null | undefined, contacts: Set<string>): boolean {
  if (!fix) return false
  return contacts.has(normalizeTerm(fix))
}
