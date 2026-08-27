import { unlink } from 'node:fs/promises'
import * as path from 'node:path'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { DIR_BASE } from '#config'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import type Follow from '#shared/models/Follow/mod.ts'
import type { FollowMessage } from '#shared/models/Follow/mod.ts'
import MessageDocument from '#shared/models/Message/mod.ts'
import { resolveTimeRef, toTimeRef } from '#shared/nbfs/mod.ts'

const HEADER_RX = /^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2})[^*\n]*\*\*(.*?)\*\*/m

type Block = { ts: string; author: string; text: string }
type ParsedDoc = { rel: string; abs: string; doc: MessageDocument; blocks: Block[]; preamble: string }

/**
 * Make a fused follow's docs read as ONE conversation. Docs sharing a day are
 * physically combined — message blocks interleaved chronologically into the
 * earliest doc, the other files deleted and their day.md lines removed. Every
 * surviving doc gets the fused summary (frontmatter, H1, day.md link text)
 * and follow slug. Docs never move across days — the day stays the partition.
 */
export async function consolidateFusedDocs(
  follow: Follow,
  slug: string,
  deps: { output: OutputHandler; baseDir?: string },
): Promise<Follow> {
  const { output } = deps
  const base = deps.baseDir ?? DIR_BASE

  const parseDoc = async (ref: string): Promise<ParsedDoc | undefined> => {
    const rel = resolveTimeRef(ref)
    const abs = path.join(base, rel)
    if (!(await exists(abs))) return undefined
    const doc = MessageDocument.fromMarkdown(await readTextFile(abs))
    const blocks: Block[] = []
    let preamble = ''
    const parts = doc.markdown.split(/^(?=## )/m)
    for (const part of parts) {
      const m = part.match(HEADER_RX)
      if (m) {
        blocks.push({ ts: m[1], author: m[2], text: part.replace(/\n+$/, '') })
      } else if (!part.startsWith('## ')) {
        // Anything before the first message except the title line — hand
        // notes live here and must survive the rebuild
        preamble = part.replace(/^# .*\n?/, '').trim()
      }
    }
    return { rel, abs, doc, blocks, preamble }
  }

  // Group the record's docs by date, oldest first within a date
  const byDate = new Map<string, FollowMessage[]>()
  for (const msg of follow.messages) {
    if (!byDate.has(msg.date)) byDate.set(msg.date, [])
    byDate.get(msg.date)!.push(msg)
  }

  const summary = follow.summary
  const survivors: FollowMessage[] = []
  const absorbedBasenames = new Map<string, string>() // absorbed basename -> surviving basename

  for (const [date, entries] of [...byDate.entries()].sort()) {
    const parsed = (await Promise.all(entries.map((e) => parseDoc(e.path)))).filter(
      (p): p is ParsedDoc => p !== undefined,
    )
    if (parsed.length === 0) {
      // Nothing on disk (stale refs) — keep the ledger entries as they are
      survivors.push(...entries)
      continue
    }

    // Earliest doc on the day (by its first message) is the survivor
    parsed.sort((a, b) => ((a.blocks[0]?.ts ?? '') < (b.blocks[0]?.ts ?? '') ? -1 : 1))
    const [target, ...absorbed] = parsed

    // Interleave every block chronologically, deduped by (ts, author)
    const seen = new Set<string>()
    const blocks: Block[] = []
    for (const p of parsed) {
      for (const b of p.blocks) {
        const key = `${b.ts}|${b.author}`
        if (!seen.has(key)) {
          seen.add(key)
          blocks.push(b)
        }
      }
    }
    blocks.sort((a, b) => (a.ts < b.ts ? -1 : 1))

    // Union the enrichment the fragments carried
    const tags = uniq(
      parsed.flatMap((p) =>
        String(p.doc.yaml['tags'] ?? '')
          .split(';')
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    )
    const rel = uniq(parsed.flatMap((p) => relList(p.doc.yaml['rel'])))
    const attachments = uniq(parsed.flatMap((p) => p.doc.attachments))

    const preambles = uniq(parsed.map((p) => p.preamble).filter(Boolean))
    const body = [
      `# ${summary}`,
      '',
      ...preambles.flatMap((p) => [p, '']),
      ...blocks.flatMap((b) => [b.text, '']),
    ].join('\n')
    const updated = new MessageDocument(
      {
        ...target.doc.yaml,
        summary,
        follow: slug,
        ...(tags.length > 0 ? { tags: tags.join('; ') } : {}),
        ...(rel.length > 0 ? { rel } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
      },
      body,
    )
    await writeTextFile(target.abs, updated.toMarkdown())

    // Absorbed fragments: day.md line out, file gone
    for (const p of absorbed) {
      await removeDayMdLine(p.abs, output)
      await unlink(p.abs)
      absorbedBasenames.set(path.basename(p.rel), path.basename(target.rel))
      output.log(`  ${date}: absorbed ${path.basename(p.rel)} into ${path.basename(target.rel)}`)
    }
    await retitleDayMdLine(target.abs, summary)

    survivors.push({ date, path: toTimeRef(target.rel) })
  }

  // Chains that ran through an absorbed doc re-point to its survivor
  if (absorbedBasenames.size > 0) {
    for (const msg of survivors) {
      const p = await parseDoc(msg.path)
      if (!p) continue
      const previous = p.doc.yaml['previous']
      if (typeof previous !== 'string') continue
      const hit = [...absorbedBasenames.keys()].find((b) => previous.endsWith(stripExt(b)) || previous.endsWith(b))
      if (!hit) continue
      const repointed = previous.replace(stripExt(hit), stripExt(absorbedBasenames.get(hit)!))
      await writeTextFile(
        p.abs,
        new MessageDocument({ ...p.doc.yaml, previous: repointed }, p.doc.markdown).toMarkdown(),
      )
    }
  }

  return follow.withMessages(survivors)
}

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function relList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function stripExt(name: string): string {
  return name.replace(/\.md$/, '')
}

function dayMdPathFor(docAbs: string): string {
  return path.join(path.dirname(path.dirname(path.dirname(docAbs))), 'day.md')
}

/** Remove the single day.md line naming this doc; leave the file alone if the match isn't exact. */
async function removeDayMdLine(docAbs: string, output: OutputHandler): Promise<void> {
  const dayMd = dayMdPathFor(docAbs)
  if (!(await exists(dayMd))) return
  const base = path.basename(docAbs)
  const lines = (await readTextFile(dayMd)).split('\n')
  const hits = lines.reduce<number[]>((acc, l, i) => (l.includes(base) ? [...acc, i] : acc), [])
  if (hits.length !== 1) {
    if (hits.length > 1) output.log(`  day.md: ${hits.length} lines match ${base} — left untouched`)
    return
  }
  lines.splice(hits[0], 1)
  await writeTextFile(dayMd, lines.join('\n'))
}

/** Point the surviving doc's day.md link text at the fused summary. */
async function retitleDayMdLine(docAbs: string, summary: string): Promise<void> {
  const dayMd = dayMdPathFor(docAbs)
  if (!(await exists(dayMd))) return
  const base = path.basename(docAbs)
  const lines = (await readTextFile(dayMd)).split('\n')
  const idx = lines.findIndex((l) => l.includes(base))
  if (idx === -1) return
  const retitled = lines[idx].replace(/\[[^\]]*\](\([^)]*\))/, (whole, target: string) =>
    target.includes(base) ? `[${summary}]${target}` : whole,
  )
  if (retitled !== lines[idx]) {
    lines[idx] = retitled
    await writeTextFile(dayMd, lines.join('\n'))
  }
}
