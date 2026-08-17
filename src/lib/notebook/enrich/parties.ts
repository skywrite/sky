import type { EntityIndex } from './resolve.ts'
import { normalizeEntityName, resolveMention } from './resolve.ts'

/**
 * A document's parties as its `who:`/`from:`/`to:` frontmatter spells them —
 * comma-joined lists split into individual names, channels (`#eng`) skipped.
 */
export function partyNames(values: Array<string | null | undefined>): string[] {
  return values
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '' && !v.trim().startsWith('#'))
    .flatMap((v) => v.split(',').map((n) => n.trim()))
    .filter(Boolean)
}

/**
 * Normalized forms under which a document's parties could appear in `rel:`.
 *
 * A party is never a rel entry — who/from/to already record the people a
 * document is with, and rel repeating them is noise. Each name is excluded as
 * written; given an entity index, also under its canonical person resolution
 * ("Jane" excludes "Jane Doe"), and under a first-name person file the
 * party's own tokens can spell ("Jane Doe" excludes a lone "Jane" file). The
 * token check keeps that last step honest: a party "Jane Grant" never
 * excludes an unrelated "Jane Doe".
 */
export function partyExclusionSet(
  values: Array<string | null | undefined>,
  opts: { index?: EntityIndex; scores?: Map<string, number> } = {},
): Set<string> {
  const out = new Set<string>()
  for (const name of partyNames(values)) {
    const norm = normalizeEntityName(name)
    if (!norm) continue
    out.add(norm)
    if (!opts.index) continue
    const base = { index: opts.index, scores: opts.scores }
    const resolved = resolveMention(name, 'person', base)
    if (resolved) out.add(normalizeEntityName(resolved))
    const tokens = norm.split(' ')
    if (tokens.length > 1) {
      const byFirst = resolveMention(tokens[0], 'person', base)
      if (
        byFirst &&
        normalizeEntityName(byFirst)
          .split(' ')
          .every((t) => tokens.includes(t))
      ) {
        out.add(normalizeEntityName(byFirst))
      }
    }
  }
  return out
}

/** Drop refs that name a party; everything else stays verbatim and in order. */
export function excludeParties(refs: string[], parties: Set<string>): string[] {
  if (parties.size === 0) return refs
  return refs.filter((ref) => !parties.has(normalizeEntityName(ref)))
}
