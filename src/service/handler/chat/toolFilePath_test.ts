import { homedir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { toolFilePath } from './toolFilePath.ts'

test('file tool labels use the owning notebook day, including for directory listings and older layouts', () => {
  const root = '/mock/Atlas'
  const cases = [
    ['read_file', 'time/2025/W11/03-15/notes/Draft.md', 'Draft.md', '2025-03-15'],
    ['list_directory', 'time/2025/03-W11/03-15/notes', 'notes', '2025-03-15'],
    ['list_directory', 'time/2025/W11/03-15', '03-15', '2025-03-15'],
    ['read_file', 'time/2024/12/30-05/x02/notes/Draft.md', 'Draft.md', '2025-01-02'],
  ] as const
  for (const [tool, relative, label, date] of cases) {
    const absolute = path.join(root, relative)
    assert({
      given: `${tool} on ${relative}`,
      should: 'retain the full path and display the final name beside its calendar day',
      actual: toolFilePath(tool, { path: absolute }, undefined, root),
      expected: { absolute, label, date },
    })
  }
})

test('other paths retain the context needed to locate them', () => {
  const root = path.join(homedir(), 'Atlas')
  const cases = [
    ['Atlas/projects/Roadmap.md', path.join(root, 'projects/Roadmap.md'), 'projects/Roadmap.md'],
    ['~/Atlas/time/2025/W11', path.join(root, 'time/2025/W11'), 'time/2025/W11'],
    [root, root, '.'],
    [
      '/mock/external/time/2025/W11/03-15/file.md',
      '/mock/external/time/2025/W11/03-15/file.md',
      '/mock/external/time/2025/W11/03-15/file.md',
    ],
    [`${root}-archive`, `${root}-archive`, `${root}-archive`],
  ] as const
  for (const [given, absolute, label] of cases) {
    assert({
      given: `a file tool path with display label ${label}`,
      should: 'shorten only paths inside the configured notebook and use the web chat working directory',
      actual: toolFilePath('list_directory', { path: given }, undefined, root),
      expected: { absolute, label },
    })
  }
  const absolute = path.join(root, 'projects/Atlas.pdf')
  assert({
    given: 'a read resolved to another source and a different tool with a path argument',
    should: 'use the actual source for the file read and leave the unrelated tool alone',
    actual: ['read_file', 'write_file'].map((tool) =>
      toolFilePath(tool, { path: 'Atlas.pdf' }, { path: absolute }, root),
    ),
    expected: [{ absolute, label: 'projects/Atlas.pdf' }, undefined],
  })
})
