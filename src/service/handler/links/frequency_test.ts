import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { assert, test } from '#test'
import { linkCatalog } from './catalog.ts'
import { createLinks } from './mod.ts'
import type { LinkSearch } from './types.ts'

test('link frequency counts distinct saved relationships, respects roots and refreshes with the store', async () => {
  const base = await mkdtemp('/tmp/sky-link-frequency-')
  const note = 'time/2026/W05/01-28/day.md'
  const person = 'people/Jane-Doe.md'
  try {
    const files = {
      [person]: '---\nname: [Jane Doe, JD]\nrel: [Jane Doe]\n---\n',
      'orgs/Example.md': '---\nname: Example Studio\n---\n',
      'orgs/JD.md': '---\nname: JD\n---\n',
      'projects/open/Atlas/_project/overview.md': '---\nname: Atlas\n---\n',
      'projects/open/Atlas/notes.md': '# Notes with implicit project membership\n',
      [note]: '---\nrel: [Jane Doe, JD, Example Studio, projects/Atlas, projects/Widget-V2]\n---\n',
      'time/2026/W05/01-27/day.md': '---\nrel: [2025-02-30/notes]\n---\n',
      'projects/open/Widget-V2/notes.md': '# A project without an overview\n',
      'ai/notes.md': '---\nrel: [Jane Doe]\n---\n',
    }
    for (const [file, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(base, file)), { recursive: true })
      await writeFile(path.join(base, file), content)
    }
    const dirs = ['people', 'orgs', 'projects', 'time'].map((dir) => path.join(base, dir))
    const store = await MarkdownStore.build({
      peopleDirs: [dirs[0]!],
      orgDirs: [dirs[1]!],
      projectsDir: dirs[2],
      timeDirs: [dirs[3]!],
      aiDir: path.join(base, 'ai'),
    })
    const counts = async (roots = dirs) =>
      (await linkCatalog(store, base, roots))
        .filter((item) => ['person', 'org', 'project'].includes(item.kind))
        .map((item) => [item.value, item.linkCount ?? 0])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    assert({
      given:
        'duplicate aliases, a colliding org name, a self-link, implicit project membership, and an excluded source',
      should: 'count each actual destination once and include projects with no overview',
      actual: await counts(),
      expected: [
        ['Example Studio', 1],
        ['Jane Doe', 1],
        ['JD', 0],
        ['projects/Atlas', 1],
        ['projects/Widget-V2', 1],
      ],
    })
    assert({
      given: 'the same store with the AI directory included',
      should: 'recompute frequency for the new source roots',
      actual: (await counts([...dirs, path.join(base, 'ai')])).find(([name]) => name === 'Jane Doe'),
      expected: ['Jane Doe', 2],
    })
    const { routes, host } = createLinks(store, base, dirs)
    const search = async (query: string) => (await (await routes.request(`/?${query}`)).json()) as LinkSearch
    const union = await search('kind=person&kind=project')
    assert({
      given: 'the HTTP picker receives two checked types',
      should: 'return both types and agree with comma-separated clients',
      actual: [
        union.items.map((item) => item.kind).sort(),
        (await search('kind=person,project')).items.map((item) => item.path),
      ],
      expected: [['person', 'project', 'project'], union.items.map((item) => item.path)],
    })
    await host.update(note, [], ['JD', 'Jane Doe'])
    assert({
      given: 'the saved relation is removed through the picker',
      should: 'invalidate the cached frequency without a restart',
      actual: (await counts()).find(([name]) => name === 'Jane Doe'),
      expected: ['Jane Doe', 0],
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
