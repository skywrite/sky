import type { ModelInvoker } from '#shared/models/Chat/ChatEngine/mod.ts'
import { assert, test } from '#test'
import { runEpilogue } from './epilogue.ts'

// The engine's scripted model: one reply per conversation, in order. The
// files are never opened here; what is under test is the shape of the
// ending — a conversation per file, a verdict each, one finishing turn.
function scripted(replies: Array<string | Error>) {
  const prompts: string[] = []
  const invokeModel: ModelInvoker = async (args) => {
    const last = args.messages.at(-1) as { content: unknown }
    prompts.push(typeof last.content === 'string' ? last.content : JSON.stringify(last.content))
    const next = replies[prompts.length - 1]
    if (next === undefined) throw new Error(`scripted model exhausted after ${replies.length} replies`)
    if (next instanceof Error) throw next
    args.sink.write(next)
    return { text: next, content: [], steps: [], responseMessages: [] }
  }
  return { invokeModel, prompts }
}

test('the ending checks each file in its own conversation and finishes without the files', async () => {
  const { invokeModel, prompts } = scripted([
    'A 2025 tax statement. Covers 2025. Yes, it fits.',
    new Error('This conversation and its attachments still exceed the model’s capacity.'),
    'A 2024 statement. Covers 2024. Wrong year.',
    'Saved the 2025 statement. The huge one could not be checked. The 2024 one is the wrong year.',
  ])
  const result = await runEpilogue({
    model: {} as never,
    goal: 'download my 2025 tax forms and save them to ~/Taxes/',
    tools: { read_file: {}, save_file: {} },
    history: ['Opened the site', 'Downloaded file A.pdf', 'Downloaded file huge.pdf', 'Downloaded file old.pdf'],
    files: ['/t/files/A.pdf', '/t/files/huge.pdf', '/t/files/old.pdf'],
    outcome: 'Jev judged the goal done (90%).',
    when: '2026-09-27 10:30',
    invokeModel,
  })
  assert({
    given: 'three files, the second too large for the model',
    should:
      'hold four conversations, carry a verdict per file, and hand the finishing turn the verdicts rather than the files',
    actual: {
      conversations: prompts.length,
      firstPromptNamesOneFile: prompts[0].includes('/t/files/A.pdf') && !prompts[0].includes('huge.pdf'),
      verdicts: result.verdicts.map((v) => [v.checked, v.verdict.split('\n')[0]]),
      finishingSeesVerdicts: prompts[3].includes('Wrong year') && prompts[3].includes('larger than the model can read'),
      report: result.report,
    },
    expected: {
      conversations: 4,
      firstPromptNamesOneFile: true,
      verdicts: [
        [true, 'A 2025 tax statement. Covers 2025. Yes, it fits.'],
        [false, 'Could not be checked: the file is larger than the model can read at once.'],
        [true, 'A 2024 statement. Covers 2024. Wrong year.'],
      ],
      finishingSeesVerdicts: true,
      report: 'Saved the 2025 statement. The huge one could not be checked. The 2024 one is the wrong year.',
    },
  })
})
