import type { MacSenderLookup } from '#lib/macMessages/lookup.ts'
import { normalizeName } from '#shared/models/Store/normalize.ts'
import type PeopleStore from '#shared/models/Store/PeopleStore/mod.ts'

export interface SenderLookup {
  people?: Pick<PeopleStore, 'find' | 'findByHandle'> | null
  scoreLookup?: (name: string) => number
  /** Optional read-only lookup over macOS Contacts for elevating known contacts. */
  macContacts?: Pick<MacSenderLookup, 'resolve' | 'hasContactName'> | null
}

export interface ResolvedSender {
  displayName: string
  personScore: number
  /** True when the sender matches a profile in `people/`, Mac Contacts, or carries a positive interaction score. */
  registered: boolean
  /** True when the sender matched a card in Mac Contacts (earns bonus elevation points). */
  inMacContacts: boolean
}

const AUTOMATED_LOCAL_PARTS =
  /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer[-_.]?daemon|postmaster|notifications?|alerts?|updates?|newsletter|digest|billing|receipts?|support[-_.]?bot|automated|auto[-_.]?confirm|calendar[-_.]?notification|bounce[s]?|daemon)$/i

const AUTOMATED_DOMAINS =
  /(?:^|\.)(?:noreply|notifications?|mailer|sendgrid\.net|amazonses\.com|mailchimp\.com|substack\.com|beehiiv\.com|calendly\.com|docusign\.net)$/i

const AUTOMATED_NAMES =
  /^(?:slackbot|google calendar|calendar notification|github|linear|jira|notion|stripe|zoom|loom|figma|vercel|netlify)$/i

/** Detect obvious bulk/automated email addresses or bot names before spending model calls. */
export function isAutomatedSender(input: { name?: string; email?: string; labels?: readonly string[] }): boolean {
  const labels = input.labels ?? []
  if (
    labels.includes('CATEGORY_PROMOTIONS') ||
    labels.includes('CATEGORY_SOCIAL') ||
    labels.includes('CATEGORY_FORUMS') ||
    labels.includes('SPAM') ||
    labels.includes('TRASH')
  ) {
    return true
  }

  const email = input.email?.trim().toLowerCase()
  if (email && email.includes('@')) {
    const [local, domain] = email.split('@')
    if (local && AUTOMATED_LOCAL_PARTS.test(local)) return true
    if (local && (local.includes('noreply') || local.includes('no-reply') || local.includes('donotreply'))) return true
    if (domain && AUTOMATED_DOMAINS.test(domain)) return true
  }

  const name = input.name?.trim()
  if (name && AUTOMATED_NAMES.test(name)) return true

  return false
}

/** Check whether an author string (display name, email, or "Name <email>") belongs to the notebook owner. */
export function isOwnerAuthor(
  author: string | undefined,
  ownerNames: readonly string[],
  ownerAddresses: readonly string[] = [],
): boolean {
  const raw = author?.trim()
  if (!raw) return false

  const emailMatch = raw.match(/<([^<>@]+@[^<>]+)>/)
  const extractedEmail = (emailMatch?.[1] ?? (raw.includes('@') ? raw : '')).trim().toLowerCase()
  if (extractedEmail) {
    const normalizedAddresses = new Set(ownerAddresses.map((addr) => addr.trim().toLowerCase()).filter(Boolean))
    if (normalizedAddresses.has(extractedEmail)) return true
  }

  const strippedName = raw
    .replace(/<[^>]*>/g, '')
    .replace(/^"|"$/g, '')
    .trim()
  const normalizedAuthor = normalizeName(strippedName)
  if (!normalizedAuthor) return false

  for (const name of ownerNames) {
    const normalizedOwner = normalizeName(name)
    if (normalizedOwner && normalizedOwner === normalizedAuthor) return true
  }
  return false
}

/**
 * Resolve a sender against `people/` (email/phone handle first, then name), Mac Contacts, and `ScoringStore`.
 *
 * A sender is considered "registered" when they match a profile in `people/`, appear in
 * Mac Contacts, or carry a positive interaction score in `ScoringStore`.
 */
export function resolveSender(
  input: { name?: string; email?: string; phone?: string },
  lookup: SenderLookup,
): ResolvedSender {
  const people = lookup.people ?? null
  const scoreOf = lookup.scoreLookup ?? (() => 0)
  const macContacts = lookup.macContacts ?? null

  const cleanedName = (input.name ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/^"|"$/g, '')
    .trim()
  const email = input.email?.trim()
  const phone = input.phone?.trim()

  const macHandleMatch =
    (email ? macContacts?.resolve(email) : null) ??
    (phone ? macContacts?.resolve(phone) : null) ??
    (cleanedName && (cleanedName.includes('@') || /\d{7,}/.test(cleanedName.replace(/\D/g, '')))
      ? macContacts?.resolve(cleanedName)
      : null)
  const macNamedByHandle = Boolean(macHandleMatch?.name)

  let matched =
    (email ? people?.findByHandle(email) : undefined) ??
    (phone ? people?.findByHandle(phone) : undefined) ??
    (cleanedName ? people?.findByHandle(cleanedName) : undefined) ??
    (cleanedName ? people?.find(cleanedName) : undefined)

  // Cross-link via Mac Contacts: a phone number or secondary email may map to a notebook profile.
  if (!matched && macHandleMatch) {
    for (const handle of macHandleMatch.handles) {
      matched = people?.findByHandle(handle)
      if (matched) break
    }
    if (!matched && macHandleMatch.name) {
      matched = people?.find(macHandleMatch.name)
    }
  }

  if (matched) {
    const person = matched.value
    const candidateNames = [
      ...person.names,
      ...(person.alt ? [person.alt] : []),
      ...(macHandleMatch?.name ? [macHandleMatch.name] : []),
      cleanedName,
    ].filter(Boolean)
    let bestScore = 0
    for (const candidate of candidateNames) {
      const score = scoreOf(candidate)
      if (score > bestScore) bestScore = score
    }
    const contactHandles = [
      ...(person.email ? [person.email].flat() : []),
      ...(person.phone ? [person.phone].flat() : []),
    ]
    const inMacContacts =
      macNamedByHandle ||
      candidateNames.some((candidate) => Boolean(macContacts?.hasContactName?.(candidate))) ||
      contactHandles.some((entry) =>
        typeof entry === 'string'
          ? Boolean(macContacts?.resolve(entry)?.name)
          : entry && typeof entry === 'object'
            ? Object.values(entry).some((v) => typeof v === 'string' && Boolean(macContacts?.resolve(v)?.name))
            : false,
      )
    return {
      displayName: person.names[0] ?? macHandleMatch?.name ?? cleanedName ?? email ?? phone ?? 'Unknown',
      personScore: bestScore,
      registered: true,
      inMacContacts,
    }
  }

  const macName = macHandleMatch?.name ?? ''
  const inMacContacts =
    macNamedByHandle || (Boolean(cleanedName) && Boolean(macContacts?.hasContactName?.(cleanedName)))
  const bestName = macName || cleanedName
  const directScore = Math.max(cleanedName ? scoreOf(cleanedName) : 0, macName ? scoreOf(macName) : 0)
  return {
    displayName: bestName || email || phone || 'Unknown',
    personScore: directScore,
    registered: directScore > 0 || inMacContacts,
    inMacContacts,
  }
}

/**
 * Unknown senders (unrecognized phone number / email with no profile, no Mac Contacts card,
 * and zero score) stay out unless the owner already replied earlier in the thread, the capture
 * links to prior conversation history, or Beeper already resolved a human contact name.
 */
export function isSenderEligible(input: {
  registered: boolean
  ownerParticipated: boolean
  hasPriorHistory?: boolean
  resolvedBeeperName?: boolean
}): boolean {
  return Boolean(input.registered || input.ownerParticipated || input.hasPriorHistory || input.resolvedBeeperName)
}
