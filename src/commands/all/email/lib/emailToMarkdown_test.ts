import { assert, test } from '#test'
import { capPriorMessages, chunkBody, stitchContinuation } from './emailToMarkdown.ts'

test('capPriorMessages keeps everything under the cap', () => {
  assert({
    given: 'priors that fit',
    should: 'return them unchanged, in order',
    expected: 'a, b, c',
    actual: capPriorMessages(['a', 'b', 'c'], 100).join(', '),
  })
})

test('capPriorMessages sheds the oldest priors first', () => {
  const oldest = 'x'.repeat(60)
  const middle = 'y'.repeat(60)
  const newest = 'z'.repeat(60)

  const kept = capPriorMessages([oldest, middle, newest], 130)

  assert({
    given: 'a prior block over the cap',
    should: 'keep the newest messages — they are what a reply quotes — in chronological order',
    expected: `${middle.slice(0, 3)}…, ${newest.slice(0, 3)}…`,
    actual: kept.map((p) => `${p.slice(0, 3)}…`).join(', '),
  })
})

test('capPriorMessages never drops the newest prior, however large', () => {
  const huge = 'q'.repeat(500)

  assert({
    given: 'a single prior larger than the whole cap',
    should: 'keep it — the immediately previous message is the one dedup cannot do without',
    expected: 1,
    actual: capPriorMessages(['old', huge], 100).length,
  })
})

test('chunkBody leaves a body that fits as one window', () => {
  assert({
    given: 'a body under the window size',
    should: 'convert it in a single pass',
    expected: 1,
    actual: chunkBody('short body\nsecond line', 1000).length,
  })
})

test('chunkBody loses nothing when it splits', () => {
  const body = Array.from({ length: 400 }, (_, i) => `line ${i} of the forwarded chain`).join('\n')

  assert({
    given: 'a body cut into several windows',
    should: 'reassemble to the original exactly — a split may never drop a character',
    expected: body,
    actual: chunkBody(body, 500).join(''),
  })
})

test('chunkBody cuts only at line boundaries', () => {
  const body = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')
  const windows = chunkBody(body, 300)

  assert({
    given: 'windows of a multi-line body',
    should: 'end each but the last with a newline, so no line is split in half',
    expected: true,
    actual: windows.slice(0, -1).every((w) => w.endsWith('\n')),
  })
})

test('chunkBody makes progress on a line longer than the window', () => {
  const body = `${'x'.repeat(900)}\nshort tail`
  const windows = chunkBody(body, 300)

  assert({
    given: 'a single line larger than the whole window',
    should: 'cut it rather than hang, still losing nothing',
    expected: body,
    actual: windows.join(''),
  })
})

test('stitchContinuation appends a clean continuation untouched', () => {
  assert({
    given: 'a continuation that starts with genuinely new text',
    should: 'concatenate as-is',
    expected: 'The agreement covers the first tranche and the second tranche.',
    actual: stitchContinuation('The agreement covers the first tranche ', 'and the second tranche.'),
  })
})

test('stitchContinuation strips a re-spoken tail', () => {
  assert({
    given: 'a model that restarted from a little before its stop point',
    should: 'drop the overlap so nothing appears twice',
    expected: 'The effective date will be the date of the final signature on the agreement.',
    actual: stitchContinuation(
      'The effective date will be the date of the final',
      'the date of the final signature on the agreement.',
    ),
  })
})

test('stitchContinuation ignores trivially short overlaps', () => {
  assert({
    given: 'a continuation that merely happens to start with the same short word',
    should: 'not treat coincidence as repetition',
    expected: 'Payment is due on the 15th. the terms remain unchanged.',
    actual: stitchContinuation('Payment is due on the 15th. ', 'the terms remain unchanged.'),
  })
})
