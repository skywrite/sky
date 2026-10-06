import type { ModelMessage } from 'ai'
import { assert, test } from '#test'
import { timeStampLine } from './mod.ts'
import { NOTEBOOK_ADDITION, WorkingContext } from './workingContext.ts'

const source = `${NOTEBOOK_ADDITION}\n\n${'Synthetic source text. '.repeat(200)}`

test('retrieval compaction never removes a user’s matching quotation or changes the original source', () => {
  const working = new WorkingContext()
  working.register(source, ['/mock/Atlas.md'], 0)
  const message = `${source}\n\nKeep my instructions verbatim.`
  const before = working.prepare(message, 0)
  const reduced = working.compact(message, 0)
  const compacted = working.prepare(message, 0)
  assert({
    given: 'a recorded retrieval prefix and the same text quoted by a later user',
    should: 'compact only the recorded prefix, retaining source links and every user word',
    actual: [
      before === message,
      reduced > 0,
      compacted.includes('/mock/Atlas.md'),
      compacted.endsWith('Keep my instructions verbatim.'),
      working.prepare(message, 1) === message,
      working.prepare(message.replace('Synthetic', 'Edited'), 0).includes('Edited'),
    ],
    expected: [true, true, true, true, true, true],
  })
})

test('legacy retrieval migration requires the real user suffix and recorded source provenance', () => {
  const when = '2026-01-27 25:30'
  const user = { role: 'user' as const, content: 'Check the statement.', when }
  const suffix = `${timeStampLine(when)}\n${user.content}`
  const messages: ModelMessage[] = [{ role: 'user', content: `${source}\n\n${suffix}` }]
  const log = [{ turn: 1, queries: [], added: [{ path: 'Atlas.md', tokens: 100 }] }]
  const working = new WorkingContext()
  working.adoptLegacy(messages, [user], log, (file) => `/mock/${file}`, timeStampLine)
  working.compact(messages[0].content as string, 0)
  const restored = new WorkingContext(working.state)
  const noProvenance = new WorkingContext()
  noProvenance.adoptLegacy(messages, [user], [], (file) => file, timeStampLine)
  const differentUser = new WorkingContext()
  differentUser.adoptLegacy(messages, [{ ...user, content: 'Different question.' }], log, (file) => file, timeStampLine)
  assert({
    given: 'a pre-upgrade combined source/user message and a saved working-context checkpoint',
    should: 'recover the source boundary with exact timestamps and keep compaction stable through restart',
    actual: [
      restored.compactedSources,
      restored.prepare(messages[0].content as string, 0).endsWith(suffix),
      noProvenance.state.sources.length,
      differentUser.state.sources.length,
    ],
    expected: [1, true, 0, 0],
  })
})

test('a branch cannot inherit source references or result excerpts from later turns', () => {
  const working = new WorkingContext()
  working.register(source, ['/mock/Atlas.md'], 0)
  working.register(source, ['/mock/Later.md'], 1)
  working.compact(source, 0)
  working.state.toolExcerpts = { earlier: 'Earlier receipt.', later: 'Later receipt.' }
  working.state.deferredAttachments = ['user:0:1', 'user:1:1', 'tool:earlier:0', 'tool:later:0']
  const branch = working.snapshot([
    { role: 'user', content: `${source}\n\nCheck Atlas.` },
    {
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 'earlier', toolName: 'read', output: { type: 'text', value: 'OK' } },
      ],
    },
  ])
  branch.sources[0].paths.push('/mock/Branch.md')
  assert({
    given: 'a branch before a later source and tool result were seen',
    should: 'copy only its inherited context and keep branch changes isolated',
    actual: [
      branch.sources.length,
      Object.keys(branch.toolExcerpts),
      working.state.sources[0].paths,
      branch.deferredAttachments,
    ],
    expected: [1, ['earlier'], ['/mock/Atlas.md'], ['user:0:1', 'tool:earlier:0']],
  })
})
