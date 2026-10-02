import { createHash } from 'node:crypto'
import { mergeRel } from '#lib/notebook/enrich/autoRel.ts'
import JournalDocument from '#shared/models/Journal/document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { stringify } from '#shared/yaml/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import {
  JournalError,
  type JournalEnrichment,
  type JournalSession,
  type Reflection,
  type ReflectionQuestion,
} from './types.ts'

export const answerVersion = (content: string): number =>
  content ? Number.parseInt(createHash('sha256').update(content).digest('hex').slice(0, 12), 16) : 0

export const journalType = (topic: Reflection): string => topic.journalType ?? (topic.staple ? topic.title : 'Misc')
const heading = (question: ReflectionQuestion) => `## ${question.text.replace(/[\r\n]+/g, ' ')}`
const structureError = () =>
  new JournalError(
    'A saved question heading changed or became ambiguous. Your writing is preserved; review the file before continuing.',
    409,
  )

export function newReflectionMarkdown(session: JournalSession, topic: Reflection): string {
  const type = journalType(topic)
  const yaml = stringify({ tags: `Journal/${type.replaceAll(' ', '-')}` }).trimEnd()
  return `---\n${yaml}\n---\n\n# **${type}: ${session.day} - ${new PlainDate(session.day).dayShort} - ${session.time}**\n\n`
}

/** Read the first browser format, but never write its bookkeeping back into the notebook. */
export function cleanReflectionMarkdown(markdown: string, topic: Reflection): { markdown: string; sections: string[] } {
  const sections = topic.sections ?? topic.questions.map((question) => question.id)
  if (!/^<!-- sky-journal:/m.test(markdown)) return { markdown, sections }
  const legacy: string[] = []
  for (const match of markdown.matchAll(/^<!-- sky-journal:([^\n]+) -->\n/gm)) {
    const question = topic.questions.find((item) => item.id === match[1])
    if (
      !question ||
      legacy.includes(question.id) ||
      !markdown.startsWith(`${heading(question)}\n\n`, match.index + match[0].length)
    )
      throw structureError()
    const end = `<!-- /sky-journal:${question.id} -->`
    if (markdown.indexOf(end) < match.index || markdown.indexOf(end) !== markdown.lastIndexOf(end))
      throw structureError()
    legacy.push(question.id)
  }
  for (const question of topic.questions)
    if (question.published && !legacy.includes(question.id)) throw structureError()
  return {
    markdown: markdown
      .replace(/^<!-- sky-journal-reflection:[^\n]+ -->\n\n?/m, '')
      .replace(/^<!-- sky-journal:[^\n]+ -->\n/gm, '')
      .replace(/^<!-- \/sky-journal:[^\n]+ -->\n{0,2}/gm, '\n'),
    sections: legacy,
  }
}

/** Only known question headings delimit answers; the owner's other headings and fenced code stay in the answer. */
function answerRanges(markdown: string, topic: Reflection) {
  const clean = cleanReflectionMarkdown(markdown, topic)
  const groups = new Map<string, ReflectionQuestion[]>()
  for (const id of clean.sections) {
    const question = topic.questions.find((item) => item.id === id)
    if (question) groups.set(heading(question), [...(groups.get(heading(question)) ?? []), question])
  }
  const found: Array<{ id: string; heading: number; start: number }> = []
  let offset = 0
  let fence = ''
  for (const line of clean.markdown.split('\n')) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (fence) {
      if (
        marker &&
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !line.slice(marker[0].length).trim()
      )
        fence = ''
    } else if (marker) fence = marker[1]
    else if (groups.has(line)) {
      const question = groups.get(line)!.shift()
      if (!question || clean.markdown.slice(offset + line.length, offset + line.length + 2) !== '\n\n')
        throw structureError()
      found.push({ id: question.id, heading: offset, start: offset + line.length + 2 })
    }
    offset += line.length + 1
  }
  for (const question of topic.questions)
    if (question.published && !found.some((item) => item.id === question.id)) throw structureError()
  const ranges = new Map(
    found.map((item, index) => {
      const end = found[index + 1]?.heading ?? clean.markdown.length
      // Two newlines separate blocks; any additional trailing whitespace belongs to the answer.
      const padding = clean.markdown.slice(item.start, end).endsWith('\n\n') ? 2 : 0
      return [item.id, { start: item.start, end: end - padding }]
    }),
  )
  return { markdown: clean.markdown, ranges }
}

export function readAnswers(markdown: string, topic: Reflection): Record<string, string> {
  const document = answerRanges(markdown, topic)
  return Object.fromEntries(
    topic.questions.map((question) => {
      const range = document.ranges.get(question.id)
      return [question.id, range ? document.markdown.slice(range.start, range.end) : '']
    }),
  )
}

export function writeAnswer(markdown: string, topic: Reflection, question: ReflectionQuestion, answer: string): string {
  const document = answerRanges(markdown, topic)
  const range = document.ranges.get(question.id)
  const next = range
    ? `${document.markdown.slice(0, range.start)}${answer}${document.markdown.slice(range.end)}`
    : `${document.markdown}${document.markdown.endsWith('\n\n') ? '' : '\n\n'}${heading(question)}\n\n${answer}\n\n`
  const checked = readAnswers(next, { ...topic, sections: [...new Set([...(topic.sections ?? []), question.id])] })
  if (checked[question.id] !== answer) throw structureError()
  return next
}

export function namedReflectionMarkdown(markdown: string, type: string, summary: string): string {
  const doc = JournalDocument.fromMarkdown(markdown)
  if (doc.yamlError)
    throw new JournalError('The journal’s frontmatter needs fixing before it can be named. Your writing is saved.', 409)
  const previousType = doc.markdown.match(/^# \*\*([^\n]+?): \d{4}-\d{2}-\d{2} - /m)?.[1]
  const previousTag = previousType ? `Journal/${previousType.replaceAll(' ', '-')}` : null
  const tags = [...doc.tags].filter((tag) => tag !== previousTag)
  const body = doc.markdown.replace(
    /^(# \*\*)[^\n]+?(: \d{4}-\d{2}-\d{2} - \w+ - \d{2}:\d{2}\*\*)/m,
    (_match, prefix: string, suffix: string) => `${prefix}${type}${suffix}`,
  )
  const yaml = stringify(
    {
      ...doc.yaml,
      summary,
      tags: String(TagSet.fromArray([...tags, `Journal/${type.replaceAll(' ', '-')}`])),
      rel: doc.rel.size ? doc.yaml.rel : undefined,
    },
    { keyOrder: JournalDocument.yamlKeyOrder },
  )
  return `---\n${yaml}\n---\n${body}`
}

export function enrichedReflectionMarkdown(markdown: string, enrichment: JournalEnrichment): string {
  const doc = JournalDocument.fromMarkdown(markdown)
  if (doc.yamlError)
    throw new JournalError(
      'The journal’s frontmatter needs fixing before tags and links can be added. Your writing is saved.',
      409,
    )
  const yaml = stringify(
    {
      ...doc.yaml,
      tags: String(TagSet.fromArray([...doc.tags, ...TagSet.fromString(enrichment.tags ?? '')])),
      rel: mergeRel([...doc.rel], enrichment.rel),
    },
    { keyOrder: JournalDocument.yamlKeyOrder },
  )
  return `---\n${yaml}\n---\n${doc.markdown}`
}
