import { assert, test } from '#test'
import { REPEAT_NOTE, RepetitionGuard, guardTools, refusalMessage } from './repetitionGuard.ts'

/** A tool that answers the same thing every time, counting its runs. */
function constantTool(answer: unknown) {
  let runs = 0
  return {
    runs: () => runs,
    tool: {
      description: 'Answers the same.',
      execute: (_input: unknown) => {
        runs++
        return Promise.resolve(answer)
      },
    },
  }
}

test('RepetitionGuard - the ladder: note, refuse, exhaust', async () => {
  const refused: string[] = []
  const guard = new RepetitionGuard({ onRefusal: (tool) => refused.push(tool) })
  const probe = constantTool('ok')
  const { probe: guarded } = guardTools({ probe: probe.tool }, guard)

  const results: unknown[] = []
  for (let i = 0; i < 5; i++) results.push(await guarded.execute({ q: 'same' }))

  assert({
    given: 'five identical calls to a tool that always answers the same',
    should:
      'run the first plainly, run the second with a note, refuse the rest unrun, and be exhausted after three refusals',
    expected: {
      results: [
        'ok',
        `ok\n\n(${REPEAT_NOTE})`,
        refusalMessage('probe'),
        refusalMessage('probe'),
        refusalMessage('probe'),
      ],
      runs: 2,
      refusals: 3,
      exhausted: true,
      told: ['probe', 'probe', 'probe'],
    },
    actual: { results, runs: probe.runs(), refusals: guard.refusals, exhausted: guard.exhausted, told: refused },
  })
})

test('RepetitionGuard - only an identical result counts as a repeat', async () => {
  const guard = new RepetitionGuard()
  let answer = 'draft'
  let runs = 0
  const { read } = guardTools(
    {
      read: {
        execute: (_input: unknown) => {
          runs++
          return Promise.resolve(answer)
        },
      },
    },
    guard,
  )

  const first = await read.execute({ path: 'a.md' })
  answer = 'final'
  const second = await read.execute({ path: 'a.md' })
  const third = await read.execute({ path: 'a.md' })
  const other = await read.execute({ path: 'b.md' })
  const fourth = await read.execute({ path: 'a.md' })

  assert({
    given: 'a re-read whose result changed in between, then settled',
    should: 'count repeats only from the changed result on, and keep other inputs apart',
    expected: {
      first: 'draft',
      second: 'final',
      third: `final\n\n(${REPEAT_NOTE})`,
      other: 'final',
      fourth: refusalMessage('read'),
      runs: 4,
      exhausted: false,
    },
    actual: { first, second, third, other, fourth, runs, exhausted: guard.exhausted },
  })
})

test('RepetitionGuard - input spelling and result shapes', async () => {
  const guard = new RepetitionGuard()
  const list = constantTool([1, 2])
  const doc = constantTool({ title: 'Atlas' })
  const tools = guardTools({ list: list.tool, doc: doc.tool }, guard)

  await tools.list.execute({ a: 1, b: 2 })
  const listAgain = await tools.list.execute({ b: 2, a: 1, c: undefined })
  await tools.doc.execute({ id: 'd1' })
  const docAgain = await tools.doc.execute({ id: 'd1' })

  assert({
    given: 'the same input spelled with keys in another order, and array and object results',
    should: 'treat the spellings as one input, wrap an array result, and annotate an object result in place',
    expected: {
      listAgain: { repeated: REPEAT_NOTE, result: [1, 2] },
      docAgain: { title: 'Atlas', repeated: REPEAT_NOTE },
    },
    actual: { listAgain, docAgain },
  })
})

test('guardTools - copies the set, leaves tools without execute alone', () => {
  // Typed loosely on purpose: a set may hold tools with no execute at all.
  const original: Record<string, { description: string; execute?: (input: unknown) => Promise<string> }> = {
    probe: { description: 'Probes.', execute: (_input: unknown) => Promise.resolve('ok') },
    provided: { description: 'Runs on the provider.' },
  }
  const guarded = guardTools(original, new RepetitionGuard())

  assert({
    given: 'a tool set with one executable and one provider-run tool',
    should: 'return new objects for the executable, the same object for the other, and never touch the original',
    expected: { probeWrapped: true, providedSame: true, originalUntouched: true },
    actual: {
      probeWrapped: guarded.probe !== original.probe && guarded.probe?.execute !== original.probe?.execute,
      providedSame: guarded.provided === original.provided,
      originalUntouched: original.probe?.execute?.length === 1 && guarded !== original,
    },
  })
})
