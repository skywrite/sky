import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { filedPaths } from './createImportHost.ts'

test('the import host returns every recorded journal, including absolute paths on a different filing day', () => {
  const config = { DIR_BASE: '/tmp/mock-notebook', DIR_TIME: '/tmp/mock-notebook/time' }
  const paths = [
    '/tmp/mock-notebook/time/2031/W11/03-16/journal/Rest.md',
    '/tmp/mock-notebook/time/2031/W11/03-16/journal/Atlas.md',
  ]
  assert({
    given: 'multiple files returned by a journal command',
    should: 'preserve the complete ordered result with notebook-relative paths',
    actual: filedPaths({ files: paths }, new PlainDateTime('2031-03-17 08:00'), config),
    expected: paths.map((file) => file.replace('/tmp/mock-notebook/', '')),
  })
})
