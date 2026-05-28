import { assert, test } from '#test'
import slugify from './slugify.ts'

test(slugify.name, () => {
  assert({
    given: 'a slash is present',
    should: 'strip slash',
    actual: slugify('acme/bob'),
    expected: 'acmebob',
  })

  assert({
    given: 'has capitals and spaces',
    should: 'strip capitals and replace spaces with hyphens',
    actual: slugify('Bob Smith'),
    expected: 'bob-smith',
  })

  assert({
    given: 'Slack channel name',
    should: 'strip #',
    actual: slugify('#development-mobile'),
    expected: 'development-mobile',
  })

  assert({
    given: 'An apostrophe',
    should: "strip '",
    actual: slugify("Bob O'Malley"),
    expected: 'bob-omalley',
  })

  assert({
    given: 'length',
    should: 'intelligently shorten to approximate length and not cut-off word',
    actual: slugify('Robinhood Web3 Wallet Overview', 20),
    expected: 'robinhood-web3-wallet',
  })

  assert({
    given: 'options object with length',
    should: 'intelligently shorten to approximate length and not cut-off word',
    actual: slugify('Robinhood Web3 Wallet Overview', { suggestedLength: 20 }),
    expected: 'robinhood-web3-wallet',
  })

  assert({
    given: 'empty string',
    should: 'return empty string',
    actual: slugify('', 20),
    expected: '',
  })

  assert({
    given: 'empty string',
    should: 'return empty string',
    actual: slugify(''),
    expected: '',
  })

  assert({
    given: 'undefined',
    should: 'return empty string',
    actual: slugify(<string>(<unknown>undefined)),
    expected: '',
  })

  assert({
    given: 'a string with accents/diatrics and puncuation',
    should: 'remove punctuation and accents/diatrics and then slugify',
    actual: slugify('Sebastián, Bob, and Veronica.'),
    expected: 'sebastian-bob-and-veronica',
  })

  assert({
    given: 'a regression',
    should: 'not fuck up',
    actual: slugify('Reviewed Sr. Financial Reporting Accountant Role Approval', 20),
    expected: 'reviewed-sr-financial',
  })

  assert({
    actual: slugify('Deliver Wyre + Project Titan', 20),
    expected: 'deliver-wyre-project',
  })

  assert({
    actual: slugify("Bob's Fish Shack", { preserveCase: true }),
    expected: 'Bobs-Fish-Shack',
  })

  assert({
    actual: slugify("Bob's Fish Shack", { preserveCase: false }),
    expected: 'bobs-fish-shack',
  })

  assert({
    given: 'Chinese characters in input',
    should: 'strip non-ASCII characters',
    actual: slugify('pr-2026-treasury-cf黑大战'),
    expected: 'pr-2026-treasury-cf',
  })

  assert({
    given: 'mixed ASCII and CJK characters',
    should: 'retain only ASCII',
    actual: slugify('Hello世界World', { preserveCase: true }),
    expected: 'HelloWorld',
  })

  assert({
    given: 'emoji in input',
    should: 'strip emoji',
    actual: slugify('Treasury 🚀 Update'),
    expected: 'treasury-update',
  })

  assert({
    given: 'Japanese characters',
    should: 'strip non-ASCII',
    actual: slugify('meeting-notes-会議メモ-final'),
    expected: 'meeting-notes-final',
  })

  assert({
    given: 'Cyrillic characters',
    should: 'strip non-ASCII',
    actual: slugify('report-отчёт-2026'),
    expected: 'report-2026',
  })

  assert({
    given: 'Arabic characters',
    should: 'strip non-ASCII',
    actual: slugify('notes-ملاحظات-draft'),
    expected: 'notes-draft',
  })

  assert({
    given: 'underscores',
    should: 'strip underscores (stripped by stripPunctuation)',
    actual: slugify('slack_JP-to-Bob_Summary', { preserveCase: true }),
    expected: 'slackJP-to-BobSummary',
  })

  assert({
    given: 'only non-ASCII characters',
    should: 'return empty string',
    actual: slugify('黑大战'),
    expected: '',
  })

  assert({
    given: 'Scandinavian characters',
    should: 'latinize then retain ASCII',
    actual: slugify('Søren Ølgaard'),
    expected: 'soren-olgaard',
  })

  assert({
    given: 'Polish characters',
    should: 'latinize then retain ASCII',
    actual: slugify('Łukasz Żółć'),
    expected: 'lukasz-zolc',
  })

  assert({
    given: 'suggestedWords with more words than limit',
    should: 'truncate at word boundary',
    actual: slugify('one two three four five six seven eight', { suggestedWords: 3 }),
    expected: 'one-two-three',
  })

  assert({
    given: 'suggestedWords with fewer words than limit',
    should: 'return all words (no truncation)',
    actual: slugify('one two three', { suggestedWords: 7 }),
    expected: 'one-two-three',
  })

  assert({
    given: 'suggestedWords with preserveCase (chat filename use case)',
    should: 'truncate by words and preserve case',
    actual: slugify('Jane Projects Marathon Training Timeline to 26 miles by Spring', {
      suggestedWords: 7,
      preserveCase: true,
    }),
    expected: 'Jane-Projects-Marathon-Training-Timeline-to-26',
  })

  assert({
    given: 'suggestedWords combined with suggestedLength',
    should: 'apply word slice first, then char slice',
    actual: slugify('one two three four five six', { suggestedWords: 5, suggestedLength: 11 }),
    expected: 'one-two-three',
  })

  assert({
    given: 'suggestedWords with hyphenated token',
    should: 'count hyphenated as single word (chat-local behavior)',
    actual: slugify('foo-bar baz qux', { suggestedWords: 2 }),
    expected: 'foo-bar-baz',
  })
})
