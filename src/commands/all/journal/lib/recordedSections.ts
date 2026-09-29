import { generateObject } from 'ai'
import { z } from 'zod'
import { aiModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import type { BodySection } from './splitSections.ts'

const PROMPT_FILE = new URL('../prompts/recorded-sections.prompt.md', import.meta.url).pathname

export interface RecordingSections {
  title: string
  summary: string
  sections: BodySection[]
}

/** Models choose boundaries; slicing the original text preserves every spoken word. */
export function sectionsFromStarts(
  text: string,
  starts: { heading: string; firstWords: string }[],
): BodySection[] | undefined {
  const words = [...text.matchAll(/\S+/g)]
  if (!words.length || !starts.length) return undefined
  const positions: number[] = []
  for (const start of starts) {
    const phrase = start.firstWords.trim().split(/\s+/)
    let found = -1
    for (let i = positions.length ? positions.at(-1)! + 1 : 0; i < words.length; i++) {
      if (phrase.every((word, j) => words[i + j]?.[0] === word)) {
        found = i
        break
      }
    }
    if (found < 0 || (!positions.length && found !== 0) || !start.heading.trim()) return undefined
    positions.push(found)
  }
  return positions.map((position, i) => {
    const end = positions[i + 1] === undefined ? text.length : words[positions[i + 1]].index
    const body = text.slice(words[position].index, end).trim()
    // These headings are excluded by downstream context gatherers.
    const heading =
      starts[i].heading
        .replace(/transcript/gi, '')
        .replace(/[\r\n#]/g, '')
        .trim() || 'What was said'
    return { heading, body, words: body.split(/\s+/).length }
  })
}

export async function organizeRecording(text: string, signal?: AbortSignal): Promise<RecordingSections> {
  const { output: prompt } = renderPromptFile(await readPromptFile(PROMPT_FILE), 'recorded-sections.prompt.md', {
    journal: { transcript: text },
  })
  const { object } = await generateObject({
    ...aiModel('reasoning'),
    abortSignal: signal,
    schema: z.object({
      title: z.string().describe('A specific five to seven word Title Case title, in the speaker’s vocabulary'),
      summary: z.string().describe('Two or three sentences describing the recording'),
      sections: z
        .array(
          z.object({
            heading: z.string().describe('A concrete topical heading, without the word transcript'),
            firstWords: z
              .string()
              .describe('The first six to twelve words of this section, copied exactly, including punctuation'),
          }),
        )
        .min(1),
    }),
    prompt,
  })
  const sections = sectionsFromStarts(text, object.sections)
  if (!sections) throw new Error('The journal sections did not match the recording. Retry to organize it again.')
  return { title: object.title.trim(), summary: object.summary.trim(), sections }
}
