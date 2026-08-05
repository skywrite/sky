/**
 * Regression test for renderMarkdown dropping a trailing newline
 *
 * BUG DISCOVERED: 2026-08-05
 *
 * ISSUE:
 * A blockquote whose content is a list continued by a lazy (unprefixed) line
 * lost its trailing newline when round-tripped:
 *
 *   in:  "> 2. How should we proceed?\nAtlas keeps the thought going here.\n"
 *   out: "> 2. How should we proceed?\nAtlas keeps the thought going here."
 *
 * ROOT CAUSE:
 * renderMarkdown rebuilds the source by substituting rendered child tokens for
 * `token.text` inside `token.raw`. For this construct marked gives the
 * blockquote a `text` ending in "\n", but its only child is a `list` token
 * whose `raw` has none — and a `list` carries no `.tokens`, so the recursion
 * emits that shorter `raw`. Swapping the longer string for the shorter one
 * dropped the newline.
 *
 * FIX:
 * When the rendered children match `text` apart from trailing whitespace, emit
 * `token.raw` unchanged — it is already the faithful source.
 */

import * as marked from 'marked'
import { assert, test } from '#test'
import renderMarkdown from '../renderMarkdown.ts'

const fixtures = [
  {
    description: 'blockquote wrapping an ordered list with a lazy continuation',
    markdown: '> 2. How should we proceed?\nAtlas keeps the thought going here.\n',
  },
  {
    description: 'blockquote wrapping an unordered list with a lazy continuation',
    markdown: '> - First option\nAtlas keeps the thought going here.\n',
  },
  {
    description: 'blockquote wrapping a list with no continuation',
    markdown: '> 1. First step\n> 2. Second step\n',
  },
  {
    description: 'blockquote wrapping a paragraph',
    markdown: '> Atlas reviewed the draft.\n',
  },
  {
    description: 'blockquote wrapping a paragraph with a lazy continuation',
    markdown: '> Atlas reviewed the draft.\nand sent it back.\n',
  },
  {
    description: 'list with a lazy continuation, unquoted',
    markdown: '2. How should we proceed?\nAtlas keeps the thought going here.\n',
  },
]

test('renderMarkdown - round-trips blockquoted lists without losing a newline', () => {
  for (const { description, markdown } of fixtures) {
    assert({
      given: description,
      should: 'round-trip to the original source',
      actual: renderMarkdown(marked.lexer(markdown, {})),
      expected: markdown,
    })
  }
})
