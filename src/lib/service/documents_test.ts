import { assert, test } from '#test'
import { toNotebookRelative } from './documents.ts'

test('toNotebookRelative - absolute service paths become the document API form', () => {
  assert({
    given: 'an absolute path under the notebook base, a relative path, and a foreign absolute path',
    should: 'strip the base, pass the relative through, and leave the foreign path alone',
    actual: [
      toNotebookRelative('/nb/people/2026/ta/Taylor-Quinn.md', '/nb'),
      toNotebookRelative('people/2026/ta/Taylor-Quinn.md', '/nb'),
      toNotebookRelative('/elsewhere/doc.md', '/nb'),
    ],
    expected: ['people/2026/ta/Taylor-Quinn.md', 'people/2026/ta/Taylor-Quinn.md', '/elsewhere/doc.md'],
  })
})
