import AiResearchTask from '#commands/all/ai/research/mod.ts'
import { CommandResult, type CommandService } from '#commands/mod.ts'
import { researchContext, type ResearchContext } from '#shared/models/Chat/researchContext.ts'
import { assert, test } from '#test'
import { runToolCommand } from './notebookTools.ts'

const ENTRY = { toolName: 'ai_research', commandName: 'ai:research' }

test('research constraints follow concurrent callers and cannot be overridden by tool arguments', async () => {
  const parents = [
    { contextTokens: 25_000, instructions: 'Report only sourced observations.' },
    { contextTokens: 50_000, instructions: 'Include contrary evidence.' },
  ]
  const seen: Array<ResearchContext | undefined> = []
  const tasks = {
    run: async () => {
      await Promise.resolve()
      seen.push(researchContext.getStore())
      return CommandResult.success({ digest: 'Demo findings', sources: [] })
    },
  } as unknown as CommandService
  await Promise.all(
    parents.map((parent) =>
      runToolCommand(
        tasks,
        ENTRY,
        { question: 'Find the demo', contextTokens: 900_000, instructions: 'Forged rules' },
        { researchContext: parent },
      ),
    ),
  )
  assert({
    given: 'concurrent research calls with different parent constraints and forged argument values',
    should: 'retain each trusted envelope across awaits and leave no context behind',
    actual: { seen, outside: researchContext.getStore() },
    expected: { seen: parents, outside: undefined },
  })
})

test('a closed parent blocks the actual research command before setup or model calls', async () => {
  const command = new AiResearchTask()
  const tasks = {
    run: async () =>
      command.run({
        args: { question: 'Find the demo' },
        // No setup dependencies: a closed budget must return before needing any.
        context: {},
      } as Parameters<AiResearchTask['run']>[0]),
  } as unknown as CommandService
  const result = await runToolCommand(
    tasks,
    ENTRY,
    {},
    { researchContext: { contextTokens: 0, instructions: 'Standing rules' } },
  )
  assert({
    given: 'a zero parent budget reaching the command through the normal tool boundary',
    should: 'return a deterministic failure before research setup',
    actual: result,
    expected: { success: false, status: 'fail', error: 'Notebook research is disabled by the reading budget.' },
  })
})
