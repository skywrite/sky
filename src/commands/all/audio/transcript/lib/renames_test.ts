import type { PersonIndexEntry } from '#shared/models/Person/subjects.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { assert, test } from '#test'
import {
  applyRenames,
  composeRenames,
  foundRenames,
  plausibleRewrite,
  profileNameFor,
  renameNames,
  renameRulings,
  renamesText,
} from './renames.ts'
import type { ReviewCorrection } from './transcriptRun.ts'

const person = (name: string, ...aliases: string[]): PersonIndexEntry => ({
  name,
  names: [name, ...aliases],
  path: `people/${name.replace(/ /g, '-')}.md`,
})

const INDEX: PersonIndexEntry[] = [person('Priya Raman'), person('Sam Rivera'), person('Jo Chen')]

const WRITEUP = [
  '## Background',
  '- Pria (also transcribed as "Prya") shipped the onboarding flow.',
  '- Sam and Pria paired on the launch.',
].join('\n')

test('foundRenames()', () => {
  assert({
    given: 'a rename whose spellings are both in the write-up',
    should: 'keep both',
    actual: foundRenames([{ wrong: ['Pria', 'Prya'], right: 'Priya' }], [WRITEUP]),
    expected: [{ wrong: ['Pria', 'Prya'], right: 'Priya' }],
  })

  assert({
    given: 'a spelling neither text holds',
    should: 'drop it, and drop a rename left with nothing to replace',
    actual: foundRenames(
      [
        { wrong: ['Pria', 'Preeya'], right: 'Priya' },
        { wrong: ['Samm'], right: 'Sam' },
      ],
      ['no names here', WRITEUP],
    ),
    expected: [{ wrong: ['Pria'], right: 'Priya' }],
  })

  assert({
    given: 'a spelling inside the right spelling',
    should: 'drop it, since every replace would double it',
    actual: foundRenames([{ wrong: ['Pria', 'Raman'], right: 'Priya Raman' }], ['Pria Raman spoke']),
    expected: [{ wrong: ['Pria'], right: 'Priya Raman' }],
  })

  assert({
    given: 'a fix of case only',
    should: 'keep it',
    actual: foundRenames([{ wrong: ['atlas'], right: 'Atlas' }], ['the atlas launch']),
    expected: [{ wrong: ['atlas'], right: 'Atlas' }],
  })

  assert({
    given: 'a spelling too short to replace safely, a repeat, and an empty right side',
    should: 'drop them',
    actual: foundRenames(
      [
        { wrong: ['Jo', 'Pria', 'pria'], right: 'Priya' },
        { wrong: ['Sam'], right: ' ' },
      ],
      [WRITEUP],
    ),
    expected: [{ wrong: ['Pria'], right: 'Priya' }],
  })
})

test('applyRenames()', () => {
  assert({
    given: 'a rename with two spellings',
    should: 'replace each whole word, possessives included',
    actual: applyRenames("Pria said so. Prya's plan. Priam stays.", [{ wrong: ['Pria', 'Prya'], right: 'Priya' }]),
    expected: "Priya said so. Priya's plan. Priam stays.",
  })

  assert({
    given: 'a later rename of an earlier right spelling',
    should: 'apply them in order',
    actual: applyRenames('Pria ran.', [
      { wrong: ['Pria'], right: 'Priya' },
      { wrong: ['Priya'], right: 'Priyah' },
    ]),
    expected: 'Priyah ran.',
  })
})

test('profileNameFor()', () => {
  assert({
    given: 'a single name exactly one profile answers to',
    should: "return the profile's full name",
    actual: profileNameFor('Priya', INDEX),
    expected: 'Priya Raman',
  })

  assert({
    given: 'a single name two profiles answer to',
    should: 'leave it as spelled',
    actual: profileNameFor('Priya', [...INDEX, person('Priya Shah')]),
    expected: 'Priya',
  })

  assert({
    given: 'a full name, or no people index',
    should: 'leave it as spelled',
    actual: [profileNameFor('Priya Kay', INDEX), profileNameFor('Priya', null)],
    expected: ['Priya Kay', 'Priya'],
  })
})

test('renameNames()', () => {
  const rename = { wrong: ['Pria', 'Prya'], right: 'Priya' }

  assert({
    given: 'a list holding a wrong spelling',
    should: 'give it the full name of the one profile that answers to the right one, and leave the rest',
    actual: renameNames(['Pria', 'Sam Rivera'], [rename], INDEX),
    expected: ['Priya Raman', 'Sam Rivera'],
  })

  assert({
    given: 'a list already holding the right spelling, bare',
    should: 'link it to the profile too',
    actual: renameNames(['Sam Rivera', 'Priya'], [rename], INDEX),
    expected: ['Sam Rivera', 'Priya Raman'],
  })

  assert({
    given: 'a full name holding the wrong spelling',
    should: 'fix the spelling inside it',
    actual: renameNames(['Pria Kay'], [rename], INDEX),
    expected: ['Priya Kay'],
  })

  assert({
    given: 'a rename that makes two entries the same',
    should: 'keep the first',
    actual: renameNames(['Pria', 'Priya Raman', 'Prya'], [rename], INDEX),
    expected: ['Priya Raman'],
  })

  assert({
    given: 'no people index',
    should: 'still fix the spelling',
    actual: renameNames(['Pria'], [rename], null),
    expected: ['Priya'],
  })
})

test('composeRenames()', () => {
  assert({
    given: 'a second rename that calls the first one’s right spelling wrong',
    should: 'point the first rename’s spellings at the second right one',
    actual: composeRenames([
      { wrong: ['Pria', 'Prya'], right: 'Priya' },
      { wrong: ['Priya'], right: 'Priyah' },
    ]),
    expected: [
      { wrong: ['Pria', 'Prya'], right: 'Priyah' },
      { wrong: ['Priya'], right: 'Priyah' },
    ],
  })
})

test('renameRulings()', () => {
  const answer = (originalText: string, correction: string, action: ReviewCorrection['action']): ReviewCorrection => ({
    issueIndex: 0,
    originalText,
    correction,
    occurrences: 1,
    action,
  })

  assert({
    given: 'a rename',
    should: 'rule every wrong spelling to the right one',
    actual: renameRulings([{ wrong: ['Pria', 'Prya'], right: 'Priya' }], []),
    expected: [
      { wrong: 'Pria', right: 'Priya' },
      { wrong: 'Prya', right: 'Priya' },
    ],
  })

  assert({
    given: 'a review answer this run that turned a word into a spelling now called wrong',
    should: 'rule the word the transcriber wrote to the right spelling, and ignore skipped answers',
    actual: renameRulings(
      [{ wrong: ['Prya'], right: 'Priya' }],
      [answer('Preet', 'Prya', 'accept'), answer('Prya', 'Prya', 'skip'), answer('Atlus', 'Atlas', 'accept')],
    ),
    expected: [
      { wrong: 'Prya', right: 'Priya' },
      { wrong: 'Preet', right: 'Priya' },
    ],
  })

  assert({
    given: 'a rename of ordinary words',
    should: 'make no ruling, by the glossary’s own gate',
    actual: renameRulings([{ wrong: ['the plan'], right: 'the plans' }], []),
    expected: [],
  })
})

test('renamesText()', () => {
  assert({
    given: 'renames, one of them to a name a profile answers to',
    should: 'list each, with the full name where there is one',
    actual: renamesText(
      [
        { wrong: ['Pria', 'Prya'], right: 'Priya' },
        { wrong: ['Atlus'], right: 'Atlas' },
      ],
      INDEX,
    ),
    expected: `- "Pria", "Prya" → "Priya" (the notebook's Priya Raman)\n- "Atlus" → "Atlas"`,
  })
})

test('plausibleRewrite()', () => {
  assert({
    given: 'a rewrite about as long as the write-up, with its sections',
    should: 'pass',
    actual: plausibleRewrite(WRITEUP.replace(/Pria/g, 'Priya'), WRITEUP),
    expected: true,
  })

  assert({
    given: 'a rewrite cut to a fragment, or one that lost its sections',
    should: 'fail',
    actual: [plausibleRewrite('- Priya ran.', WRITEUP), plausibleRewrite(WRITEUP.replace('## ', '# '), WRITEUP)],
    expected: [false, false],
  })
})

test('transcript-rename.prompt.md', async () => {
  const content = await readPromptFile(new URL('../prompts/transcript-rename.prompt.md', import.meta.url).pathname)
  // An explicit me namespace stops the render from reading the real AboutMe profile.
  const { output, warnings } = renderPromptFile(content, 'transcript-rename.prompt.md', {
    me: {},
    user: { input: WRITEUP },
    renames: { text: '- "Pria" → "Priya"' },
  })

  assert({
    given: 'a write-up and its fixes',
    should: 'render both, with nothing left unfilled',
    actual: {
      warnings,
      writeup: output.includes(WRITEUP),
      fixes: output.includes('- "Pria" → "Priya"'),
      unfilled: output.includes('{{'),
    },
    expected: { warnings: [], writeup: true, fixes: true, unfilled: false },
  })
})
