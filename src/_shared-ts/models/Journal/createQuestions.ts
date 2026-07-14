import * as path from 'node:path'
import { readdir } from 'node:fs/promises'
import { readTextFile } from '#shared/fs/mod.ts'
import type { JournalType, Question } from './type.d.ts'
import { matchesPattern } from '#commands/all/day/_recurring/mod.ts'
import PlainDate from '#shared/universal/dates/nbdt/PlainDate/mod.ts'
import { DIR_BASE } from '#shared/config.ts'
import parseQuestionsFromMarkdown from './parseQuestionsMarkdown.ts'

const DIR_QUESTIONS = path.join(DIR_BASE, 'journal', 'questions')

// Map from JournalType to markdown filename
const typeToFilename: Record<string, string> = {
  Accountability: 'Accountability.md',
  Execution: 'Execution.md',
  Gratitude: 'Gratitude.md',
  Health: 'Health.md',
  Leadership: 'Leadership.md',
  'Lessons Learned': 'Lessons-Learned.md',
  Markets: 'Markets.md',
  Misc: 'Misc.md',
  Mood: 'Mood.md',
  News: 'News.md',
  Priorities: 'Priorities.md',
  Relationships: 'Relationships.md',
  'Self Improvement': 'Self-Improvement.md',
  Surprises: 'Surprises.md',
  Values: 'Values.md',
}

// Cache for loaded questions
const questionCache = new Map<JournalType, Question[]>()

/**
 * Load questions from a markdown file
 */
async function loadQuestionsFromFile(type: JournalType): Promise<Question[]> {
  // Check cache first
  if (questionCache.has(type)) {
    return questionCache.get(type)!
  }

  const filename = typeToFilename[type]
  if (!filename) return []

  const filePath = path.join(DIR_QUESTIONS, filename)

  try {
    const content = await readTextFile(filePath)
    const questions = parseQuestionsFromMarkdown(content)
    questionCache.set(type, questions)
    return questions
  } catch (err) {
    const error = err as NodeJS.ErrnoException
    if (error?.code === 'ENOENT') {
      // A type without a questions file is an AI-only type (same as an empty file)
      questionCache.set(type, [])
      return []
    }
    console.warn(`Failed to load questions from ${filePath}:`, err)
    return []
  }
}

/**
 * Get all available journal types by scanning the questions directory
 */
export async function getJournalTypes(): Promise<JournalType[]> {
  try {
    const files = await readdir(DIR_QUESTIONS)
    const types: JournalType[] = []

    for (const [type, filename] of Object.entries(typeToFilename)) {
      if (files.includes(filename)) {
        types.push(type as JournalType)
      }
    }

    return types
  } catch {
    // Fallback to all known types if directory read fails
    return Object.keys(typeToFilename) as JournalType[]
  }
}

// For backward compatibility - synchronous map (will be empty until loaded)
export const questionMap = new Map<JournalType, Question[]>()

// TODO: consider tweaking algorithm so that unless the probality is 100% (1.0)
// then the lowest probability question is the only question
// this could be good because when I get to a journal file with 3 questions
// I'm less likely to answer any of them
// that defeats the point when journaling - especially some of the rarer questions that require deep thought

// Question format: [pattern, probability, question, subQuestions?]
// - pattern: Recurring pattern (e.g., 'EVERY-DAY', 'EVERY-MON', 'MONTHLY-1')
// - probability: 0.0-1.0 chance of appearing when pattern matches
// Filter returns: all questions with probability=1.0 that match the pattern,
// plus only ONE rare question (the rarest that passed probability check)
export default async function createQuestions(
  type: JournalType,
  date: PlainDate,
  randomFunc = Math.random,
): Promise<Question[]> {
  let questions = await loadQuestionsFromFile(type)

  function filterQuestions(qs: Question[]): Question[] {
    // Filter by pattern match AND probability check
    const filteredQuestions = qs.filter(([pattern, probability]) => {
      return matchesPattern(date, pattern) && probability >= randomFunc()
    })

    const questionsThatHaveWeightsOf1 = filteredQuestions.filter(([_pattern, probability]) => {
      return probability === 1
    })

    const questionsThatDontHaveWeightsOf1 = filteredQuestions.filter(([_pattern, probability]) => {
      return probability !== 1
    })

    // sort weights, rarer question first (by probability at index 1)
    questionsThatDontHaveWeightsOf1.sort((q1, q2) => q1[1] - q2[1])

    const firstRareQuestion = questionsThatDontHaveWeightsOf1.shift()

    // making intention clear for new array
    const questions = [...questionsThatHaveWeightsOf1]
    if (firstRareQuestion) questions.push(firstRareQuestion)

    questions.forEach((question) => {
      const [_pattern, _probability, _questionStr, subQuestions] = question
      if (!subQuestions) return

      question[3] = filterQuestions(subQuestions)
    })

    return questions
  }

  questions = filterQuestions(questions || [])

  return questions
}
