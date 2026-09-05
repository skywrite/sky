import { assert, test } from '#test'
import { formatDuration, formatTiming, timingLines } from './timing.ts'

test('mission timing formatting', async (t) => {
  await t.step('reads as one line and as a record block', () => {
    const timing = {
      profile: 'default-opus-5',
      steps: 28,
      wallMs: 182_000,
      modelMs: 40_000,
      toolMs: 140_000,
      tools: { inspect_doc_visually: { count: 3, ms: 58_000 }, batch_update_doc: { count: 17, ms: 45_000 } },
    }
    assert({
      given: 'a summarized mission',
      should: 'say what ran, how long, and where the time went',
      actual: formatTiming(timing),
      expected:
        '28 steps in 3m02s on default-opus-5 — model 40s, tools 2m20s: inspect_doc_visually 3× 58s, batch_update_doc 17× 45s',
    })
    assert({
      given: 'the same mission',
      should: 'list the block the notebook record carries',
      actual: timingLines(timing),
      expected: [
        '- steps: 28',
        '- wall: 3m02s',
        '- model: 40s',
        '- tools: 2m20s',
        '  - inspect_doc_visually: 3× 58s',
        '  - batch_update_doc: 17× 45s',
      ],
    })
  })
})

test('formatDuration', () => {
  assert({
    given: 'durations across the scale',
    should: 'read at a glance',
    actual: [formatDuration(800), formatDuration(9_950), formatDuration(48_000), formatDuration(182_000)],
    expected: ['0.8s', '9.9s', '48s', '3m02s'],
  })
})
