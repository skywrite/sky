import * as vscode from 'vscode'
import { assert as assertEqual } from '#shared/test/riteway.ts'

test('checkbox.toggleGutter', async () => {
  const fixtures = [
    {
      given: 'a bullet list item',
      input: '- TODO TASK HERE',
      expected: '- ~~TODO TASK HERE~~',
      should: 'add strikethrough',
    },
    {
      given: 'a numbered list item',
      input: '1. TODO TASK HERE',
      expected: '1. ~~TODO TASK HERE~~',
      should: 'add strikethrough',
    },
    {
      given: 'a bullet list item with strikethrough',
      input: '- ~~TODO TASK HERE~~',
      expected: '- TODO TASK HERE',
      should: 'remove strikethrough',
    },
    {
      given: 'a bullet list with time prefix',
      input: '- 14:30 > Meeting notes',
      expected: '- 14:30 > ~~Meeting notes~~',
      should: 'preserve time prefix and add strikethrough',
    },
    {
      given: 'an indented numbered list item',
      input: '  2. Indented task',
      expected: '  2. ~~Indented task~~',
      should: 'preserve indentation and add strikethrough',
    },
    {
      given: 'a regular paragraph',
      input: 'Regular paragraph text',
      expected: 'Regular paragraph text',
      should: 'not toggle strikethrough',
    },
    {
      given: 'a numbered list item 10+',
      input: '12. Task number twelve',
      expected: '12. ~~Task number twelve~~',
      should: 'add strikethrough',
    },
  ]

  for (const { given, input, expected, should } of fixtures) {
    const doc = await vscode.workspace.openTextDocument({
      content: input,
      language: 'markdown',
    })

    const editor = await vscode.window.showTextDocument(doc)
    editor.selection = new vscode.Selection(0, 0, 0, 0)

    await vscode.commands.executeCommand('checkbox.toggleGutter')

    assertEqual({
      given,
      should,
      actual: doc.lineAt(0).text,
      expected,
    })
  }
})
