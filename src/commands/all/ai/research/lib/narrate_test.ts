import { assert, test } from '#test'
import { describeCall } from './narrate.ts'

test({ name: 'research narration - a query call prints the query pretty, under the name' }, () => {
  assert({
    given: 'a notebook_query call with a one-line query',
    should: 'name the call and print the query as graphql-js does, indented beneath',
    actual: describeCall('notebook_query', {
      graphql: '{ documents(where: {bodyContains: "Atlas", dateGte: "2026-07-01"}) { path markdown } }',
    }),
    expected: [
      '→ notebook_query',
      '  {',
      '    documents(where: {bodyContains: "Atlas", dateGte: "2026-07-01"}) {',
      '      path',
      '      markdown',
      '    }',
      '  }',
    ].join('\n'),
  })
})

test({ name: 'research narration - a query that does not parse is shown as written' }, () => {
  assert({
    given: 'a query with a syntax error',
    should: 'print it unchanged rather than nothing',
    actual: describeCall('notebook_query', { graphql: '{ documents(where: { path }' }),
    expected: '→ notebook_query\n  { documents(where: { path }',
  })
})

test({ name: 'research narration - a single field goes inline after the name' }, () => {
  assert({
    given: 'a read and a lookup',
    should: 'print the path and the name whole on the line',
    actual: [
      describeCall('notebook_read', {
        path: 'time/2026/W27/07-01/actions/meetings/10-00_Zoom_Jane-Doe_Atlas-Roadmap.md',
      }),
      describeCall('person_lookup', { name: 'Jane Doe' }),
    ],
    expected: [
      '→ notebook_read time/2026/W27/07-01/actions/meetings/10-00_Zoom_Jane-Doe_Atlas-Roadmap.md',
      '→ person_lookup Jane Doe',
    ],
  })
})

test({ name: 'research narration - several fields are named, and no input is just the name' }, () => {
  assert({
    given: 'two fields, one of them a number',
    should: 'list them by name on the line',
    actual: describeCall('some_tool', { name: 'Jane', limit: 3 }),
    expected: '→ some_tool name: Jane, limit: 3',
  })
  assert({
    given: 'no input at all',
    should: 'print the name alone',
    actual: describeCall('some_tool', undefined),
    expected: '→ some_tool',
  })
})
