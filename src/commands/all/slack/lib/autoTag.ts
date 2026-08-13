import { DIR_TIME } from '#config'
import { chooseTags } from '#lib/notebook/enrich/classify.ts'
import { buildTagMenu, channelHistory, loadMessageCorpus } from '#lib/notebook/enrich/corpus.ts'

// Taxonomy floor: pre-2025 tags are the abandoned old style and never enter the
// menus. Backtested via slack:tags:eval — the floor lifted any-overlap 47%→59%
// and halved foreign-branch errors to 5% (1% on 2026-era threads).
const TAXONOMY_SINCE = '2025-01-01'

export type AutoTagInput = {
  channel?: string
  from?: string
  summary?: string
  body: string
}

/**
 * Pick tags for a new Slack capture from the corpus of already-archived
 * threads. The corpus is derived fresh from the files on every call — landing
 * in a file IS joining the corpus, so hand-added tags are offerable on the
 * next capture with no separate state to maintain.
 *
 * Closed-menu by construction: the classifier can only return tags that
 * already exist on archived threads (verbatim-validated). Never throws;
 * undefined means abstain and the capture is written untagged.
 */
export async function autoTagSlackMessage(input: AutoTagInput): Promise<string | undefined> {
  try {
    const corpus = await loadMessageCorpus(DIR_TIME, ['slack'])
    const records = corpus.records.filter((r) => r.date >= TAXONOMY_SINCE)
    const menu = buildTagMenu(records)
    if (menu.length === 0) return undefined

    const outcome = await chooseTags(
      {
        body: input.body,
        channel: input.channel,
        from: input.from,
        summary: input.summary,
        channelHistory: channelHistory(records, input.channel),
        menu,
      },
      'fast',
    )
    return outcome.tags.length > 0 ? outcome.tags.join('; ') : undefined
  } catch {
    return undefined
  }
}
