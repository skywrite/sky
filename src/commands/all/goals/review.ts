import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import * as config from '#config'
import { exists, writeTextFile } from '#shared/fs/mod.ts'
import { type GoalCategory, GoalCoach, type Timeframe } from './_lib/GoalCoach.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  personal: Flag.boolean('Personal goals', { short: 'p', default: false }),
  professional: Flag.boolean('Professional goals', { short: 'P', default: false }),
  // Timeframe flags
  weekly: Flag.boolean('Weekly goal', { short: 'w', default: false }),
  monthly: Flag.boolean('Monthly goal', { short: 'm', default: false }),
  quarterly: Flag.boolean('Quarterly goal', { short: 'q', default: false }),
  annual: Flag.boolean('Annual goal', { short: 'a', default: false }),
}

type Params = InferParams<typeof params>

type Result = {
  path: string
  created: boolean
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'goals:review': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

function getGoalsPath(category: GoalCategory): string {
  return category === 'Professional' ? config.FILE_GOALS_PROFESSIONAL : config.FILE_GOALS_PERSONAL
}

function createFileHeader(category: GoalCategory): string {
  const today = new Date().toISOString().slice(0, 10)
  return `---
created: ${today}
updated: ${today}
type: Goals
category: ${category}
---

# ${category} Goals

`
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class GoalsReviewTask extends Command {
  static override description: CommandDescription = {
    name: 'goals:review',
    description: 'Review and update goals (creates if none exist)',
    usage: [
      'sky goals:review --personal              # Personal goals',
      'sky goals:review --professional          # Professional goals',
      'sky goals:review -p --weekly             # New weekly personal goal',
      'sky goals:review -p --quarterly          # New quarterly personal goal',
      'sky goals:review -P --annual             # New annual professional goal',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { personal, professional, weekly, monthly, quarterly, annual } = args

    // Default to personal if neither specified
    const category: GoalCategory = professional ? 'Professional' : 'Personal'
    const filePath = getGoalsPath(category)
    const fileExists = await exists(filePath)

    // Determine timeframe from flags (if any)
    const timeframe: Timeframe | undefined = weekly
      ? 'weekly'
      : monthly
        ? 'monthly'
        : quarterly
          ? 'quarterly'
          : annual
            ? 'annual'
            : undefined

    const coach = new GoalCoach({ category, output, timeframe })

    if (fileExists) {
      // Review existing goals
      await coach.reviewGoals(filePath)
      return CommandResult.success({ path: filePath, created: false })
    }

    // Discovery flow - create new goals
    const result = await coach.discoverGoals()

    if (result.success && result.markdown) {
      const content = createFileHeader(category) + result.markdown
      await writeTextFile(filePath, content)
      output.log(`\nSaved to ${filePath}`)
      return CommandResult.success({ path: filePath, created: true })
    }

    return CommandResult.fail('No goals created')
  }
}
