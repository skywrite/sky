/**
 * Names for live dictation.
 *
 * The live transcriber has never heard of the notebook's people, companies, projects or
 * products, so it spells them by sound. Two steps put them right:
 *
 * - `keywords()` goes to the transcriber before the person speaks, so most names come out right
 *   while the words stream.
 * - `correct()` runs once on the finished text. A fast model reads the note against the same
 *   names and the saved transcript corrections, and returns the few replacements it is sure of.
 *
 * Saved corrections are never replayed here as plain find-and-replace. Each was ruled inside one
 * transcript, and replayed blind they rewrite ordinary speech.
 * The reasoning and measurements: service/handler/day/docs/2026-11-26-names-in-live-dictation.md
 */

import { generateText } from 'ai'
import { z } from 'zod'
import { applyCorrections } from '#commands/all/audio/transcript/lib/applyCorrections.ts'
import {
  capForPrompt,
  type Glossary,
  glossaryKeywords,
  loadGlossary,
  renderGlossary,
} from '#commands/all/audio/transcript/lib/glossary.ts'
import { extractJson } from '#shared/ai/extractJson.ts'
import { aiModelByProfile, type ProfileName } from '#shared/ai/models.ts'
import { runWithUsageSource } from '#shared/ai/usageLog.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

/** A name with the interaction score the notebook keeps for it. */
export interface ScoredName {
  name: string
  score: number
  /** ISO date of the latest interaction; null when there has been none */
  lastInteraction: string | null
}

/** Where the notebook's names come from. */
export interface DictationNameSources {
  people: () => ScoredName[]
  orgs: () => ScoredName[]
  /** Project names as their folders spell them */
  projects: () => string[]
  /** Test seam: production reads the calendar date. */
  today?: () => PlainDate
  /** Test seam: production reads the saved transcript corrections. */
  glossary?: () => Promise<Glossary | null>
  /** Test seam: production asks the model. */
  ask?: (prompt: string, signal?: AbortSignal) => Promise<string>
}

export interface DictationNames {
  /** Names the live transcriber should listen for, strongest first */
  keywords(): Promise<string[]>
  /** The dictated text with misheard names put right; the same text when nothing needs fixing */
  correct(text: string, signal?: AbortSignal): Promise<string>
}

// Chosen by measurement on 2026-11-26. At low effort this preset fixed every misheard name in the
// test notes and left ordinary sentences alone, in about one to two seconds. The reasoning role
// took 33 seconds on a three-word note. The fast role answered in a second and left the name wrong.
const NAMES_PROFILE = 'default-gpt-6.1-sol-ultrafast' satisfies ProfileName

/** The person is waiting to edit their text; past this the unchecked text is better than more waiting. */
const CHECK_TIMEOUT_MS = 5000

/** People the notebook has heard from within a year, the window the transcript check uses. */
const PEOPLE_WINDOW_DAYS = 365

/** Below this many characters a name token is prose, not a name ("de", "Al"). */
const MIN_TOKEN_CHARS = 3

const PROMPT_FILE = new URL('./prompts/names.prompt.md', import.meta.url).pathname

const Fixes = z.object({ fixes: z.array(z.object({ from: z.string(), to: z.string() })).max(20) })

const scoreLine = (entry: ScoredName): string => `${entry.name} (${Math.floor(entry.score)})`
const byScore = (a: ScoredName, b: ScoredName): number => b.score - a.score

/** A project folder is named with hyphens and spoken with spaces. */
const spoken = (project: string): string => project.replace(/-/g, ' ')

/** A person filed under a handle (`org/handle`) has no name anyone says. */
const isHandle = (name: string): boolean => name.includes('/')

/** One word without its possessive or edge punctuation, so "Doe's," and "Doe" compare equal. */
const bareWord = (word: string): string => word.replace(/['’]s$/, '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')

const bareWords = (text: string): string[] => text.toLowerCase().split(/\s+/).map(bareWord).filter(Boolean)

function distinct(terms: string[]): string[] {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const term of terms) {
    const trimmed = term.trim()
    const key = trimmed.toLowerCase()
    if (!trimmed || seen.has(key)) continue
    seen.add(key)
    kept.push(trimmed)
  }
  return kept
}

/** True when the replacement spells a listed name: the whole of it, or a run of its words. */
function spellsListedName(replacement: string, names: Set<string>): boolean {
  const words = bareWords(replacement)
  for (let start = 0; start < words.length; start++) {
    for (let end = words.length; end > start; end--) {
      if (names.has(words.slice(start, end).join(' '))) return true
    }
  }
  return false
}

async function askModel(prompt: string, signal?: AbortSignal): Promise<string> {
  return runWithUsageSource('day:dictation:names', async () => {
    const { text } = await generateText({
      ...aiModelByProfile(NAMES_PROFILE, { effort: 'low', maxRetries: 0 }),
      prompt,
      abortSignal: signal,
      timeout: CHECK_TIMEOUT_MS,
    })
    return text
  })
}

export function createDictationNames(sources: DictationNameSources): DictationNames {
  const ask = sources.ask ?? askModel
  const savedCorrections = (): Promise<Glossary | null> => (sources.glossary ? sources.glossary() : loadGlossary())

  /** The same lists, windows and order the transcript check reads. */
  function known() {
    const cutoff = (sources.today?.() ?? PlainDate.today()).addDays(-PEOPLE_WINDOW_DAYS).ymd
    return {
      people: sources
        .people()
        .filter((person) => person.lastInteraction !== null && person.lastInteraction > cutoff)
        .toSorted(byScore),
      orgs: sources
        .orgs()
        .filter((org) => org.score > 0)
        .toSorted(byScore),
      projects: sources.projects().toSorted((a, b) => a.localeCompare(b)),
    }
  }

  return {
    async keywords() {
      const { people, orgs, projects } = known()
      const saved = await savedCorrections()
      return distinct([
        ...people.map((person) => person.name).filter((name) => !isHandle(name)),
        ...orgs.map((org) => org.name),
        ...projects.map(spoken),
        ...(saved ? glossaryKeywords(saved) : []),
      ])
    },

    async correct(text, signal) {
      if (!text.trim()) return text
      const { people, orgs, projects } = known()
      const saved = await savedCorrections()
      const savedNames = saved ? glossaryKeywords(saved) : []
      // A notebook with no names yet has nothing to match the note against.
      if (people.length + orgs.length + projects.length + savedNames.length === 0) return text

      const { output: prompt } = renderPromptFile(await readPromptFile(PROMPT_FILE), 'names.prompt.md', {
        user: {
          note: text,
          knownPeople: people.map(scoreLine).join('\n'),
          knownOrgs: orgs.map(scoreLine).join('\n'),
          knownProjects: projects.join('\n'),
          glossary: saved ? renderGlossary(capForPrompt(saved).capped) : '(none yet)',
        },
      })
      const { fixes } = Fixes.parse(extractJson(await ask(prompt, signal)))

      // The model may only turn text into a name the notebook lists. Anything else it returns,
      // such as a reworded phrase or a changed verb, is dropped: this step fixes names, not prose.
      const names = new Set<string>()
      for (const person of people) {
        if (isHandle(person.name)) continue
        const words = bareWords(person.name)
        names.add(words.join(' '))
        for (const word of words) if (word.length >= MIN_TOKEN_CHARS) names.add(word)
      }
      for (const name of [...orgs.map((org) => org.name), ...projects.map(spoken), ...savedNames]) {
        names.add(bareWords(name).join(' '))
      }
      names.delete('')
      const allowed = fixes.filter((fix) => fix.from.trim() !== '' && spellsListedName(fix.to, names))
      if (allowed.length === 0) return text
      return applyCorrections(
        text,
        allowed.map((fix) => ({ originalText: fix.from, correction: fix.to, occurrences: 1 })),
      ).text
    },
  }
}
