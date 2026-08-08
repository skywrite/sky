import CommandContext from '#commands/lib/core/CommandContext.ts'
import { BufferedOutput } from '#commands/lib/output/BufferedOutput.ts'
import { CommandResult } from '#commands/mod.ts'
import * as config from '#config'
import { assert, test } from '#test'
import type { MissionFile } from '../google/agent/lib/tools.ts'
import LegalReviewTask from './review.ts'

function createContext() {
  const output = new BufferedOutput()
  const context = CommandContext.test(config).fork({ output })
  return { output, context }
}

function createTasks(result: CommandResult<unknown>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const tasks = {
    run: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      return result
    },
  }
  return { calls, tasks }
}

const DOC_URL = 'https://docs.google.com/document/d/1AtlasDocId_abcdefghijk/edit'

const missionFiles: MissionFile[] = [
  { id: '1AtlasDocId_abcdefghijk', title: 'Atlas MSA', url: DOC_URL, kind: 'doc', action: 'created' },
]

const agentSuccess = () =>
  CommandResult.success({ report: 'Two high findings', files: missionFiles, artifact: 'artifacts/atlas-msa.md' })

test('legal:review - rejects unusable documents without running a mission', async () => {
  const { context } = createContext()
  const { calls, tasks } = createTasks(agentSuccess())
  const task = new LegalReviewTask()

  const blank = await task.run({ args: { document: '  ' }, context, tasks } as any)
  const png = await task.run({ args: { document: '/deals/scan.png' }, context, tasks } as any)

  assert({
    given: 'a blank document argument',
    should: 'fail with usage guidance',
    expected: true,
    actual: blank.failed && (blank.message ?? '').includes('Provide a document'),
  })

  assert({
    given: 'a local file Drive cannot convert to a Doc',
    should: 'fail naming the importable extensions',
    expected: true,
    actual: png.failed && (png.message ?? '').includes('.pdf'),
  })

  assert({
    given: 'only unusable documents',
    should: 'never start a mission',
    expected: 0,
    actual: calls.length,
  })
})

test('legal:review - sends a Google Doc URL as the mission file target', async () => {
  const { context } = createContext()
  const { calls, tasks } = createTasks(agentSuccess())
  const task = new LegalReviewTask()

  const result = await task.run({ args: { document: DOC_URL }, context, tasks } as any)
  const call = calls[0]
  const mission = String(call?.args.mission ?? '')

  assert({
    given: 'a Google Doc URL',
    should: 'run one google:agent mission targeting it as file, not import',
    expected: { count: 1, name: 'google:agent', file: DOC_URL, import: undefined },
    actual: { count: calls.length, name: call?.name, file: call?.args.file, import: call?.args.import },
  })

  assert({
    given: 'the legal-review brief',
    should: 'render fully with the summary-comment instruction and no leftover template syntax',
    expected: true,
    actual: mission.includes('[Summary] Contract review') && !mission.includes('{{'),
  })

  assert({
    given: 'no focus argument',
    should: 'omit the focus weighting from the brief',
    expected: false,
    actual: mission.includes('Weight the review toward'),
  })

  assert({
    given: 'a successful mission',
    should: 'surface the report and the reviewed Doc url',
    expected: { ok: true, report: 'Two high findings', url: DOC_URL, artifact: 'artifacts/atlas-msa.md' },
    actual: {
      ok: result.ok,
      report: result.data?.report,
      url: result.data?.url,
      artifact: result.data?.artifact,
    },
  })
})

test('legal:review - imports a local document and weights the brief by focus', async () => {
  const { context } = createContext()
  const { calls, tasks } = createTasks(agentSuccess())
  const task = new LegalReviewTask()

  await task.run({
    args: { document: '~/deals/atlas-msa.pdf', focus: 'the indemnity cap and renewal window' },
    context,
    tasks,
  } as any)
  const call = calls[0]
  const mission = String(call?.args.mission ?? '')

  assert({
    given: 'a local PDF path',
    should: 'run the mission with import set and file unset',
    expected: { file: undefined, import: '~/deals/atlas-msa.pdf' },
    actual: { file: call?.args.file, import: call?.args.import },
  })

  assert({
    given: 'a focus argument',
    should: 'weight the rendered brief toward it',
    expected: true,
    actual: mission.includes('the indemnity cap and renewal window'),
  })
})

test('legal:review - passes a failed mission through', async () => {
  const { context } = createContext()
  const { tasks } = createTasks(CommandResult.fail('Drive quota exhausted'))
  const task = new LegalReviewTask()

  const result = await task.run({ args: { document: DOC_URL }, context, tasks } as any)

  assert({
    given: 'a mission that fails',
    should: 'fail with the mission message',
    expected: { failed: true, message: 'Drive quota exhausted' },
    actual: { failed: result.failed, message: result.message },
  })
})
