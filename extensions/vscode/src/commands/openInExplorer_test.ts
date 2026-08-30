import { assert as assertEqual } from '#shared/test/riteway.ts'
import { explorerUrl } from './openInExplorer.ts'

/**
 * explorerUrl turns the file in the editor into its explorer page: the
 * file's notebook-relative path under /explorer on the local service, one
 * segment per directory, encoded the way a browser expects. Nothing outside
 * the notebook has a page — including a sibling directory that merely shares
 * the notebook's name as a prefix.
 */
test('explorerUrl', () => {
  const notebook = '/home/jane/Notebook'
  const fixtures = [
    {
      given: 'a file one directory down',
      file: '/home/jane/Notebook/places/misc.md',
      expected: 'http://localhost:9999/explorer/places/misc.md',
      should: 'be that path under /explorer',
    },
    {
      given: 'a file several directories down',
      file: '/home/jane/Notebook/time/2026/08/24-30/08-28.md',
      expected: 'http://localhost:9999/explorer/time/2026/08/24-30/08-28.md',
      should: 'keep every directory as a segment',
    },
    {
      given: 'a name with a space',
      file: '/home/jane/Notebook/people/Jane Doe.md',
      expected: 'http://localhost:9999/explorer/people/Jane%20Doe.md',
      should: 'encode it',
    },
    {
      given: 'a file outside the notebook',
      file: '/home/jane/Desktop/misc.md',
      expected: undefined,
      should: 'have no page',
    },
    {
      given: 'a sibling directory sharing the notebook prefix',
      file: '/home/jane/Notebook2/misc.md',
      expected: undefined,
      should: 'have no page',
    },
    {
      given: 'the notebook directory itself',
      file: '/home/jane/Notebook',
      expected: undefined,
      should: 'have no page',
    },
  ]

  for (const { given, file, expected, should } of fixtures) {
    assertEqual({ given, should, actual: explorerUrl(file, notebook, 9999)?.toString(), expected })
  }
})
