import { assert, test } from '#test'
import { type Command, History } from './history.ts'

const step = (n: number): Command => ({
  kind: 'text',
  id: `n${n}`,
  before: { text: `${n - 1}`, cursor: null },
  after: { text: `${n}`, cursor: null },
})

test('UND-8 a new step discards the redo history; undo and redo walk the stack', () => {
  const history = new History()
  history.push(step(1))
  history.push(step(2))
  const undone = history.undo()
  const redone = history.redo()
  history.undo()
  history.push(step(3))
  assert({
    given: 'two steps, an undo, a redo, another undo, then a new step',
    should: 'hand back step 2 twice, then drop it for step 3',
    actual: [
      undone?.kind === 'text' && undone.id,
      redone?.kind === 'text' && redone.id,
      history.canRedo,
      history.last?.kind === 'text' && history.last.id,
    ],
    expected: ['n2', 'n2', false, 'n3'],
  })
})

test('UND-9 the stack is bounded', () => {
  const history = new History()
  for (let i = 1; i <= 200; i++) history.push(step(i))
  let count = 0
  while (history.undo()) count++
  assert({
    given: '200 typing steps',
    should: 'keep on the order of a hundred',
    actual: count,
    expected: 120,
  })
})
