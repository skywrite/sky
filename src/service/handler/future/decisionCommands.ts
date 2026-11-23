import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import type * as ConfigModule from '#shared/config.ts'
import type { FutureDecisionDraft } from './types.ts'

/** What `decisions:create` takes, as the page fills it in */
export interface DecisionCreate {
  title: string
  context: string
  desiredOutcomes: string
  /** What was decided; absent for a decision that is still open */
  decision?: string
  inForce: boolean
  /** "YYYY-MM-DD", when it was made or came up on an earlier day */
  when?: string
  /** "YYYY-MM-DD", the day an open decision should be made by */
  target?: string
  rel: string[]
  category: 'Personal' | 'Professional'
}

/** The two commands behind the page's two buttons */
export interface DecisionCommands {
  /** `decisions:clarify`: draft a decision from the person's words and the notebook */
  draft(input: { statement: string; conversation?: string }): Promise<FutureDecisionDraft>
  /** `decisions:create`: write the decision and its day line; returns the file it wrote */
  create(input: DecisionCreate): Promise<{ name: string; file: string }>
}

/**
 * Each button is one in-process command run, exactly the run the terminal
 * and chat do: the same draft prompt, the same file, day line and dates.
 */
export function createDecisionCommands(config: typeof ConfigModule, env: Record<string, string>): DecisionCommands {
  const createTasks = () => new CommandService(CommandContext.server(config, env))
  return {
    async draft({ statement, conversation }) {
      const result = await createTasks().run('decisions:clarify', { statement, conversation })
      if (result.status !== 'success' || !result.data)
        throw new Error(result.message ?? 'Sky could not draft this decision.')
      const { title, decision, target, context, desiredOutcomes, rel, openQuestions } = result.data
      return { title, decision, target, context, desiredOutcomes, rel, openQuestions }
    },
    async create({ rel, category, ...fields }) {
      const result = await createTasks().run('decisions:create', {
        ...fields,
        rel: rel.join(';') || undefined,
        // The command's own parser turns "Personal" into the day list it writes to; an in-process run passes that form.
        category: `${category} Complete`,
      })
      if (result.status !== 'success' || !result.data) throw new Error(result.message ?? 'The decision was not saved.')
      return { name: result.data.name, file: result.data.file }
    },
  }
}
