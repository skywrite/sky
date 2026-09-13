import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { workstreamStoragePaths } from '#lib/workstreams/storagePaths.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { missing, readOptional } from './files.ts'
import type { OwnerInitiative } from './requestAttention.ts'

/** Read declared active work, rather than treating the owner's employer as an initiative. */
export async function loadOwnerInitiatives(config: {
  DIR_BASE: string
  DIR_STATE: string
  DIR_PROJECTS: string
}): Promise<OwnerInitiative[]> {
  const initiatives = new Map<string, OwnerInitiative>()
  const visit = async (dir: string, kind: 'project' | 'workstream') => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (missing(error)) return
      throw error
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
      const file = path.join(dir, entry.name)
      if (entry.isDirectory() && !['artifacts', 'runs', 'decisions', 'deliveries'].includes(entry.name))
        await visit(file, kind)
      if (
        !entry.isFile() ||
        (kind === 'project'
          ? entry.name !== 'overview.md' || path.basename(dir) !== '_project'
          : entry.name !== 'workstream.md')
      )
        continue
      const raw = await readOptional(file)
      if (raw === undefined) continue
      const doc = Document.fromMarkdown(raw)
      if (doc.yamlError)
        throw new Error('An active initiative has invalid frontmatter; repair it before checking Outbox.')
      if (kind === 'workstream') {
        if (typeof doc.yaml.id !== 'string') continue
        const ref = `workstreams/${doc.yaml.id}`
        initiatives.delete(ref)
        if (doc.yaml.deletion || (doc.yaml.state ?? 'active') !== 'active') continue
        initiatives.set(ref, {
          ref,
          title: String(doc.yaml.title ?? ''),
          context: [doc.yaml.intent, doc.yaml.outcome]
            .filter((value) => typeof value === 'string')
            .join('\n')
            .slice(0, 2400),
        })
      } else {
        if ((doc.yaml.status ?? 'open') !== 'open') continue
        const ref = path.relative(config.DIR_BASE, file)
        initiatives.set(ref, {
          ref,
          title: String(doc.yaml.name ?? path.basename(path.dirname(dir))),
          context: doc.markdown.slice(0, 2400),
        })
      }
    }
  }
  await visit(path.join(config.DIR_PROJECTS, 'open'), 'project')
  await visit(path.join(config.DIR_BASE, 'workstreams'), 'workstream')
  await visit(workstreamStoragePaths(config).dir, 'workstream')
  return [...initiatives.values()].sort((a, b) => a.ref.localeCompare(b.ref))
}
