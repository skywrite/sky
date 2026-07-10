import { assert, test } from '#test'
import type { ModelMessage } from 'ai'
import { cachedInstructions, PROMPT_CACHE_BOUNDARY, withCacheTail } from './promptCache.ts'

const breakpoint = { anthropic: { cacheControl: { type: 'ephemeral' } } }

test('cachedInstructions caches a whole prompt without a boundary marker', () => {
  const messages = cachedInstructions('You are a helpful assistant.')
  assert({
    given: 'a rendered prompt with no boundary marker',
    should: 'produce a single system message with a cache breakpoint',
    actual: messages,
    expected: [{ role: 'system', content: 'You are a helpful assistant.', providerOptions: breakpoint }],
  })
})

test('cachedInstructions splits stable prefix from volatile tail at the marker', () => {
  const rendered = `Instructions and schema here.\n\n${PROMPT_CACHE_BOUNDARY}\n\nNotebook date: 2026-07-10 14:30`
  const messages = cachedInstructions(rendered)
  assert({
    given: 'a rendered prompt with a boundary marker',
    should: 'cache the stable prefix and leave the tail uncached',
    actual: messages,
    expected: [
      { role: 'system', content: 'Instructions and schema here.', providerOptions: breakpoint },
      { role: 'system', content: 'Notebook date: 2026-07-10 14:30' },
    ],
  })
})

test('cachedInstructions with an empty tail after the marker emits no tail message', () => {
  const messages = cachedInstructions(`Stable only.\n\n${PROMPT_CACHE_BOUNDARY}\n`)
  assert({
    given: 'a marker followed by only whitespace',
    should: 'produce just the cached stable message',
    actual: messages,
    expected: [{ role: 'system', content: 'Stable only.', providerOptions: breakpoint }],
  })
})

test('cachedInstructions caches each non-empty segment of an array input', () => {
  const messages = cachedInstructions(['Base prompt.', '', 'Context block.'])
  assert({
    given: 'segments with an empty entry',
    should: 'emit one cached message per non-empty segment',
    actual: messages,
    expected: [
      { role: 'system', content: 'Base prompt.', providerOptions: breakpoint },
      { role: 'system', content: 'Context block.', providerOptions: breakpoint },
    ],
  })
})

test('withCacheTail marks only the final message', () => {
  const messages: ModelMessage[] = [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'second' },
  ]
  const marked = withCacheTail(messages)
  assert({
    given: 'a conversation',
    should: 'add a breakpoint to the last message',
    actual: marked[2].providerOptions,
    expected: breakpoint,
  })
  assert({
    given: 'a conversation',
    should: 'leave earlier messages unmarked',
    actual: [marked[0].providerOptions, marked[1].providerOptions],
    expected: [undefined, undefined],
  })
  assert({
    given: 'the input array',
    should: 'not be mutated',
    actual: messages[2].providerOptions,
    expected: undefined,
  })
})

test('withCacheTail moves a stale tail breakpoint to the new last message', () => {
  const afterTurnOne = withCacheTail([{ role: 'user', content: 'first' } as ModelMessage])
  const grown = [...afterTurnOne, { role: 'assistant', content: 'reply' } as ModelMessage, {
    role: 'user',
    content: 'second',
  } as ModelMessage]
  const marked = withCacheTail(grown)
  assert({
    given: 'a conversation whose earlier tail was marked last turn',
    should: 'strip the old breakpoint',
    actual: marked[0].providerOptions,
    expected: undefined,
  })
  assert({
    given: 'a conversation whose earlier tail was marked last turn',
    should: 'mark the new last message',
    actual: marked[2].providerOptions,
    expected: breakpoint,
  })
})

test('withCacheTail preserves unrelated provider options while moving the breakpoint', () => {
  const messages: ModelMessage[] = [
    {
      role: 'assistant',
      content: 'thinking-carrier',
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' }, signature: 'abc' } },
    },
    { role: 'user', content: 'next' },
  ]
  const marked = withCacheTail(messages)
  assert({
    given: 'an earlier message carrying other anthropic metadata plus a stale breakpoint',
    should: 'keep the metadata and drop only the breakpoint',
    actual: marked[0].providerOptions,
    expected: { anthropic: { signature: 'abc' } },
  })
})
