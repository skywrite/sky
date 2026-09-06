import colors from 'picocolors'
/**
 * ai:research — a fresh-context research subagent over the notebook.
 *
 * Takes a self-contained question, explores the notebook with a closed set
 * of read-only tools (GraphQL queries, document reads, person lookup), and
 * returns a bounded findings report plus the source paths it actually
 * surfaced. It inherits nothing from the caller: ai:chat passes a brief,
 * the CLI passes a question — both get the same run.
 *
 * The loop is ChatEngine — one mission turn with a raised step budget —
 * not ChatSession: research has no conversation, no notebook context
 * ladder, and nothing to save, so the session wrapper's producers and
 * persistence would all be stubs here.
 */
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { aiModel } from '#shared/ai/models.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import ChatEngine from '#shared/models/Chat/ChatEngine/mod.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import truncate from '#shared/strings/truncate.ts'
import { timingLine, type TimingSummary } from '#shared/timing/summary.ts'
import { createResearchTools, type ResearchTrace } from './lib/tools.ts'

// -----------------------------------------------------------------------------
// Params
// -----------------------------------------------------------------------------

const params = {
  question: Arg.string('The research question, self-contained — the agent sees nothing else'),
  purpose: Flag.string('What the caller is doing and why the answer matters — shapes what the report emphasizes', {
    short: 'p',
    optional: true,
  }),
}

type Params = InferParams<typeof params>

interface Result {
  timing?: TimingSummary
  /** The findings report — the answer, key facts with inline paths, and a coverage line. */
  digest: string
  /** Notebook-relative paths of every document the run surfaced to the model. */
  sources: string[]
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ai:research': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const PROMPT_FILE = new URL('./prompts/research.prompt.md', import.meta.url).pathname
const SCHEMA_FILE = new URL('../../../../_shared-ts/models/DomainCollection/query/schema.graphql', import.meta.url)
  .pathname

/** Tool steps the mission turn may take — a few queries, reads, and repairs. */
const MAX_STEPS = 10
/** Hard cap on the returned report. The prompt asks for far less. */
const DIGEST_MAX_CHARS = 12_000

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

@AIChatTool({ needsApproval: false })
export default class AiResearchTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:research',
    description:
      'Research the notebook for something the provided context does not cover: a person, org, project, or event you cannot ground; a claim to verify; anything you would otherwise call "not in my context". A separate agent with NO view of this conversation searches the notebook (queries, document reads, person files) and returns a findings report with source paths. Write a self-contained question and put what the user is doing in `purpose`. Not for things already in context, general knowledge, or the web. Carry the report\'s key facts into your reply — the raw result does not survive a resumed session.',
    descriptionLong: [
      'Runs a fresh-context research agent over the notebook: it writes its',
      'own queries against the notebook schema, reads documents, and looks up',
      'people, then reports findings with the paths it drew on. Read-only —',
      'it creates and changes nothing.',
    ],
    usage: [
      'sky ai:research "Who is Jane Doe and how have we worked with her?"',
      'sky ai:research "What is the history of the Atlas project?" -p "Preparing a status update"',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { question, purpose } = args

    const [template, schema] = await Promise.all([readPromptFile(PROMPT_FILE), readTextFile(SCHEMA_FILE)])
    const { output: systemPrompt } = renderPromptFile(template, 'research.prompt.md', {
      context: {
        notebookDate: context.notebookNow.date,
        notebookTime: context.notebookNow.time,
        notebookTimezone: context.notebookNow.timezone,
      },
      user: { schema },
    })

    const trace: ResearchTrace = { sources: new Set() }
    const tools = createResearchTools({
      tasks,
      baseDir: config.DIR_BASE as string,
      today: context.notebookNow.plainDateTime.plainDate,
      trace,
    })

    const engine = new ChatEngine({
      model: aiModel('balanced'),
      maxSteps: MAX_STEPS,
      // The tool set is closed and approval-free; nothing ever asks.
      approvalHandler: () => Promise.resolve({ approved: false, reason: 'Research runs without approvals.' }),
      onEvent: (event) => {
        if (event.type === 'tool-call') {
          const input = truncate(JSON.stringify(event.input ?? ''), 100)
          output.log(colors.dim(`  → ${event.toolName} ${input}`))
        }
      },
    })

    const mission = purpose
      ? `Research question: ${question}\n\nCaller's purpose: ${purpose}`
      : `Research question: ${question}`
    engine.appendUserMessage(mission)

    try {
      const result = await engine.runTurn({ instructions: [systemPrompt], tools, toolApproval: {} })
      const digest = truncate(result.text.trim(), DIGEST_MAX_CHARS, '\n\n[Report truncated]')
      const sources = [...trace.sources].sort()

      output.log('')
      output.log(digest)
      if (sources.length > 0) {
        output.log('')
        output.log(colors.dim(`Sources (${sources.length}):`))
        for (const s of sources) output.log(colors.dim(`  ${s}`))
      }
      if (result.timing) output.log(colors.dim(`Timing: ${timingLine(result.timing)}`))
      return CommandResult.success({ digest, sources, timing: result.timing })
    } catch (err) {
      const message = (err as Error).message ?? String(err)
      await logAIError({ source: 'ai:research', stage: 'turn', message, question })
      return CommandResult.fail(message)
    }
  }
}
