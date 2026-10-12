import { assert, test } from '#test'
import { toolDisplayName } from '#universal/ai/toolDisplay.ts'
import { compactLine, dedent, graphqlTokens, parseToolLine } from './toolLines.ts'

const PRETTY = [
  '→ notebook_query',
  '  {',
  '    documents(where: {bodyContains: "Atlas"}) {',
  '      path',
  '    }',
  '  }',
].join('\n')

test({ name: 'tool lines - a call with its query under the name reads as a query card' }, () => {
  assert({
    given: 'the arrow, a tool name, and a pretty-printed query indented beneath',
    should: 'name the call and carry the query dedented, as GraphQL, whole',
    actual: parseToolLine(PRETTY),
    expected: {
      kind: 'call',
      tool: 'notebook_query',
      detail: '{\n  documents(where: {bodyContains: "Atlas"}) {\n    path\n  }\n}',
      graphql: true,
      cut: false,
    },
  })
})

test({ name: 'tool lines - an older record cut mid-query is read as far as it goes' }, () => {
  assert({
    given: 'the call printed as JSON and cut inside the escaped query',
    should: 'unescape the query it kept and mark the record cut',
    actual: parseToolLine(
      '  → notebook_query {"graphql":"{ documents(where: {bodyContains: \\"Atlas\\", dateGte: \\"2026',
    ),
    expected: {
      kind: 'call',
      tool: 'notebook_query',
      detail: '{ documents(where: {bodyContains: "Atlas", dateGte: "2026',
      graphql: true,
      cut: true,
    },
  })
  assert({
    given: 'a record cut right after a backslash',
    should: 'drop the orphan escape rather than fail',
    actual: parseToolLine('→ notebook_query {"graphql":"{ documents(where: {bodyContains: \\'),
    expected: {
      kind: 'call',
      tool: 'notebook_query',
      detail: '{ documents(where: {bodyContains: ',
      graphql: true,
      cut: true,
    },
  })
})

test({ name: 'tool lines - a whole JSON record shows its one field as the detail' }, () => {
  assert({
    given: 'a read printed as complete JSON',
    should: 'carry the path alone, not as a query, not cut',
    actual: parseToolLine('→ notebook_read {"path":"projects/atlas.md"}'),
    expected: { kind: 'call', tool: 'notebook_read', detail: 'projects/atlas.md', graphql: false, cut: false },
  })
  assert({
    given: 'a record with two fields',
    should: 'list them by name',
    actual:
      parseToolLine('→ some_tool {"name":"Jane Doe","limit":3}').kind === 'call' &&
      (parseToolLine('→ some_tool {"name":"Jane Doe","limit":3}') as { detail: string }).detail,
    expected: 'name: Jane Doe\nlimit: 3',
  })
})

test({ name: 'tool lines - a call with its detail inline, or with the name alone' }, () => {
  assert({
    given: 'a lookup with the name on the same line',
    should: 'carry the name as plain detail',
    actual: parseToolLine('→ person_lookup Jane Doe'),
    expected: { kind: 'call', tool: 'person_lookup', detail: 'Jane Doe', graphql: false, cut: false },
  })
  assert({
    given: 'the arrow and a tool name only',
    should: 'have no detail',
    actual: parseToolLine('→ notebook_query'),
    expected: { kind: 'call', tool: 'notebook_query', detail: null, graphql: false, cut: false },
  })
})

test({ name: 'tool lines - anything else is what the tool said' }, () => {
  assert({
    given: 'a progress line, indented, with an arrow inside it',
    should: 'be the words as said, trimmed',
    actual: parseToolLine('  Recapped 3 repos → recap.md'),
    expected: { kind: 'said', text: 'Recapped 3 repos → recap.md' },
  })
})

test({ name: 'tool lines - one line for a chip' }, () => {
  assert({
    given: 'a call with a pretty-printed query',
    should: 'read as the tool and the query on one line',
    actual: compactLine(PRETTY),
    expected: 'Notebook Query · { documents(where: {bodyContains: "Atlas"}) { path } }',
  })
  const long = compactLine(`Read ${'x'.repeat(200)}`)
  assert({
    given: 'a line longer than a chip wants',
    should: 'cut it with an ellipsis',
    actual: [long.length, long.endsWith('…')],
    expected: [140, true],
  })
})

test({ name: 'tool lines - dedent takes the common indent off' }, () => {
  assert({
    given: 'lines indented by four and six, with a blank one',
    should: 'leave them indented by zero and two',
    actual: dedent('    a\n\n      b\n    c'),
    expected: 'a\n\n  b\nc',
  })
})

test({ name: 'tool lines - query tokens color names, arguments, strings, and numbers' }, () => {
  const code = 'documents(where: {bodyContains: "Atlas", limit: 3, open: true}) { path }'
  const tokens = graphqlTokens(code)
  assert({
    given: 'a query with arguments and a selection',
    should: 'join back to the text exactly',
    actual: tokens.map((token) => token.text).join(''),
    expected: code,
  })
  const typeOf = (text: string) => tokens.find((token) => token.text === text)?.type
  assert({
    given: 'its tokens',
    should: 'tell fields from arguments, strings, literals, and punctuation',
    actual: [
      typeOf('documents'),
      typeOf('where'),
      typeOf('bodyContains'),
      typeOf('"Atlas"'),
      typeOf('3'),
      typeOf('true'),
      typeOf('path'),
      typeOf('('),
    ],
    expected: ['name', 'arg', 'arg', 'string', 'number', 'number', 'name', 'punct'],
  })
})

test({ name: 'tool lines - shared names identify agents and keep acronyms' }, () => {
  assert({
    given: 'the writer, named agents, and tools without presentation metadata',
    should: 'use the agent name or a capitalized fallback, preserving acronyms',
    actual: ['me_voice', 'ai_research', 'google_agent', 'web_search', 'custom_agent'].map(toolDisplayName),
    expected: ['Ghostwriter', 'AI Research', 'Google Agent', 'Web Search', 'Custom Agent'],
  })
})
