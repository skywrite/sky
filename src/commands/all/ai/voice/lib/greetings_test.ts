import { renderTemplate } from '#shared/prompts/mod.ts'
import { assert, test } from '#test'
import { GREETINGS, greetingTemplate, pickGreeting } from './greetings.ts'

// An explicit me namespace stops renderTemplate from reading the real AboutMe profile.
const withName = { me: { firstName: 'Jane' } }
const noName = { me: {} }

test('greetingTemplate folds the name slot in and out', () => {
  assert({
    given: 'a comma-led name slot and a known first name',
    should: 'address the user by name',
    expected: 'Hello, Jane. Ready when you are.',
    actual: renderTemplate(greetingTemplate('Hello, {name}. Ready when you are.'), withName).output,
  })

  assert({
    given: 'a comma-led name slot and no profile',
    should: 'drop the slot together with its comma',
    expected: 'Hello. Ready when you are.',
    actual: renderTemplate(greetingTemplate('Hello, {name}. Ready when you are.'), noName).output,
  })

  assert({
    given: 'a space-led name slot and no profile',
    should: 'drop the slot together with its space',
    expected: 'Yes? Go ahead.',
    actual: renderTemplate(greetingTemplate('Yes {name}? Go ahead.'), noName).output,
  })

  assert({
    given: 'a line without a slot',
    should: 'pass through untouched',
    expected: 'Fire away.',
    actual: renderTemplate(greetingTemplate('Fire away.'), withName).output,
  })
})

test('every greeting is unique, spoken-safe, and renders cleanly', () => {
  assert({
    given: 'the greeting list',
    should: 'hold at least a hundred distinct lines',
    expected: true,
    actual: GREETINGS.length >= 100 && new Set(GREETINGS).size === GREETINGS.length,
  })

  const problems = GREETINGS.filter((line) => {
    const rendered = renderTemplate(greetingTemplate(line), noName).output
    return (
      line.includes('"') || // spoken inside a quoted instruction
      rendered.includes('{') || // a slot the template regex did not recognise
      rendered.includes(' .') ||
      rendered.includes(' ?') ||
      rendered.includes(',,') ||
      rendered !== rendered.trim() ||
      !/[.?!]$/.test(rendered)
    )
  })
  assert({
    given: 'each line rendered without a profile',
    should: 'leave no stray slot, quote, or dangling punctuation',
    expected: [],
    actual: problems,
  })
})

test('every greeting stands on its own as the first thing said', () => {
  // Phrases that answer, continue, or presume something the user has not said yet.
  const presumes =
    /\b(again|go on|go ahead then|over to you|the plan|the question|the story|the brief|the puzzle|say the word|point me|let's hear it|there you are|where to look)\b/i
  assert({
    given: 'the greeting list',
    should: 'contain no line that presumes an earlier exchange',
    expected: [],
    actual: GREETINGS.filter((line) => presumes.test(line)),
  })
})

test('pickGreeting draws from the whole list', () => {
  assert({
    given: 'random returning 0',
    should: 'pick the first line',
    expected: greetingTemplate(GREETINGS[0] as string),
    actual: pickGreeting(() => 0),
  })

  assert({
    given: 'random returning just under 1',
    should: 'pick the last line',
    expected: greetingTemplate(GREETINGS[GREETINGS.length - 1] as string),
    actual: pickGreeting(() => 0.999999),
  })

  assert({
    given: 'a hundred real draws',
    should: 'never fall outside the list',
    expected: true,
    actual: Array.from({ length: 100 }, () => pickGreeting()).every((g) =>
      GREETINGS.some((line) => greetingTemplate(line) === g),
    ),
  })
})
