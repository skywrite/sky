/**
 * Regression: large markdown documents in the AI context serve path.
 *
 * 2026-07-20: ai:chat context fetches took 30s+ because the service's
 * /context endpoint called Document.stripHtmlComments() per doc per
 * request. That method rebuilds the Document from the stripped markdown —
 * a full re-parse — and Document.fromMarkdown() parse is quadratic on
 * list-heavy docs (measured: 256KB ≈ 1s, 512KB ≈ 4s, 1MB ≈ 16s). Real
 * project folders hold docs of this size, so the per-request cost
 * multiplied into 30s+ responses. The fix serves
 * _stripHtmlComments(doc.toMarkdown()) instead — no re-parse.
 *
 * The ~1MB fixture is generated in-memory. Never store large fixtures
 * (or any real notebook content — see AGENTS.md) in the repo.
 */

import { assert, test } from '#test'
import { Document } from '#shared/models/Markdown/mod.ts'
import _stripHtmlComments from '../_stripHtmlComments.ts'

const ONE_MB = 1024 * 1024

/** Deterministic list-heavy markdown of at least `targetBytes`. */
function generateLargeMarkdown(targetBytes: number): string {
  const parts = ['---', 'name: Perf Fixture', 'tags: [Sample/Perf]', '---', '']
  let size = parts.join('\n').length
  let i = 0
  while (size < targetBytes) {
    i++
    const section = [
      `## Section ${i} Response Summary`,
      '',
      ...Array.from(
        { length: 50 },
        (_, j) =>
          `- **Persona ${i}-${j}**: response text with detail ${j} <!-- reviewer note ${j} --> and trailing analysis of the answer given here`,
      ),
      '',
      '```',
      `<!-- fenced comment ${i} stays -->`,
      '```',
      '',
      `<!-- block note ${i}`,
      'spanning line',
      '-->',
      '',
    ].join('\n')
    parts.push(section)
    size += section.length + 1
  }
  return parts.join('\n')
}

// One doc for all tests below, tokens warmed at module load (outside any
// per-test timeout): the lex itself is the known-quadratic cost (see
// skipped test at the bottom) — everything after it must stay fast.
const raw = generateLargeMarkdown(ONE_MB)
const doc = Document.fromMarkdown(raw)
doc.markdownTokens

test('large doc — per-request serve path is parse-free and fast', () => {
  // The /context pattern: serialize the already-parsed doc, strip the
  // string. ~34ms at 1MB when healthy; a reintroduced re-parse makes this
  // seconds. Bound has ~15x headroom to stay deterministic.
  const t0 = performance.now()
  const markdown = _stripHtmlComments(doc.toMarkdown())
  const elapsed = performance.now() - t0

  assert({
    given: 'a parsed ~1MB list-heavy doc',
    should: 'serialize + strip in under 500ms',
    actual: elapsed < 500,
    expected: true,
  })

  assert({
    given: 'the serve-path output',
    should: 'not be empty',
    actual: markdown.length > ONE_MB / 2,
    expected: true,
  })
})

test('large doc — string strip removes comments, preserves fenced content', () => {
  const stripped = _stripHtmlComments(raw)

  assert({
    given: 'inline comments across a ~1MB doc',
    should: 'remove all of them',
    actual: stripped.includes('reviewer note'),
    expected: false,
  })

  assert({
    given: 'multi-line block comments',
    should: 'remove them including inner lines',
    actual: stripped.includes('spanning line'),
    expected: false,
  })

  assert({
    given: 'comment-like text inside a code fence',
    should: 'preserve it verbatim',
    actual: stripped.includes('<!-- fenced comment 1 stays -->'),
    expected: true,
  })
})

test('large doc — Document construction is lazy and fast', () => {
  // Construction must never lex: tokens are computed on first access.
  // Before the lazy-lex fix, fromMarkdown paid marked's quadratic lexer
  // eagerly (~16s for this fixture).
  const t0 = performance.now()
  Document.fromMarkdown(raw)
  const elapsed = performance.now() - t0

  assert({
    given: 'a ~1MB list-heavy doc',
    should: 'construct in under 2 seconds without lexing',
    actual: elapsed < 2000,
    expected: true,
  })
})

test(
  'large doc — marked lexer is not quadratic',
  { skip: 'marked.lexer is quadratic under JSC (1MB ≈ 16s as of 2026-07-20; see markedjs/marked#2863)' },
  () => {
    // The root inefficiency, now deferred to first token access rather
    // than fixed: unskip when marked is patched or replaced (micromark).
    const fresh = Document.fromMarkdown(raw)
    const t0 = performance.now()
    fresh.markdownTokens
    const elapsed = performance.now() - t0

    assert({
      given: 'first token access on a ~1MB list-heavy doc',
      should: 'lex in under 2 seconds',
      actual: elapsed < 2000,
      expected: true,
    })
  },
)
