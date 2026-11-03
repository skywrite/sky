/**
 * A note's markdown as the page reads it: its title, whether anything is written yet, its front
 * matter, and the "/" a line types to ask for a block.
 */

import type { EditorFormat } from '../editor/wysiwyg/mod.ts'

/** A blank note: front matter that says what it is, and an empty title to write first. */
export const BLANK_NOTE = '---\ntype: Notes\n---\n\n# \n'

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

function bodyOf(content: string): string {
  return content.replace(FRONTMATTER, '')
}

/** The first `#` heading in plain words; empty while the title is. */
export function noteTitleOf(content: string): string {
  const heading = bodyOf(content).match(/^#[ \t]+(.*?)\s*#*\s*$/m)?.[1] ?? ''
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|==|[*_`])/g, '')
    .trim()
}

/** Whether anything is written besides the title. */
export function hasBody(content: string): boolean {
  const lines = bodyOf(content).split(/\r?\n/)
  const title = lines.findIndex((line) => /^#(?:[ \t]|$)/.test(line))
  return lines.some((line, index) => index !== title && line.trim() !== '')
}

/**
 * How long after the last edit the page saves; null when there is nothing to save yet. A note that
 * has no file waits for a body, or a pause on its title long enough that the title is likely done,
 * since the file is named by the title it has when it is first saved.
 */
export function saveDelay(content: string, created: boolean): number | null {
  if (created || hasBody(content)) return 800
  return noteTitleOf(content) ? 2500 : null
}

/** The front matter's body, between the `---` lines; null when there is none. */
export function frontmatterOf(content: string): string | null {
  return content.match(FRONTMATTER)?.[1] ?? null
}

/** The time a note was written, from its front matter's `when:`. */
export function noteTimeOf(frontmatter: string | null): string | null {
  return frontmatter?.match(/^when:\s*['"]?(\d{1,2}:\d{2})/m)?.[1] ?? null
}

/** The words after a "/" that is a line's only text, the caret at its end; null when the line asks nothing. */
export function slashQuery(text: string, caret: number): string | null {
  if (caret !== text.length) return null
  return /^\/([\p{L}\p{N} ]{0,24})$/u.exec(text)?.[1] ?? null
}

export type InsertCommand = EditorFormat | 'image'

export interface InsertOption {
  command: InsertCommand
  label: string
  /** The markdown the block is written as, shown beside its name */
  mark: string
  /** Other words a person might type for it */
  words: string[]
  /** Options sit in groups: headings, lists, blocks, files and links */
  group: number
}

export const INSERT_OPTIONS: InsertOption[] = [
  { command: 'heading1', label: 'Heading 1', mark: '#', words: ['h1', 'title'], group: 0 },
  { command: 'heading2', label: 'Heading 2', mark: '##', words: ['h2', 'subtitle'], group: 0 },
  { command: 'heading3', label: 'Heading 3', mark: '###', words: ['h3'], group: 0 },
  { command: 'bullets', label: 'Bulleted list', mark: '-', words: ['list', 'ul', 'bullet'], group: 1 },
  { command: 'numbers', label: 'Numbered list', mark: '1.', words: ['list', 'ol', 'number'], group: 1 },
  { command: 'tasks', label: 'Checklist', mark: '- [ ]', words: ['todo', 'task', 'check', 'list'], group: 1 },
  { command: 'quote', label: 'Quote', mark: '>', words: ['blockquote'], group: 2 },
  { command: 'codeblock', label: 'Code block', mark: '```', words: ['code', 'fence'], group: 2 },
  { command: 'table', label: 'Table', mark: '| a | b |', words: ['grid'], group: 2 },
  { command: 'divider', label: 'Divider', mark: '---', words: ['hr', 'line', 'rule', 'separator'], group: 2 },
  {
    command: 'image',
    label: 'Image or file',
    mark: '![ ]( )',
    words: ['picture', 'photo', 'attach', 'file'],
    group: 3,
  },
  { command: 'link', label: 'Link', mark: '[ ]( )', words: ['url', 'href'], group: 3 },
]

/**
 * The options a query names: first those whose name has a word starting with it, then those a
 * word a person might type answers — "ta" is Table, then Checklist for "task".
 */
export function insertOptions(query: string): InsertOption[] {
  const wanted = query.trim().toLowerCase()
  if (!wanted) return INSERT_OPTIONS
  const named = (option: InsertOption) =>
    option.label.toLowerCase().startsWith(wanted) ||
    option.label
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.startsWith(wanted))
  const meant = (option: InsertOption) => !named(option) && option.words.some((word) => word.startsWith(wanted))
  return [...INSERT_OPTIONS.filter(named), ...INSERT_OPTIONS.filter(meant)]
}
