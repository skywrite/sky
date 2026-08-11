/**
 * Shared link-label generation for the task-adding commands
 * (next:add, day:todo:add, day:reminders:add).
 *
 * Each takes an optional --link and needs a short slug to name the markdown
 * reference link it appends: `task text [the-slug][]`.
 */

import { generateText } from 'ai'
import { slugify } from '#lib/string/mod.ts'
import { aiModel } from '#shared/ai/models.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'

const MAX_LABEL_LENGTH = 40

const PROMPT_NAME = 'link-label.prompt.md'
const PROMPT_FILE = new URL(`./prompts/${PROMPT_NAME}`, import.meta.url).pathname

/**
 * Shorten a task description to a slugified three-to-five word link label.
 * Falls back to slugifying the task itself when the model returns nothing.
 */
export async function taskLinkLabel(task: string): Promise<string> {
  const { output: instructions } = renderPromptFile(await readTextFile(PROMPT_FILE), PROMPT_NAME)

  const { text } = await generateText({
    ...aiModel('fast', { temperature: 0 }),
    instructions,
    prompt: `<statement>\n${task.trim()}\n</statement>`,
  })

  return slugify(text.trim() || task, { suggestedLength: MAX_LABEL_LENGTH })
}
