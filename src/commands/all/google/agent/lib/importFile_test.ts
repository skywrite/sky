import * as os from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { resolveImportSource } from './importFile.ts'

test('resolveImportSource', () => {
  assert({
    given: 'a PDF path',
    should: 'plan a Doc conversion titled after the file name',
    expected: { filePath: '/deals/Atlas MSA.pdf', title: 'Atlas MSA', contentType: 'application/pdf' },
    actual: resolveImportSource('/deals/Atlas MSA.pdf'),
  })

  assert({
    given: 'a home-relative docx path with an uppercase extension',
    should: 'expand ~/ and match the extension case-insensitively',
    expected: {
      filePath: path.join(os.homedir(), 'deals/Atlas MSA.DOCX'),
      title: 'Atlas MSA',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    actual: resolveImportSource('~/deals/Atlas MSA.DOCX'),
  })

  assert({
    given: 'extensions Drive cannot convert to a Doc',
    should: 'return null',
    expected: [null, null],
    actual: [resolveImportSource('/deals/scan.png'), resolveImportSource('/deals/notes')],
  })
})
