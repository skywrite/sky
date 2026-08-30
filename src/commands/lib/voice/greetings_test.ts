import { renderTemplate } from '#shared/prompts/mod.ts'
import { assert, test } from '#test'
import { greetingTemplate, PHRASES, pickGreeting } from './greetings.ts'

// An explicit me namespace stops renderTemplate from reading the real AboutMe profile.
const withName = { me: { firstName: 'Jane' } }
const noName = { me: {} }

test('greetingTemplate says hey, the name when there is one, then the phrase', () => {
  assert({
    given: 'a phrase and a known first name',
    should: 'address the user by name',
    expected: 'Hey Jane, ready when you are.',
    actual: renderTemplate(greetingTemplate('ready when you are.'), withName).output,
  })

  assert({
    given: 'a phrase and no profile',
    should: 'drop the name and keep the comma',
    expected: 'Hey, ready when you are.',
    actual: renderTemplate(greetingTemplate('ready when you are.'), noName).output,
  })
})

test('every phrase is unique, spoken-safe, and follows the comma cleanly', () => {
  assert({
    given: 'the phrase pool',
    should: 'hold at least a hundred distinct phrases',
    expected: true,
    actual: PHRASES.length >= 100 && new Set(PHRASES).size === PHRASES.length,
  })

  const problems = PHRASES.filter((phrase) => {
    const rendered = renderTemplate(greetingTemplate(phrase), noName).output
    return (
      phrase.includes('"') || // spoken inside a quoted instruction
      phrase.includes('{') || // a slot: the name is the template's, not the phrase's
      /^(hello|hi|hey)\b/i.test(phrase) || // the hello is the template's too
      !/^(?:[a-z]|I\b|I'|Sky\b)/.test(phrase) || // follows "Hey Jane, "
      rendered.includes(' .') ||
      rendered.includes(' ?') ||
      rendered.includes(',,') ||
      rendered !== rendered.trim() ||
      !/[.?!]$/.test(rendered)
    )
  })
  assert({
    given: 'each phrase rendered without a profile',
    should: 'leave no stray slot, quote, hello, or dangling punctuation',
    expected: [],
    actual: problems,
  })
})

test('every phrase stands on its own as the first thing said', () => {
  // Phrases that answer, continue, or presume something the user has not said yet.
  const presumes =
    /\b(again|go on|go ahead then|over to you|the plan|the question|the story|the brief|the puzzle|this time|say the word|point me|let's hear it|there you are|where to look)\b/i
  assert({
    given: 'the phrase pool',
    should: 'contain no phrase that presumes an earlier exchange',
    expected: [],
    actual: PHRASES.filter((phrase) => presumes.test(phrase)),
  })
})

test('pickGreeting draws from the whole pool', () => {
  assert({
    given: 'random returning 0',
    should: 'pick the first phrase',
    expected: greetingTemplate(PHRASES[0] as string),
    actual: pickGreeting(() => 0),
  })

  assert({
    given: 'random returning just under 1',
    should: 'pick the last phrase',
    expected: greetingTemplate(PHRASES[PHRASES.length - 1] as string),
    actual: pickGreeting(() => 0.999999),
  })

  assert({
    given: 'a hundred real draws',
    should: 'never fall outside the pool',
    expected: true,
    actual: Array.from({ length: 100 }, () => pickGreeting()).every((g) =>
      PHRASES.some((phrase) => greetingTemplate(phrase) === g),
    ),
  })
})
