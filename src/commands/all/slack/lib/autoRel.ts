import { DIR_TIME } from '#config'
import { channelRelHistory, loadMessageCorpus } from '#lib/notebook/enrich/corpus.ts'
import { extractSubjects } from '#lib/notebook/enrich/extract.ts'
import { buildEntityIndex, normalizeEntityName, resolveSubjects } from '#lib/notebook/enrich/resolve.ts'
import { fetchEntityScores } from '#lib/notebook/enrich/scores.ts'
import { selectRel } from '#lib/notebook/enrich/select.ts'
import type { RelCandidate } from '#lib/notebook/enrich/select.ts'

// Same taxonomy floor as auto-tagging: the pre-2025 notebook is another era.
const REL_SINCE = '2025-01-01'
const MAX_PRIOR_ONLY_CANDIDATES = 4
const MAX_EXEMPLARS = 3

export type AutoRelInput = {
  channel?: string
  from?: string
  summary?: string
  body: string
}

/**
 * Propose rel entries for a new Slack capture: extract the subjects the
 * conversation is about (never its parties), resolve them against the entity
 * graph (open projects only — new conversations are about live work), then a
 * selection pass picks the 0-2 refs worth a cross-reference, guided by the
 * channel's own past choices.
 *
 * Backtested at ~60% per-entry precision / ~75% file overlap — below the
 * auto-tag bar, wired by explicit choice. Every ref is corpus-validated:
 * nothing unresolvable can be written. Never throws; undefined = abstain.
 */
export async function autoRelSlackMessage(input: AutoRelInput): Promise<string[] | undefined> {
  try {
    const [index, scores, corpus] = await Promise.all([
      buildEntityIndex(),
      fetchEntityScores(),
      loadMessageCorpus(DIR_TIME, ['slack']),
    ])
    const records = corpus.records.filter((r) => r.date >= REL_SINCE)
    const relHistory = channelRelHistory(records, input.channel)
    const exemplars = records
      .filter((r) => r.channel === input.channel && r.rel.length > 0)
      .slice(-MAX_EXEMPLARS)
      .map((r) => ({ summary: r.summary ?? '(no summary)', rel: r.rel }))

    const { subjects } = await extractSubjects(
      { body: input.body, summary: input.summary, channel: input.channel, from: input.from },
      'fast',
    )
    const resolved = resolveSubjects(subjects, index, scores, { projectStatuses: ['open'] })

    const usesOf = new Map(relHistory.map((h) => [normalizeEntityName(h.tag), h.count]))
    const candidates: RelCandidate[] = resolved.refs.map((ref) => {
      const norm = normalizeEntityName(ref)
      return {
        ref,
        inText: true,
        inPrior: usesOf.has(norm),
        uses: usesOf.get(norm) ?? 0,
        ...(scores?.has(norm) ? { score: scores.get(norm) } : {}),
      }
    })
    const inText = new Set(resolved.refs.map(normalizeEntityName))
    let added = 0
    for (const h of relHistory) {
      if (added >= MAX_PRIOR_ONLY_CANDIDATES) break
      const norm = normalizeEntityName(h.tag)
      if (inText.has(norm)) continue
      // Prior-only candidates must still resolve — history can carry renamed refs
      if (!index.canResolve(h.tag)) continue
      candidates.push({
        ref: h.tag,
        inText: false,
        inPrior: true,
        uses: h.count,
        ...(scores?.has(norm) ? { score: scores.get(norm) } : {}),
      })
      added++
    }
    if (candidates.length === 0) return undefined

    const selection = await selectRel(
      {
        body: input.body,
        summary: input.summary,
        channel: input.channel,
        from: input.from,
        candidates,
        exemplars,
      },
      'balanced',
    )
    return selection.rel.length > 0 ? selection.rel : undefined
  } catch {
    return undefined
  }
}
