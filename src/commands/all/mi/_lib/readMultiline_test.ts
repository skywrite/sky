import { spawnSync } from 'node:child_process'
import { assert, test } from '#test'

const reader = new URL('./readMultiline.ts', import.meta.url).href

function readAnswer(input: string): string | null {
  const child = spawnSync(
    process.execPath,
    [
      '--eval',
      String.raw`import { readMultiline } from ${JSON.stringify(reader)};
       const answer = await readMultiline('Describe the outcome');
       process.stdout.write('\nANSWER:' + JSON.stringify(answer));`,
    ],
    { input, encoding: 'utf8', timeout: 5000 },
  )
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(child.stderr || `Reader exited with ${child.status}`)
  const marker = '\nANSWER:'
  const start = child.stdout.lastIndexOf(marker)
  if (start < 0) throw new Error('Reader did not return an answer')
  return JSON.parse(child.stdout.slice(start + marker.length)) as string | null
}

for (const { given, input, expected } of [
  { given: 'three Enter presses after text', input: 'Review Atlas\r\r\rIgnored\r', expected: 'Review Atlas' },
  {
    given: 'paragraph breaks separated by more text',
    input: 'First paragraph\r\rSecond paragraph\r\rThird paragraph\r\r\r',
    expected: 'First paragraph\n\nSecond paragraph\n\nThird paragraph',
  },
  { given: 'whitespace-only empty lines', input: 'Review Atlas\r \r\t\r', expected: 'Review Atlas' },
  { given: 'a period on its own line', input: 'First\r.\rLast\r\r\r', expected: 'First\n.\nLast' },
  {
    given: 'a bracketed paste containing multiple blank lines',
    input: '\x1b[200~First\n\n\nLast\x1b[201~\r\r\r',
    expected: 'First\n\n\nLast',
  },
  { given: 'empty input submitted like CLI chat', input: '\r\r', expected: '' },
  { given: 'Ctrl+D after a completed line', input: 'Review Atlas\r\x04', expected: 'Review Atlas' },
  { given: 'Ctrl+C after typing', input: 'Review Atlas\x03', expected: null },
]) {
  test(`multiline answer: ${given}`, () => {
    assert({ given, should: 'return the complete answer or cancellation', actual: readAnswer(input), expected })
  })
}
