import { autoRelMessage, mergeRel } from '#lib/notebook/enrich/autoRel.ts'
import { autoTagMessage } from '#lib/notebook/enrich/autoTag.ts'
import TagSet from '#shared/models/TagSet/mod.ts'

/**
 * Tags and rel for a decision, from the same enrichment every other capture
 * gets. A decision is self-authored with no counterparty, like a journal entry,
 * so the journal archive carries the tag vocabulary.
 */
const DECISION_TAGS: { mediums: string[]; kind: string; maxTags: number } = {
  mediums: ['journal'],
  kind: 'decision',
  maxTags: 5,
}
/**
 * A decision's record names the people and organizations it turns on, so every
 * substantive tie is kept, not the one or two a message gets.
 */
const DECISION_REL: { mediums: string[]; kind: string; comprehensive: boolean } = {
  mediums: ['journal'],
  kind: 'decision',
  comprehensive: true,
}
/**
 * A decision worked out with Sky quotes Sky ("Sky's odds", "Sky would have
 * chosen"). Sky is the other party to the record, never what it is about, and
 * naming it as a party keeps a contact who shares the name out of rel.
 */
const OTHER_PARTY = 'Sky'

export interface DecisionEnrichInput {
  title: string
  context: string
  desiredOutcomes: string
  record?: string
  decision?: string
  /** References already chosen for it; they stay, first and in order */
  rel: string[]
  /** Tags already chosen for it; when there are any, none are added */
  tags?: TagSet
}

export interface DecisionEnrichServices {
  tags: typeof autoTagMessage
  rel: typeof autoRelMessage
}

/**
 * The decision's tags and rel after enrichment. Both lookups abstain rather
 * than fail, so a decision is always saved, enriched or not.
 */
export async function enrichDecision(
  input: DecisionEnrichInput,
  { autoTag = true, autoRel = true }: { autoTag?: boolean; autoRel?: boolean } = {},
  services: DecisionEnrichServices = { tags: autoTagMessage, rel: autoRelMessage },
): Promise<{ tags: TagSet | undefined; rel: string[] }> {
  const body = [input.context, input.desiredOutcomes, input.record, input.decision]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join('\n\n')
  const tagged = Boolean(input.tags?.size)
  const [tags, rel] = await Promise.all([
    autoTag && !tagged ? services.tags({ summary: input.title, body }, DECISION_TAGS) : undefined,
    autoRel
      ? services.rel({ summary: input.title, body, existingRel: input.rel, from: OTHER_PARTY }, DECISION_REL)
      : undefined,
  ])
  return {
    tags: tags ? TagSet.fromString(tags) : input.tags,
    rel: mergeRel(input.rel, rel) ?? [],
  }
}
