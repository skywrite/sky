/**
 * Regression test for renderMarkdown with special replacement patterns
 *
 * BUG DISCOVERED: 2025-10-26
 *
 * ISSUE:
 * The renderMarkdown function was using String.replace() with a string replacement value.
 * In JavaScript, when the replacement parameter is a string, certain sequences have
 * special meaning:
 *
 *   $$  - Inserts a single "$"
 *   $&  - Inserts the matched substring
 *   $`  - Inserts the portion of the string that precedes the matched substring
 *   $'  - Inserts the portion of the string that follows the matched substring
 *   $n  - Inserts the nth captured group (where n is a digit)
 *
 * This caused markdown content containing "$$" to be corrupted. For example:
 *   Input:  "3) Raise $$ (massive down round)"
 *   Output: "3) Raise $ (massive down round)"  // One $ was lost!
 *
 * ROOT CAUSE:
 * Line 25 in renderMarkdown.ts was:
 *   str += token.raw.replace(token.text, renderMarkdown(token.tokens))
 *
 * The second parameter (replacement) was a string, so JavaScript interpreted
 * special patterns like $$.
 *
 * FIX:
 * Changed to use a function for the replacement parameter:
 *   str += token.raw.replace(token.text, () => renderMarkdown(token.tokens!))
 *
 * When the replacement is a function, its return value is used literally without
 * any special pattern interpretation.
 *
 * AFFECTED FILE:
 * $SKY_DIR/time/2026/01/05-11/01-05/actions/messages/
 *   slack_Jane-Doe_Contract-terms-discussion.md
 *
 * This file contained "Raise $$" which triggered the bug and caused the
 * renderMarkdown test to fail.
 */

import * as marked from 'marked'
import { assert, test } from '#test'
import renderMarkdown from '../renderMarkdown.ts'

// Test fixtures for various special replacement patterns
const fixtures = [
  {
    description: 'double dollar signs ($$)',
    markdown: 'Raise $$ (massive down round)',
    reason: '$$ in String.replace() means "insert a single $"',
  },
  {
    description: 'multiple double dollar signs',
    markdown: 'Price: $$100, Cost: $$50, Profit: $$50',
    reason: 'Multiple occurrences of $$ should all be preserved',
  },
  {
    description: 'dollar-ampersand ($&)',
    markdown: 'Use $& to match the string',
    reason: '$& in String.replace() means "insert the matched substring"',
  },
  {
    description: 'dollar-backtick ($`)',
    markdown: 'The pattern $` gets the prefix',
    reason: '$` in String.replace() means "insert portion before match"',
  },
  {
    description: "dollar-apostrophe ($')",
    markdown: "The pattern $' gets the suffix",
    reason: '$\' in String.replace() means "insert portion after match"',
  },
  {
    description: 'dollar-digit ($1, $2, etc.)',
    markdown: 'Match groups like $1 and $2',
    reason: '$n in String.replace() means "insert nth captured group"',
  },
  {
    description: 'mixed special patterns',
    markdown: 'Complex: $$ and $& and $1 together',
    reason: 'Multiple special patterns should all be preserved',
  },
  {
    description: 'special patterns in lists',
    markdown: '1) Cost is $$\n2) Value is $&\n3) Reference $1',
    reason: 'Special patterns in list items should be preserved',
  },
  {
    description: 'special patterns in paragraph from actual bug',
    markdown:
      'All of this stock upside is better than the alternative: 1) Reset Balance Sheet with Expensive debt / warrants, 2) Sell to a private company, 3) Raise $$ (massive down round), or 4) sell to another public company (long shot at the valuation he wants) and who will buy this? There is always stupid money out there.',
    reason: 'This is the actual text that triggered the bug discovery',
  },
]

test('renderMarkdown - preserves special String.replace() patterns', () => {
  for (const { description, markdown, reason } of fixtures) {
    const tokens = marked.lexer(markdown, {})
    const rendered = renderMarkdown(tokens)

    assert({
      given: `markdown with ${description}`,
      should: `preserve literal text without special pattern interpretation (${reason})`,
      actual: rendered,
      expected: markdown,
    })
  }
})

test('renderMarkdown - $$ in nested tokens', () => {
  // Test with bold, italic, and other inline formatting
  const testCases = [
    '**Raise $$ now**',
    '*Cost is $$ each*',
    '~~Sold for $$~~',
    '`const price = $$`',
    '[Link with $$ text](https://example.com)',
  ]

  for (const markdown of testCases) {
    const tokens = marked.lexer(markdown, {})
    const rendered = renderMarkdown(tokens)

    assert({
      given: `markdown: ${markdown}`,
      should: 'preserve $$ in nested tokens',
      actual: rendered,
      expected: markdown,
    })
  }
})

test('renderMarkdown - all special patterns in combination', () => {
  const markdown = `
Here are all the special patterns:
- Double dollar: $$
- Match reference: $&
- Before match: $\`
- After match: $'
- Capture group: $1, $2, $3

**Bold with $$** and *italic with $&*
`.trim()

  const tokens = marked.lexer(markdown, {})
  const rendered = renderMarkdown(tokens)

  assert({
    given: 'markdown with all special replacement patterns',
    should: 'preserve all patterns exactly as written',
    actual: rendered,
    expected: markdown,
  })
})
