import { assert, test } from '#test'
import { columnsOf, rowsOf, schemaOf } from './columns.ts'

test('notion columns - a row’s columns come from JSON, with checkboxes as Notion writes them', () => {
  assert({
    given: 'columns of each kind, a list where an object belongs, a nested value, and text that is not JSON',
    should: 'keep text, numbers, lists and nothing, turn true and false into Notion’s marks, and explain the rest',
    actual: [
      columnsOf('{"Status": "Done", "Points": 3, "Owner": ["u-1"], "Done": true, "Late": false, "Note": null}'),
      columnsOf('["Done"]'),
      columnsOf('{"Status": {"name": "Done"}}'),
      columnsOf('Status: Done'),
    ],
    expected: [
      { Status: 'Done', Points: 3, Owner: ['u-1'], Done: '__YES__', Late: '__NO__', Note: null },
      'The properties must be an object of column name to value, like {"Status": "Done"}.',
      'The properties must be an object of column name to value, like {"Status": "Done"}.',
      'The properties are not JSON: Status: Done',
    ],
  })
})

test('notion columns - rows come as a JSON list, and a bad row is named by its place', () => {
  assert({
    given: 'two rows, one object alone, a list with a bad second row, and text that is not JSON',
    should: 'keep the rows in order and say which one is wrong',
    actual: [
      rowsOf('[{"Name": "Atlas", "date:Due:start": "2026-11-01"}, {"Name": "Beacon"}]'),
      rowsOf('{"Name": "Atlas"}'),
      rowsOf('[{"Name": "Atlas"}, "Beacon"]'),
      rowsOf('Atlas, Beacon'),
    ],
    expected: [
      [{ Name: 'Atlas', 'date:Due:start': '2026-11-01' }, { Name: 'Beacon' }],
      'The rows must be a JSON list with one object per row, like [{"Name": "Atlas", "Status": "Done"}].',
      'Row 2 must be an object of column name to value, like {"Name": "Atlas"}.',
      'The rows are not JSON: Atlas, Beacon',
    ],
  })
})

test('notion columns - the columns become Notion’s CREATE TABLE statement', () => {
  assert({
    given: 'no columns, a column list, one already in parentheses, and a whole statement',
    should: 'give a lone Name column, wrap the list once, and keep a statement as it is',
    actual: [
      schemaOf(undefined),
      schemaOf(`"Task" TITLE, "Status" SELECT('Todo':gray, 'Done':green)`),
      schemaOf(`("Task" TITLE, "Due" DATE)`),
      schemaOf(`CREATE TABLE ("Metric" TITLE)`),
    ],
    expected: [
      'CREATE TABLE ("Name" TITLE)',
      `CREATE TABLE ("Task" TITLE, "Status" SELECT('Todo':gray, 'Done':green))`,
      'CREATE TABLE ("Task" TITLE, "Due" DATE)',
      'CREATE TABLE ("Metric" TITLE)',
    ],
  })
})
