import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { assert, test } from '#test'
import { readParsed } from './parseCorrections.ts'

test('readParsed()', () => {
  assert({
    given: 'fields and a rename',
    should: 'read them as the check applies them',
    actual: readParsed({
      medium: 'Phone',
      durationMinutes: 13,
      rel: ['Sam Rivera', ' Jo '],
      renames: [{ wrong: ['Pria', 'Prya'], right: 'Priya' }],
    }),
    expected: {
      title: undefined,
      time: undefined,
      durationMinutes: 13,
      medium: 'Phone',
      from: undefined,
      to: undefined,
      who: undefined,
      rel: ['Sam Rivera', 'Jo'],
      renames: [{ wrong: ['Pria', 'Prya'], right: 'Priya' }],
    },
  })

  assert({
    given: 'a rename whose wrong side is one string',
    should: 'read it as a list of one',
    actual: readParsed({ renames: [{ wrong: 'Pria', right: 'Priya' }] }).renames,
    expected: [{ wrong: ['Pria'], right: 'Priya' }],
  })

  assert({
    given: 'renames missing a side',
    should: 'drop them',
    actual: readParsed({ renames: [{ wrong: ['Pria'] }, { right: 'Priya' }, { wrong: [], right: 'Priya' }, null] })
      .renames,
    expected: [],
  })

  assert({
    given: 'fields of the wrong shape, and nulls for fields the line left alone',
    should: 'leave those fields unchanged',
    actual: readParsed({ durationMinutes: '13', medium: null, who: 'Sam', title: '  ' }),
    expected: {
      title: undefined,
      time: undefined,
      durationMinutes: undefined,
      medium: undefined,
      from: undefined,
      to: undefined,
      who: undefined,
      rel: undefined,
      renames: [],
    },
  })

  assert({
    given: 'an empty who list',
    should: 'keep it: the line cleared who',
    actual: readParsed({ who: [] }).who,
    expected: [],
  })

  assert({
    given: 'something other than an object',
    should: 'change nothing',
    actual: readParsed(null).renames,
    expected: [],
  })
})

test('transcript-corrections.prompt.md', async () => {
  const content = await readPromptFile(new URL('../prompts/transcript-corrections.prompt.md', import.meta.url).pathname)
  // An explicit me namespace stops the render from reading the real AboutMe profile.
  const { output, warnings } = renderPromptFile(content, 'transcript-corrections.prompt.md', {
    me: {},
    check: {
      title: 'Launch review',
      time: '2026-01-20 14:30',
      duration: '30',
      medium: 'Zoom',
      people: '- who: ["Sam Rivera"]',
      rel: '["Pria"]',
      today: '2026-01-21',
      peopleRules: '- who and rel are arrays of names.',
      writeup: '- Pria shipped the onboarding flow.',
      corrections: "It's not Pria, it's Priya",
    },
  })

  assert({
    given: 'the fields, the write-up and the line',
    should: 'render them all, with nothing left unfilled',
    actual: {
      warnings,
      fields: output.includes('- who: ["Sam Rivera"]\n- rel: ["Pria"]'),
      writeup: output.includes('- Pria shipped the onboarding flow.'),
      line: output.includes("It's not Pria, it's Priya"),
      unfilled: output.includes('{{'),
    },
    expected: { warnings: [], fields: true, writeup: true, line: true, unfilled: false },
  })
})
