import { miFrontmatter, toSingleLine } from '#shared/models/MostImportant/frontmatter.ts'
import type { MIDraft } from './types.ts'

export function miMarkdown(draft: MIDraft, metadata: Record<string, unknown> = {}): string {
  const summary = toSingleLine(draft.summary)
  const dueBy = toSingleLine(draft.dueBy)
  return [
    miFrontmatter(summary, { ...metadata, summary }),
    '',
    `# ${summary}`,
    '',
    ...(dueBy ? [`Due: ${dueBy}`, ''] : []),
    draft.body.trim(),
    '',
  ].join('\n')
}
