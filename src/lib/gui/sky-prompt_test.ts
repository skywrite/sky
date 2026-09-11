import { assert, test } from '#test'
import { parsePromptOutput, promptArgs, SkyPromptStatus } from './sky-prompt.ts'

test('promptArgs', () => {
  assert({
    given: 'a question, a default, a selection and three action buttons',
    should: 'emit one flag per option, with the buttons numbered left to right',
    expected: [
      '-q',
      'Rename Screenshot.png?',
      '-d',
      '2026-01-15_Screenshot.png',
      '-s',
      '11:10',
      '-a1',
      'Move to Today',
      '-a2',
      'Move to Date',
      '-a3',
      'Trash',
    ],
    actual: promptArgs({
      question: 'Rename Screenshot.png?',
      defaultAnswer: '2026-01-15_Screenshot.png',
      selectRange: { start: 11, length: 10 },
      action1: 'Move to Today',
      action2: 'Move to Date',
      action3: 'Trash',
    }),
  })

  assert({
    given: 'only a third action button',
    should: 'keep its number, so it still lands right of the others',
    expected: ['-a3', 'Trash'],
    actual: promptArgs({ action3: 'Trash' }),
  })

  assert({
    given: 'no options',
    should: 'emit no flags',
    expected: [],
    actual: promptArgs({}),
  })
})

test('parsePromptOutput', () => {
  assert({
    given: 'the OK line',
    should: 'report Ok with the typed text',
    expected: { status: SkyPromptStatus.Ok, answer: '2026-01-15_Screenshot.png' },
    actual: parsePromptOutput(0, 'OK: 2026-01-15_Screenshot.png\n'),
  })

  assert({
    given: 'the third action button',
    should: 'report Action3',
    expected: { status: SkyPromptStatus.Action3, answer: '2026-01-15_Screenshot.png' },
    actual: parsePromptOutput(0, 'ACTION3: 2026-01-15_Screenshot.png\n'),
  })

  assert({
    given: 'the Cancel line with text left in the field',
    should: 'report Cancel and still carry the text',
    expected: { status: SkyPromptStatus.Cancel, answer: 'draft.png' },
    actual: parsePromptOutput(0, 'CANCEL: draft.png\n'),
  })

  assert({
    given: 'a typed answer that itself contains ": "',
    should: 'split on the first separator only',
    expected: { status: SkyPromptStatus.Ok, answer: 'Note: draft.md' },
    actual: parsePromptOutput(0, 'OK: Note: draft.md\n'),
  })

  assert({
    given: 'an empty field',
    should: 'report an empty answer',
    expected: { status: SkyPromptStatus.Ok, answer: '' },
    actual: parsePromptOutput(0, 'OK: \n'),
  })

  assert({
    given: 'a status word the dialog never prints',
    should: 'report Error',
    expected: { status: SkyPromptStatus.Error, answer: 'x' },
    actual: parsePromptOutput(0, 'HUH: x\n'),
  })

  assert({
    given: 'a non-zero exit',
    should: 'report Error with no answer, whatever was printed',
    expected: { status: SkyPromptStatus.Error, answer: '' },
    actual: parsePromptOutput(1, 'OK: ignored\n'),
  })
})
