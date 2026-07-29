import * as vscode from 'vscode'
import { assert as assertEqual } from '#shared/test/riteway.ts'
import { isCursorInRelevantYamlKey } from './mod.ts'

/**
 * isCursorInRelevantYamlKey is the guard in front of every frontmatter entity
 * completion (people, orgs, tags, attachments). It answers "is the cursor
 * inside one of these YAML keys" by checking the current line and then
 * scanning upwards until it hits some other key.
 *
 * The scan is the subtle part: it keeps the completions alive on the `- name`
 * continuation lines of a multi-line value, and it must stop at the next key
 * so `tags:` items don't offer people. These fixtures pin both, plus the
 * asymmetry in the current-line check — the text *before the cursor* decides
 * the fast path, but the *whole line* is what the scan sees.
 */
test('isCursorInRelevantYamlKey', async () => {
  const fixtures = [
    {
      given: 'the cursor at the end of the key line',
      lines: ['---', 'who: Jane Doe', '---'],
      line: 1,
      keys: ['who'],
      expected: true,
      should: 'be in the key',
    },
    {
      given: 'the cursor mid-word on the key line',
      lines: ['---', 'who: Jane Doe', '---'],
      line: 1,
      character: 2,
      keys: ['who'],
      expected: true,
      should: 'still be in the key — the upward scan sees the whole line',
    },
    {
      given: 'the cursor on an array item under the key',
      lines: ['---', 'who:', '  - Jane Doe', '  - John Roe', '---'],
      line: 3,
      keys: ['who'],
      expected: true,
      should: 'stay in the key across continuation lines',
    },
    {
      given: 'a blank line between the key and the cursor',
      lines: ['---', 'who:', '', '  - Jane Doe', '---'],
      line: 3,
      keys: ['who'],
      expected: true,
      should: 'treat blank lines as transparent',
    },
    {
      given: 'the cursor on a different key line',
      lines: ['---', 'who: Jane Doe', 'tags: atlas', '---'],
      line: 2,
      keys: ['who'],
      expected: false,
      should: 'not be in the key',
    },
    {
      given: 'the cursor on an array item under a different key',
      lines: ['---', 'who:', '  - Jane Doe', 'tags:', '  - atlas', '---'],
      line: 4,
      keys: ['who'],
      expected: false,
      should: 'stop the scan at the intervening key',
    },
    {
      given: 'several relevant keys and a line matching one of them',
      lines: ['---', 'rel: projects/atlas', '---'],
      line: 1,
      keys: ['who', 'rel', 'ib'],
      expected: true,
      should: 'match any of the keys',
    },
    {
      given: 'an indented key line',
      lines: ['---', '  who: Jane Doe', '---'],
      line: 1,
      keys: ['who'],
      expected: true,
      should: 'ignore leading whitespace',
    },
    {
      given: 'a longer key that merely starts with the relevant one',
      lines: ['---', 'related: Atlas', '---'],
      line: 1,
      keys: ['rel'],
      expected: false,
      should: 'require the colon, not just the prefix',
    },
    {
      given: 'the cursor on the opening delimiter, above every key',
      lines: ['---', 'who: Jane Doe', '---'],
      line: 0,
      keys: ['who'],
      expected: false,
      should: 'not scan into keys below the cursor',
    },
  ]

  for (const { given, lines, line, character, keys, expected, should } of fixtures) {
    const document = await vscode.workspace.openTextDocument({
      content: lines.join('\n'),
      language: 'markdown',
    })

    const column = character ?? document.lineAt(line).text.length
    const position = new vscode.Position(line, column)

    assertEqual({
      given,
      should,
      actual: isCursorInRelevantYamlKey(document, position, keys),
      expected,
    })
  }
})
