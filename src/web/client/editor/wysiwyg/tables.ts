/**
 * Tables on the model (architecture §12.6): cells found by row and column, rows and columns added,
 * removed, moved and aligned. Every structural change drops the table's verbatim source, so the
 * serializer re-pads it (RT-6). Model only.
 */

import type { Alignment, MarkdownDocument, Node } from './model.ts'

export interface CellPosition {
  table: Node
  row: Node
  rowIndex: number
  colIndex: number
}

export function cellPosition(cell: Node): CellPosition | null {
  const row = cell.parent
  const table = row?.parent
  if (!row || !table || cell.type !== 'table_cell' || table.type !== 'table') return null
  return { table, row, rowIndex: row.index, colIndex: cell.index }
}

/** The cell at a row and column, clamped into the table. */
export function cellAt(table: Node, rowIndex: number, colIndex: number): Node | null {
  const rows = table.children
  const row = rows[Math.min(Math.max(rowIndex, 0), rows.length - 1)]
  if (!row) return null
  const cells = row.children
  return cells[Math.min(Math.max(colIndex, 0), cells.length - 1)] ?? null
}

export function nextCell(cell: Node): Node | null {
  if (cell.after) return cell.after
  return cell.parent?.after?.firstChild ?? null
}

export function previousCell(cell: Node): Node | null {
  if (cell.before) return cell.before
  return cell.parent?.before?.lastChild ?? null
}

export function cellBelow(cell: Node): Node | null {
  const at = cellPosition(cell)
  return at?.row.after ? (cellAt(at.table, at.rowIndex + 1, at.colIndex) ?? null) : null
}

export function cellAbove(cell: Node): Node | null {
  const at = cellPosition(cell)
  return at?.row.before ? (cellAt(at.table, at.rowIndex - 1, at.colIndex) ?? null) : null
}

export function columnCount(table: Node): number {
  return Math.max(table.align?.length ?? 0, ...table.children.map((row) => row.childCount))
}

export function isTableEmpty(table: Node): boolean {
  return table.children.every((row) => row.children.every((cell) => cell.text.length === 0))
}

function touched(table: Node) {
  table.userText = undefined
}

function newRow(doc: MarkdownDocument, table: Node): Node {
  const row = doc.createNode('table_row', { header: false, pipeStart: true, pipeEnd: true })
  for (let i = 0; i < columnCount(table); i++) row.appendChild(doc.createNode('table_cell'))
  return row
}

/** A body row inserted so that it ends up at `index` (never before the header). */
export function insertRow(doc: MarkdownDocument, table: Node, index: number): Node {
  const row = newRow(doc, table)
  const rows = table.children
  const at = Math.max(1, Math.min(index, rows.length))
  if (at >= rows.length) table.appendChild(row)
  else rows[at]!.addBefore(row)
  touched(table)
  return row
}

/** Removes a body row; the header goes only when it is all that is left, which removes the table. */
export function deleteRow(doc: MarkdownDocument, table: Node, index: number): 'row' | 'table' | null {
  const rows = table.children
  const row = rows[index]
  if (!row) return null
  if (row.header && rows.length > 1) return null
  if (rows.length === 1) {
    doc.removeWithEmptyAncestors(table)
    return 'table'
  }
  doc.removeNode(row)
  touched(table)
  return 'row'
}

export function insertColumn(doc: MarkdownDocument, table: Node, index: number) {
  const count = columnCount(table)
  const at = Math.max(0, Math.min(index, count))
  for (const row of table.children) {
    const cells = row.children
    while (cells.length < count) {
      const filler = doc.createNode('table_cell')
      row.appendChild(filler)
      cells.push(filler)
    }
    const cell = doc.createNode('table_cell')
    if (at >= cells.length) row.appendChild(cell)
    else cells[at]!.addBefore(cell)
  }
  const align: Alignment[] = table.align ?? Array.from({ length: count }, () => null)
  align.splice(at, 0, null)
  table.align = align
  touched(table)
}

/** Removes a column; the last column removes the table. */
export function deleteColumn(doc: MarkdownDocument, table: Node, index: number): 'column' | 'table' | null {
  const count = columnCount(table)
  if (index < 0 || index >= count) return null
  if (count === 1) {
    doc.removeWithEmptyAncestors(table)
    return 'table'
  }
  for (const row of table.children) {
    const cell = row.children[index]
    if (cell) doc.removeNode(cell)
  }
  if (table.align) table.align.splice(index, 1)
  touched(table)
  return 'column'
}

/** Moves a body row to another body index. */
export function moveRow(table: Node, from: number, to: number): boolean {
  const rows = table.children
  const row = rows[from]
  const target = rows[to]
  if (!row || !target || row.header || target.header || from === to) return false
  if (to > from) target.addAfter(row)
  else target.addBefore(row)
  touched(table)
  return true
}

export function moveColumn(table: Node, from: number, to: number): boolean {
  const count = columnCount(table)
  if (from < 0 || to < 0 || from >= count || to >= count || from === to) return false
  for (const row of table.children) {
    const cells = row.children
    const cell = cells[from]
    const target = cells[to]
    if (!cell || !target) continue
    if (to > from) target.addAfter(cell)
    else target.addBefore(cell)
  }
  if (table.align) {
    const [align] = table.align.splice(from, 1)
    table.align.splice(to, 0, align ?? null)
  }
  touched(table)
  return true
}

export function setAlignment(table: Node, index: number, align: Alignment) {
  const aligns: Alignment[] = table.align ?? Array.from({ length: columnCount(table) }, () => null)
  while (aligns.length <= index) aligns.push(null)
  aligns[index] = align
  table.align = aligns
  touched(table)
}

/** Empties the cells from `from` to `to` in reading order (DEL-23); partial ends keep their outer text. */
export function clearCells(from: Node, fromOffset: number, to: Node, toOffset: number) {
  const table = from.parent?.parent
  if (!table) return
  let inside = false
  for (const row of table.children) {
    for (const cell of row.children) {
      if (cell === from) {
        inside = true
        cell.text = cell.text.slice(0, fromOffset) + (cell === to ? cell.text.slice(toOffset) : '')
        if (cell === to) return
        continue
      }
      if (cell === to) {
        cell.text = cell.text.slice(toOffset)
        touched(table)
        return
      }
      if (inside) cell.text = ''
    }
  }
  touched(table)
}

/** Every cell of a table from the first through `to` (DEL-23 reaching into a table from before it). */
export function clearCellsUpTo(to: Node, toOffset: number) {
  const first = to.parent?.parent?.firstChild?.firstChild
  if (first) clearCells(first, 0, to, toOffset)
}

/** Every cell of a table from `from` through the last (DEL-23 reaching out of a table). */
export function clearCellsFrom(from: Node, fromOffset: number) {
  const last = from.parent?.parent?.lastChild?.lastChild
  if (last) clearCells(from, fromOffset, last, last.text.length)
}
