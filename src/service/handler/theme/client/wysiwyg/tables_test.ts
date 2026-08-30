import { assert, test } from '#test'
import { backspaceAtStart, deleteAcross, deleteAtEnd } from './delete.ts'
import type { MarkdownDocument, Node } from './model.ts'
import { parseDocument } from './parser.ts'
import { serializeDocument } from './serializer.ts'
import {
  cellBelow,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  nextCell,
  previousCell,
  setAlignment,
} from './tables.ts'

const SOURCE = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n'

function cells(doc: MarkdownDocument): Node[] {
  return [...doc.root.walk()].filter((node) => node.type === 'table_cell')
}

test('TBL-3 TBL-6 rows and columns are added, removed, moved and aligned; the table re-pads on save', () => {
  const run = (op: (doc: MarkdownDocument, table: Node) => unknown) => {
    const doc = parseDocument(SOURCE)
    op(doc, doc.blocks[0]!)
    return serializeDocument(doc)
  }
  assert({
    given: 'a 2×2 table with a header',
    should: 'insert and delete rows and columns, move them, set alignment, and never touch the header by row deletion',
    actual: [
      run((doc, t) => insertRow(doc, t, 2)),
      run((doc, t) => insertRow(doc, t, 0)),
      run((doc, t) => deleteRow(doc, t, 1)),
      run((doc, t) => deleteRow(doc, t, 0)),
      run((doc, t) => insertColumn(doc, t, 1)),
      run((doc, t) => deleteColumn(doc, t, 0)),
      run((_, t) => moveRow(t, 1, 2)),
      run((_, t) => moveColumn(t, 0, 1)),
      run((_, t) => setAlignment(t, 1, 'right')),
    ],
    expected: [
      '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n|     |     |\n| 3   | 4   |\n',
      '| a   | b   |\n| --- | --- |\n|     |     |\n| 1   | 2   |\n| 3   | 4   |\n',
      '| a   | b   |\n| --- | --- |\n| 3   | 4   |\n',
      SOURCE,
      '| a   |     | b   |\n| --- | --- | --- |\n| 1   |     | 2   |\n| 3   |     | 4   |\n',
      '| b   |\n| --- |\n| 2   |\n| 4   |\n',
      '| a   | b   |\n| --- | --- |\n| 3   | 4   |\n| 1   | 2   |\n',
      '| b   | a   |\n| --- | --- |\n| 2   | 1   |\n| 4   | 3   |\n',
      '| a   |   b |\n| --- | --: |\n| 1   |   2 |\n| 3   |   4 |\n',
    ],
  })
})

test('TBL-4 DEL-6 NAV-3 cells relate in reading order; Backspace at a cell start moves back or deletes an empty table', () => {
  const doc = parseDocument(SOURCE)
  const [a, b, one, two, three] = cells(doc)
  const empty = parseDocument('x\n\n|   |   |\n|---|---|\n|   |   |\n')
  const firstEmpty = cells(empty)[0]!
  const landing = backspaceAtStart(empty, firstEmpty)
  assert({
    given: 'the cells of a 2×2 table, and an all-empty table',
    should:
      'walk next/previous/below, move Backspace to the previous cell, and delete the empty table landing before it',
    actual: [
      nextCell(b!)?.text,
      previousCell(one!)?.text,
      cellBelow(a!)?.text,
      cellBelow(three!),
      backspaceAtStart(doc, two!)?.leaf.text,
      backspaceAtStart(doc, a!),
      deleteAtEnd(doc, two!)?.leaf.text,
      [serializeDocument(empty), landing?.leaf.text, landing?.offset],
    ],
    expected: ['1', 'b', '1', null, '1', null, '3', ['x\n', 'x', 1]],
  })
})

test('DEL-23 DEL-24 selections that touch a table clear its cells; a table wholly inside a selection goes', () => {
  const same = parseDocument(SOURCE)
  const [, sb, sone, stwo] = cells(same)
  deleteAcross(same, sb!, 0, stwo!, 1)
  const into = parseDocument('before\n\n' + SOURCE)
  const intoCells = cells(into)
  deleteAcross(into, into.blocks[0]!, 3, intoCells[2]!, 1)
  const outOf = parseDocument(SOURCE + '\nafter\n')
  const outCells = cells(outOf)
  deleteAcross(outOf, outCells[2]!, 0, outOf.blocks[1]!, 2)
  const whole = parseDocument('x\n\n' + SOURCE + '\ny\n')
  deleteAcross(whole, whole.blocks[0]!, 1, whole.blocks[2]!, 0)
  assert({
    given: 'a selection inside one table, one reaching into a table, one reaching out of it, and one covering it',
    should:
      'clear the covered cells (partial ends keep their outer text), cut the outside text, and remove the covered table',
    actual: [
      serializeDocument(same),
      serializeDocument(into),
      serializeDocument(outOf),
      serializeDocument(whole),
      sone!.text,
    ],
    expected: [
      '| a   |     |\n| --- | --- |\n|     |     |\n| 3   | 4   |\n',
      'bef\n\n|     |     |\n| --- | --- |\n|     | 2   |\n| 3   | 4   |\n',
      '| a   | b   |\n| --- | --- |\n|     |     |\n|     |     |\n\nter\n',
      'xy\n',
      '',
    ],
  })
})
