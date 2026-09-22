export const STREAK_CATEGORIES = ['Personal', 'Professional'] as const
export type StreakCategory = (typeof STREAK_CATEGORIES)[number]

export function parseStreakCategory(value: unknown): StreakCategory | undefined {
  if (typeof value !== 'string') return undefined
  const category = value
    .trim()
    .replace(/\s+Complete$/i, '')
    .toLowerCase()
  return STREAK_CATEGORIES.find((candidate) => candidate.toLowerCase() === category)
}
