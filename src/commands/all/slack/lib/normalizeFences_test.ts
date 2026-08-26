import { assert, test } from '#test'
import normalizeFences from './normalizeFences.ts'

test('normalizeFences: one-line block glued on both ends', () => {
  assert({
    given: 'a block opened and closed on one line',
    should: 'expand to fence, content, fence',
    actual: normalizeFences('```Deploy Steps```'),
    expected: '```\nDeploy Steps\n```',
  })
})

test('normalizeFences: opening fence glued to first content line', () => {
  assert({
    given: 'a fence glued to the first line of a block',
    should: 'move the fence to its own line, preserving content verbatim',
    actual: normalizeFences('```const a = 1\nconst b = 2\n```'),
    expected: '```\nconst a = 1\nconst b = 2\n```',
  })
})

test('normalizeFences: closing fence glued to last content line', () => {
  assert({
    given: 'a fence glued to the last line of a block',
    should: 'move the fence to its own line',
    actual: normalizeFences('```\ntotal | 42```'),
    expected: '```\ntotal | 42\n```',
  })
})

test('normalizeFences: leading whitespace of glued content survives', () => {
  assert({
    given: 'glued content that begins with a space',
    should: 'keep the space when the content moves to its own line',
    actual: normalizeFences('``` # comment line'),
    expected: '```\n # comment line',
  })
})

test('normalizeFences: trailing whitespace after a glued closer is dropped', () => {
  assert({
    given: 'a glued closing fence followed by trailing spaces',
    should: 'emit a bare fence line',
    actual: normalizeFences('done```  '),
    expected: 'done\n```',
  })
})

test('normalizeFences: token after fence is content, not a language tag', () => {
  assert({
    given: 'a fence glued to a single word (Slack mrkdwn has no language tags)',
    should: 'split the word onto its own line',
    actual: normalizeFences('```json\n{ "a": 1 }\n```'),
    expected: '```\njson\n{ "a": 1 }\n```',
  })
})

test('normalizeFences: already-clean block passes through unchanged', () => {
  const clean = 'before\n```\ncode here\n```\nafter'
  assert({
    given: 'a properly fenced block',
    should: 'return the text unchanged',
    actual: normalizeFences(clean),
    expected: clean,
  })
})

test('normalizeFences: idempotent on its own output', () => {
  const once = normalizeFences('```Deploy Steps```\nprose\nend```')
  assert({
    given: 'text already normalized once',
    should: 'not change on a second pass',
    actual: normalizeFences(once),
    expected: once,
  })
})

test('normalizeFences: blockquoted block keeps its quote prefix', () => {
  assert({
    given: 'a glued block inside a blockquote',
    should: 'emit prefixed fences and content so the block stays quoted',
    actual: normalizeFences('> ```Hello team\n>\n> Regards, Jane```'),
    expected: '> ```\n> Hello team\n>\n> Regards, Jane\n> ```',
  })
})

test('normalizeFences: blockquoted one-line block expands with prefixes', () => {
  assert({
    given: 'a one-line block inside a blockquote',
    should: 'expand to three prefixed lines',
    actual: normalizeFences('> ```pinned note```'),
    expected: '> ```\n> pinned note\n> ```',
  })
})

test('normalizeFences: mid-line fences are left untouched', () => {
  const midline = 'use the ```atlas``` style here'
  assert({
    given: 'fences that neither start nor end the line',
    should: 'leave the line unchanged',
    actual: normalizeFences(midline),
    expected: midline,
  })
})

test('normalizeFences: interior fence beyond the boundaries bails out', () => {
  const tangled = '```a``` and ```b```'
  assert({
    given: 'a line with fence material between the boundary fences',
    should: 'leave the line unchanged rather than risk unbalancing the document',
    actual: normalizeFences(tangled),
    expected: tangled,
  })
})

test('normalizeFences: plain text passes through', () => {
  const plain = 'no fences here\njust prose'
  assert({
    given: 'text without any triple backticks',
    should: 'return it unchanged',
    actual: normalizeFences(plain),
    expected: plain,
  })
})
