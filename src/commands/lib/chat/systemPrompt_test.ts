import { assert, test } from '#test'
import { notebookBlock } from './systemPrompt.ts'

test('notebookBlock - names the notebook folder from home and in full', () => {
  const block = notebookBlock({ DIR_BASE: '/Users/jane/Notes/Atlas', DIR_HOME: '/Users/jane' })

  assert({
    given: 'a notebook inside the home folder',
    should: 'name it both as a ~ path and in full',
    actual: block.includes('My notebook is the folder `~/Notes/Atlas` (`/Users/jane/Notes/Atlas`).'),
    expected: true,
  })

  assert({
    given: 'a notebook inside the home folder',
    should: 'tell the model to give file tools the full path of a notebook path the user names',
    actual: block.includes('give file tools the full path'),
    expected: true,
  })
})

test('notebookBlock - a notebook outside home is named in full only', () => {
  assert({
    given: 'a notebook outside the home folder',
    should: 'name only the full path',
    actual: notebookBlock({ DIR_BASE: '/Volumes/Atlas/Notes', DIR_HOME: '/Users/jane' }).includes(
      'My notebook is the folder `/Volumes/Atlas/Notes`.',
    ),
    expected: true,
  })

  assert({
    given: 'no notebook folder in the config',
    should: 'add nothing to the prompt',
    actual: notebookBlock({}),
    expected: '',
  })
})
