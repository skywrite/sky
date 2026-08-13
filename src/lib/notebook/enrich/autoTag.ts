import { DIR_TIME } from '#config'
import { chooseTags } from './classify.ts'
import { buildTagMenu, channelHistory, loadMessageCorpus } from './corpus.ts'

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
 * the given mediums. The corpus is derived fresh from the files on every call —
 * landing in a file IS joining the corpus, so hand-added tags are offerable on
 * the next capture with no separate state to maintain.
 *
 * Closed-menu by construction: the classifier can only return tags that
 * already exist on archived messages (verbatim-validated). Never throws;
 * undefined means abstain and the capture is written untagged.
 */
export async function autoTagMessage(input: AutoTagInput, opts: { mediums: string[] }): Promise<string | undefined> {
  try {
    const corpus = await loadMessageCorpus(DIR_TIME, opts.mediums)
    const records = corpus.records.filter((r) => r.date >= TAXONOMY_SINCE)
    const menu = buildTagMenu(records)
    if (menu.length === 0) return undefined

    const outcome = await chooseTags(
      {
        body: input.body,
        channel: input.to,
        from: input.from,
        summary: input.summary,
        channelHistory: channelHistory(records, input.to),
        menu,
      },
      'fast',
    )
    return outcome.tags.length > 0 ? outcome.tags.join('; ') : undefined
  } catch {
    return undefined
  }
}
