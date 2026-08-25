import { dayWord } from '#universal/dates/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

/** The interview answers, as the user gave them. */
export interface QAAnswers {
  dueBy?: string
  strategic: string
  doneLooksLike: string
  dependencies?: string
  notes?: string
}

/** The document's section content — AI-enriched on the happy path, the raw
 * interview answers when enrichment fails. */
export interface MISections {
  focus: string
  whyThisMatters: string
  /** An array renders as checkable bullets; a string renders as written. */
  doneLooksLike: string[] | string
  dependencies?: string
  notes?: string
}

/**
 * Assemble the MI document body. The heading structure is built here in code —
 * never by the model — so the document shape is guaranteed whatever the
 * section content. The Reflection section stays empty for end-of-day.
 */
export function buildMIBody(sections: MISections, today: PlainDate): string {
  const done = Array.isArray(sections.doneLooksLike)
    ? sections.doneLooksLike.map((item) => `- ${item}`).join('\n')
    : sections.doneLooksLike

  const lines = [
    `# **${today.ymd} - ${dayWord(today.toDate(), 'short')}**`,
    '',
    '## Focus',
    '',
    sections.focus,
    '',
    '## Why This Matters',
    '',
    sections.whyThisMatters || '(not provided)',
    '',
    '## Done Looks Like',
    '',
    done || '(not provided)',
  ]

  if (sections.dependencies) {
    lines.push('', '## Dependencies', '', sections.dependencies)
  }

  if (sections.notes) {
    lines.push('', '## Notes', '', sections.notes)
  }

  lines.push('', '## Reflection', '', '')

  return lines.join('\n')
}
