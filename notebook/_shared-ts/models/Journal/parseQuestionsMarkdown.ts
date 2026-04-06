/**
 * Parse journal questions from markdown files
 *
 * Format:
 * ```markdown
 * ---
 * type: Health
 * created: 2026-01-13
 * updated: 2026-01-13
 * ---
 *
 * ## EVERY-DAY
 * - 1.0: How are you feeling?
 * - 0.5: What did you eat today?
 *   - 1.0: Was it healthy?
 *
 * ## EVERY-MON
 * - 1.0: Weekly check-in question
 * ```
 */

import { Document } from '#shared/models/Markdown/mod.ts'
import type { Question } from './type.d.ts'
import type { Tokens } from 'marked'

/**
 * Check if a heading matches a recurring pattern (e.g., EVERY-DAY, MONTHLY-1)
 */
function isPatternHeading(text: string): boolean {
  return /^[A-Z][A-Z0-9-]+$/.test(text)
}

/**
 * Parse a question from list item text: "1.0: Question text"
 */
function parseQuestionText(text: string): { probability: number; question: string } | null {
  const match = text.match(/^(\d+(?:\.\d+)?)\s*:\s*(.+)$/)
  if (!match) return null

  return {
    probability: parseFloat(match[1]),
    question: match[2].trim(),
  }
}

/**
 * Get the raw text content from a list item's tokens
 */
function getListItemText(item: Tokens.ListItem): string {
  // The first token is usually a 'text' token containing the item content
  for (const token of item.tokens) {
    if (token.type === 'text') {
      return token.text
    }
  }
  return ''
}

/**
 * Check if a list item has nested list (sub-questions)
 */
function getNestedList(item: Tokens.ListItem): Tokens.List | null {
  for (const token of item.tokens) {
    if (token.type === 'list') {
      return token as Tokens.List
    }
  }
  return null
}

/**
 * Parse a list token into questions array
 */
function parseList(list: Tokens.List, pattern: string): Question[] {
  const questions: Question[] = []

  for (const item of list.items) {
    const text = getListItemText(item)
    const parsed = parseQuestionText(text)

    if (!parsed) continue

    const question: Question = [pattern, parsed.probability, parsed.question]

    // Check for sub-questions (nested list)
    const nestedList = getNestedList(item)
    if (nestedList) {
      const subQuestions = parseList(nestedList, pattern)
      if (subQuestions.length > 0) {
        question[3] = subQuestions
      }
    }

    questions.push(question)
  }

  return questions
}

/**
 * Parse a markdown question file into Question[] array
 */
export function parseQuestionsFromMarkdown(content: string): Question[] {
  const doc = Document.fromMarkdown(content)
  const tokens = doc.markdownTokens
  const questions: Question[] = []

  let currentPattern: string | null = null

  for (const token of tokens) {
    if (token.type === 'heading' && token.depth === 2) {
      const headingText = token.text.trim()
      if (isPatternHeading(headingText)) {
        currentPattern = headingText
      }
    } else if (token.type === 'list' && currentPattern) {
      questions.push(...parseList(token as Tokens.List, currentPattern))
    }
  }

  return questions
}

export default parseQuestionsFromMarkdown
