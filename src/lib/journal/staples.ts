import * as path from 'node:path'
import createQuestions from '#shared/models/Journal/createQuestions.ts'
import type { Question } from '#shared/models/Journal/type.d.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const flatten = (questions: Question[]): string[] => questions.flatMap((q) => [q[2], ...flatten(q[3] ?? [])])

export async function journalStaples(notebookDir: string, day: string) {
  const defaults = {
    Health: 'How is your body feeling today? What has helped or drained your energy?',
    Mood: 'How are you feeling today? What do you think is behind that?',
  }
  return Promise.all(
    Object.entries(defaults).map(async ([title, fallback]) => {
      const questions = flatten(
        await createQuestions(title, new PlainDate(day), Math.random, path.join(notebookDir, 'journal/questions')),
      )
      return { title, questions: questions.length ? questions : [fallback] }
    }),
  )
}
