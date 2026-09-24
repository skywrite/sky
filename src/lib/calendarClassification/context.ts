import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { AboutMeDocument } from '#shared/models/AboutMe/mod.ts'

export type CalendarOwnerContext = {
  name: string
  family: string
}

/** Read only identity and family context; the rest of the owner's biography is unrelated to sorting. */
export async function readCalendarOwnerContext(notebookDir: string): Promise<CalendarOwnerContext> {
  const text = await readFile(path.join(notebookDir, 'journal', 'about-me.md'), 'utf8').catch(() => '')
  const profile = AboutMeDocument.fromMarkdown(text)
  const family =
    profile.family ||
    profile.bio
      .split(/\n\s*\n/)
      .filter((paragraph) =>
        /\b(family|household|spouse|wife|husband|partner|married|children|kids|son|daughter|stepchild|stepson|stepdaughter)\b/i.test(
          paragraph,
        ),
      )
      .join('\n\n')
  // Keep complete paragraphs: an incomplete relationship can identify the wrong person.
  let remaining = 4_000
  const paragraphs = family.split(/\n\s*\n/).filter((paragraph) => {
    if (paragraph.length > remaining) return false
    remaining -= paragraph.length + 2
    return true
  })
  return { name: profile.fullName, family: paragraphs.join('\n\n').trim() }
}
