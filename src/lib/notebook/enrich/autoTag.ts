import { chooseTags } from './classify.ts'
import { buildTagMenu, loadMessageCorpus, tagHistoryFor } from './corpus.ts'

// Taxonomy floor: pre-2025 tags are the abandoned old style and never enter the
// menus. Backtested via slack:tags:eval — the floor lifted any-overlap 47%→59%
// and halved foreign-branch errors to 5% (1% on 2026-era threads).
const TAXONOMY_SINCE = '2025-01-01'

export type AutoTagInput = {
  /**
   * Who or where the conversation is with, as the document's `to:` frontmatter
   * spells it — Slack channel or DM partner, email counterparty, meeting
   * attendees. Keys the history prior. Omit for media with no conversation
   * identity (journals).
   */
  to?: string
  from?: string
  summary?: string
  body: string
}

/**
 * Pick tags for a new capture from the corpus of already-archived messages of
 * the given mediums. The corpus is queried fresh from the service on every
 * call and the store follows the notebook files — landing in a file IS
 * joining the corpus, so hand-added tags are offerable on the next capture
 * with no separate state to maintain.
 *
 * Closed-menu by construction: the classifier can only return tags that
 * already exist on archived messages (verbatim-validated). Never throws;
 * undefined means abstain and the capture is written untagged.
 */
export async function autoTagMessage(
  input: AutoTagInput,
  opts: { mediums: string[]; kind?: string; maxTags?: number },
): Promise<string | undefined> {
  try {
    const corpus = await loadMessageCorpus(opts.mediums)
    const records = corpus.records.filter((r) => r.date >= TAXONOMY_SINCE)
    // projects/* is rel vocabulary, never tag vocabulary (standing rule): project
    // membership is a reference, not a topic. Historical captures carry it as
    // tags, so it must leave the menu here or the classifier re-learns it.
    const menu = buildTagMenu(records).filter((t) => !t.tag.startsWith('projects/'))
    if (menu.length === 0) return undefined

    const outcome = await chooseTags(
      {
        body: input.body,
        kind: opts.kind,
        maxTags: opts.maxTags,
        to: input.to,
        from: input.from,
        summary: input.summary,
        tagHistory: tagHistoryFor(records, input.to),
        menu,
      },
      'fast',
    )
    return outcome.tags.length > 0 ? outcome.tags.join('; ') : undefined
  } catch {
    return undefined
  }
}
