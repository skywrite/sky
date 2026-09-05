import type { AutomationStatus } from './mod.ts'

/*
  Flip a charter between active and paused, touching nothing else.

  A charter is the person's pen, so this is a textual edit, not a parse and
  re-serialize: comments, key order, spacing and the whole body come through
  byte for byte. Only the `status:` line changes — replaced where it exists,
  added as the last frontmatter line where it does not.
*/

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/
const STATUS_LINE = /^[ \t]*status[ \t]*:.*$/m

/** Throws when the contents carry no frontmatter block to write into */
export function setAutomationStatus(contents: string, status: AutomationStatus): string {
  const match = FRONTMATTER.exec(contents)
  if (!match) {
    throw new Error('The charter has no frontmatter block to carry status:')
  }

  const yaml = match[1]!
  const updated = STATUS_LINE.test(yaml) ? yaml.replace(STATUS_LINE, `status: ${status}`) : `${yaml}\nstatus: ${status}`

  return `---\n${updated}\n---${contents.slice(match.index + match[0].length)}`
}
