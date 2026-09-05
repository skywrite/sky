import { assert, test } from '#test'
import { setAutomationStatus } from './setStatus.ts'

const CHARTER = `---
run: prices:atlas:fetch
# spread across the waking day
at: [07:00, 12:00, 18:00]
status: active
---

# Atlas prices

The body, untouched.
`

test('setAutomationStatus - replaces the status line and nothing else', () => {
  const paused = setAutomationStatus(CHARTER, 'paused')

  assert({
    given: 'a charter with an explicit status',
    should: 'flip only that line — comment, key order and body intact',
    actual: paused,
    expected: CHARTER.replace('status: active', 'status: paused'),
  })
})

test('setAutomationStatus - adds the line when the charter has none', () => {
  const contents = `---
run: day:start
every: 5m
---

Why this runs.
`
  const paused = setAutomationStatus(contents, 'paused')

  assert({
    given: 'a charter with no status line',
    should: 'add one as the last frontmatter line',
    actual: paused,
    expected: `---
run: day:start
every: 5m
status: paused
---

Why this runs.
`,
  })
})

test('setAutomationStatus - flipping there and back is byte-identical', () => {
  const roundTrip = setAutomationStatus(setAutomationStatus(CHARTER, 'paused'), 'active')

  assert({
    given: 'pause then resume',
    should: 'reproduce the original file exactly',
    actual: roundTrip,
    expected: CHARTER,
  })
})

test('setAutomationStatus - indented and spaced status lines still count', () => {
  const contents = `---
run: x:y
every: 1h
status : paused
---
`
  assert({
    given: 'a status line with a space before the colon',
    should: 'replace it rather than adding a second',
    actual: setAutomationStatus(contents, 'active'),
    expected: `---
run: x:y
every: 1h
status: active
---
`,
  })
})

test('setAutomationStatus - a file without frontmatter is refused', () => {
  let message = ''
  try {
    setAutomationStatus('Just prose.\n', 'paused')
  } catch (err) {
    message = err instanceof Error ? err.message : String(err)
  }

  assert({
    given: 'contents with no frontmatter block',
    should: 'throw with a message naming the problem',
    actual: message.includes('frontmatter'),
    expected: true,
  })
})
