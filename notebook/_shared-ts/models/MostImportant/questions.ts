import ordinal from '#lib/numbers/ordinal.ts'

export function createPrimaryQuestions(count = 1): string[] {
  return [
    `What's ${ordinal(count)} most important you need to accomplish today?`,
    'Did you write it in a way that the action and outcome is clear?',
    'Does this help move my company closer to its goals?',
    'If no, why are you doing it? If yes, elaborate.',
  ]
}

export const dependQuestions = [
  'Do you depend upon anyone to get this done? If so, list who.',
  'What do these people need to do?',
]

export const closingQuestions = [
  // "Have you transferred the above answer including dependencies to today's commitments? Yes/no? If no, do not start the day.",
  'Reflection: Any notes? Did you accomplish yes/no? Why not?',
]
