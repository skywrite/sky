import PeopleStore from '#shared/models/Store/PeopleStore/mod.ts'
import { assert, test } from '#test'
import { createNameResolver } from './nameResolver.ts'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function buildStore(): Promise<PeopleStore> {
  const store = await PeopleStore.build([])
  store.set(
    '/people/bo/Bob-Smith.md',
    `---
name:
  - Bob Smith
  - Bob
---

# Bob Smith
`,
  )
  store.set(
    '/people/ja/James-Walker.md',
    `---
name: James Walker
---

# James Walker
`,
  )
  store.set(
    '/people/ja/James-Oldman.md',
    `---
name: James Oldman
---

# James Oldman
`,
  )
  store.set(
    '/people/da/Daniel-Craig.md',
    `---
name: Daniel Craig
---

# Daniel Craig
`,
  )
  store.set(
    '/people/ja/Jane-Doe.md',
    `---
name: Jane Doe
alt: corp/jane
---

# Jane Doe
`,
  )
  return store
}

function scoresFrom(table: Record<string, number>): (name: string) => number {
  return (name) => table[name] ?? 0
}

// ---------------------------------------------------------------------------
// Exact alias hits (legacy behavior preserved)
// ---------------------------------------------------------------------------

test('createNameResolver - exact alias hit expands to all names', async () => {
  const resolve = createNameResolver(await buildStore())
  const result = resolve('Bob')

  assert({
    given: 'a registered alias',
    should: 'include the canonical name',
    actual: result.includes('Bob Smith'),
    expected: true,
  })

  assert({
    given: 'a registered alias',
    should: 'include the alias itself',
    actual: result.includes('Bob'),
    expected: true,
  })
})

test('createNameResolver - unknown name with no candidates passes through', async () => {
  const resolve = createNameResolver(await buildStore())

  assert({
    given: 'a name matching nobody',
    should: 'return just the raw name',
    actual: resolve('Zorp'),
    expected: ['Zorp'],
  })
})

// ---------------------------------------------------------------------------
// Token-match fallback
// ---------------------------------------------------------------------------

test('createNameResolver - single token candidate resolves without scores', async () => {
  const resolve = createNameResolver(await buildStore())
  const result = resolve('Doe')

  assert({
    given: 'a last-name token matching exactly one person',
    should: 'include their canonical name',
    actual: result.includes('Jane Doe'),
    expected: true,
  })

  assert({
    given: 'a resolved person with an alt handle',
    should: 'include the alt handle',
    actual: result.includes('corp/jane'),
    expected: true,
  })

  assert({
    given: 'a fallback resolution',
    should: 'keep the raw queried name so matching never narrows',
    actual: result.includes('Doe'),
    expected: true,
  })
})

test('createNameResolver - clear score winner resolves alone', async () => {
  const resolve = createNameResolver(await buildStore(), {
    scoreFor: scoresFrom({ 'James Walker': 480, 'James Oldman': 20 }),
  })
  const result = resolve('James')

  assert({
    given: 'a first name shared by two people with a 24x score gap',
    should: 'include the high-scored person',
    actual: result.includes('James Walker'),
    expected: true,
  })

  assert({
    given: 'a first name shared by two people with a 24x score gap',
    should: 'exclude the low-scored person',
    actual: result.includes('James Oldman'),
    expected: false,
  })

  assert({
    given: 'a fallback resolution',
    should: 'keep the raw queried name',
    actual: result.includes('James'),
    expected: true,
  })
})

test('createNameResolver - close scores union the top two', async () => {
  const resolve = createNameResolver(await buildStore(), {
    scoreFor: scoresFrom({ 'James Walker': 100, 'James Oldman': 50 }),
  })
  const result = resolve('James')

  assert({
    given: 'two candidates within the 3x margin',
    should: 'include the first',
    actual: result.includes('James Walker'),
    expected: true,
  })

  assert({
    given: 'two candidates within the 3x margin',
    should: 'include the second',
    actual: result.includes('James Oldman'),
    expected: true,
  })
})

test('createNameResolver - ambiguous without scores passes through', async () => {
  const resolve = createNameResolver(await buildStore())

  assert({
    given: 'multiple candidates and no score signal',
    should: 'return just the raw name (legacy behavior)',
    actual: resolve('James'),
    expected: ['James'],
  })
})

test('createNameResolver - all-zero scores pass through', async () => {
  const resolve = createNameResolver(await buildStore(), { scoreFor: () => 0 })

  assert({
    given: 'multiple candidates that nobody has interacted with',
    should: 'return just the raw name',
    actual: resolve('James'),
    expected: ['James'],
  })
})

// ---------------------------------------------------------------------------
// Prefix and multi-word matching
// ---------------------------------------------------------------------------

test('createNameResolver - token prefix matches for 3+ char queries', async () => {
  const resolve = createNameResolver(await buildStore())
  const result = resolve('Dani')

  assert({
    given: 'a 4-char prefix of a first name',
    should: 'resolve to that person',
    actual: result.includes('Daniel Craig'),
    expected: true,
  })
})

test('createNameResolver - short queries do not prefix-match', async () => {
  const resolve = createNameResolver(await buildStore())

  assert({
    given: 'a 2-char query',
    should: 'not prefix-match anyone',
    actual: resolve('Da'),
    expected: ['Da'],
  })
})

test('createNameResolver - multi-word query prefix-matches the full name', async () => {
  const resolve = createNameResolver(await buildStore())
  const result = resolve('Jane D')

  assert({
    given: 'a first name plus last initial',
    should: 'resolve to the matching person',
    actual: result.includes('Jane Doe'),
    expected: true,
  })
})

// ---------------------------------------------------------------------------
// Memoization
// ---------------------------------------------------------------------------

test('createNameResolver - fallback resolutions are memoized', async () => {
  let calls = 0
  const resolve = createNameResolver(await buildStore(), {
    scoreFor: (name) => {
      calls++
      return name === 'James Walker' ? 480 : 0
    },
  })

  resolve('James')
  const callsAfterFirst = calls
  resolve('James')

  assert({
    given: 'the same unresolved name twice',
    should: 'not re-rank on the second call',
    actual: calls,
    expected: callsAfterFirst,
  })
})
