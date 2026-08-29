import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { createExplorerRoutes, type ExplorerDoc, type ExplorerListing } from './mod.ts'

const ROADMAP_MD = `---
title: Roadmap
tags: atlas; planning
---

# Roadmap

<!-- a note to self that readers never see -->

Ship the pricing page, then the **flat-floor** math.

| Rung | When |
| --- | --- |
| Pricing | Friday |
`

/** A notebook with two roots present, one configured root missing, and a directory outside the roots. */
async function notebook(): Promise<{ base: string; app: ReturnType<typeof createExplorerRoutes> }> {
  const base = await makeTempDir({ prefix: 'sky-explorer-' })
  await mkdir(path.join(base, 'projects', 'Atlas', 'archive'), { recursive: true })
  await mkdir(path.join(base, 'library'), { recursive: true })
  await mkdir(path.join(base, 'journal'), { recursive: true })
  await writeFile(path.join(base, 'projects', 'Atlas', 'Roadmap.md'), ROADMAP_MD)
  await writeFile(path.join(base, 'projects', 'Atlas', 'notes.txt'), 'not markdown')
  await writeFile(path.join(base, 'projects', '.hidden.md'), '# hidden')
  await writeFile(path.join(base, 'projects', 'Zed.md'), '# Zed')
  await writeFile(path.join(base, 'projects', '10-ten.md'), '# Ten')
  await writeFile(path.join(base, 'projects', '2-two.md'), '# Two')
  await writeFile(path.join(base, 'library', 'Reading.md'), '# Reading')
  await writeFile(path.join(base, 'journal', 'about-me.md'), '# Me')
  const markdownDirs = ['projects', 'library', 'people'].map((name) => path.join(base, name))
  return { base, app: createExplorerRoutes({ markdownBaseDir: base, markdownDirs }) }
}

async function json<T>(app: ReturnType<typeof createExplorerRoutes>, url: string): Promise<T> {
  return (await app.request(url)).json() as Promise<T>
}

test({ name: 'explorer - the roots are the configured directories that exist, in order' }, async () => {
  const { app } = await notebook()
  const roots = await json<ExplorerListing>(app, '/dir')

  assert({
    given: 'three configured roots, one of which does not exist',
    should: 'list the two that do, alphabetically, as directories',
    actual: roots,
    expected: {
      path: '',
      entries: [
        { name: 'library', path: 'library', kind: 'dir' },
        { name: 'projects', path: 'projects', kind: 'dir' },
      ],
    },
  })
})

test(
  { name: 'explorer - a directory lists one level: directories first, then markdown, in natural order' },
  async () => {
    const { app } = await notebook()
    const projects = await json<ExplorerListing>(app, '/dir?path=projects')
    const atlas = await json<ExplorerListing>(app, '/dir?path=projects%2FAtlas')

    assert({
      given: 'a root holding a directory, a dotfile, and files whose names carry numbers',
      should: 'put the directory first, order the files by number not by digit, and skip the dotfile',
      actual: projects,
      expected: {
        path: 'projects',
        entries: [
          { name: 'Atlas', path: 'projects/Atlas', kind: 'dir' },
          { name: '2-two.md', path: 'projects/2-two.md', kind: 'file' },
          { name: '10-ten.md', path: 'projects/10-ten.md', kind: 'file' },
          { name: 'Zed.md', path: 'projects/Zed.md', kind: 'file' },
        ],
      },
    })

    assert({
      given: 'a directory holding a subdirectory, a markdown file, and a text file',
      should: 'list the subdirectory and the markdown file only',
      actual: atlas.entries,
      expected: [
        { name: 'archive', path: 'projects/Atlas/archive', kind: 'dir' },
        { name: 'Roadmap.md', path: 'projects/Atlas/Roadmap.md', kind: 'file' },
      ],
    })
  },
)

test({ name: 'explorer - paths outside the roots, or that are not directories, are refused' }, async () => {
  const { app } = await notebook()
  const statuses = await Promise.all(
    [
      '/dir?path=..',
      '/dir?path=journal',
      '/dir?path=projects%2FNope',
      '/dir?path=projects%2FAtlas%2FRoadmap.md',
      '/dir?path=%2Fetc',
    ].map(async (url) => (await app.request(url)).status),
  )

  assert({
    given:
      'the parent of the notebook, a notebook directory that is not a root, a missing directory, a file, and an absolute path',
    should: 'refuse each with the status that says why',
    actual: statuses,
    expected: [403, 403, 404, 404, 400],
  })
})

test({ name: 'explorer - a file comes back rendered, frontmatter aside, comments left out' }, async () => {
  const { app } = await notebook()
  const doc = await json<ExplorerDoc>(app, '/doc?path=projects%2FAtlas%2FRoadmap.md')
  const missing = (await app.request('/doc?path=projects%2FAtlas%2FNope.md')).status
  const outside = (await app.request('/doc?path=journal%2Fabout-me.md')).status

  assert({
    given: 'a markdown file with frontmatter, an HTML comment, emphasis, and a table',
    should: 'keep the frontmatter as written, render the body, and drop the comment',
    actual: {
      path: doc.path,
      frontmatter: doc.frontmatter,
      hasHeading: doc.html.includes('<h1>Roadmap</h1>'),
      hasBold: doc.html.includes('<strong>flat-floor</strong>'),
      hasTable: doc.html.includes('<table>'),
      hasComment: doc.html.includes('note to self'),
    },
    expected: {
      path: 'projects/Atlas/Roadmap.md',
      frontmatter: 'title: Roadmap\ntags: atlas; planning',
      hasHeading: true,
      hasBold: true,
      hasTable: true,
      hasComment: false,
    },
  })

  assert({
    given: 'a file that does not exist, and one outside the roots',
    should: 'answer not found and forbidden',
    actual: [missing, outside],
    expected: [404, 403],
  })
})
