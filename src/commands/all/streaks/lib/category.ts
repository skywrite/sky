import { Flag } from '#commands/mod.ts'
import { parseStreakCategory } from '#shared/models/Streak/mod.ts'

export function streakCategoryFlag() {
  return Flag.string('Personal or Professional (automatically inferred when omitted)', {
    short: 'c',
    optional: true,
    parse: (value: string) => {
      const category = parseStreakCategory(value)
      if (!category) throw new Error('Category must be Personal or Professional.')
      return category
    },
  })
}
