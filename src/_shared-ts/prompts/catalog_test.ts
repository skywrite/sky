import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import Handlebars from 'handlebars'
import { assert, test } from '#test'
import { PromptCatalog } from './catalog.ts'
import { inspectVariables } from './inspect.ts'
import { parsePromptFile } from './parse.ts'

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'sky-prompts-')))
  const sourceDir = path.join(root, 'source'),
    overrideDir = path.join(root, 'notebook', 'ai', 'prompts')
  const parent = 'commands/all/email/prompts/draft.prompt.md'
  const child = 'commands/all/email/prompts/email.prompt.md'
  await mkdir(path.join(sourceDir, 'commands/all/email/prompts'), { recursive: true })
  const original = '---\ndescription: Draft an email\n---\n\n# Instructions\n\n{{user.input}}\n\n{{> email}}\n'
  await writeFile(path.join(sourceDir, parent), original)
  await writeFile(
    path.join(sourceDir, child),
    '---\ndescription: Email structure\n---\n\nHi {{recipient.firstName}},\n\n{{#if thread.summary}}{{thread.summary}}{{else}}New conversation{{/if}}\n',
  )
  await writeFile(
    path.join(sourceDir, 'commands/all/email/new.ts'),
    "const prompt = new URL('./prompts/draft.prompt.md', import.meta.url)\n",
  )
  return {
    root,
    sourceDir,
    overrideDir,
    parent,
    child,
    original,
    catalog: new PromptCatalog({ sourceDir, overrideDir }),
  }
}

async function failure(work: () => Promise<unknown>): Promise<string> {
  try {
    await work()
    return 'succeeded'
  } catch (error) {
    return (error as Error).message
  }
}

test('prompt catalog: source usage, separate templates, overrides and next-run rendering', async () => {
  const f = await fixture()
  try {
    const list = await f.catalog.list()
    assert({
      given: 'a real source reference and a template reference',
      should: 'report both callers',
      actual: [
        list.find((entry) => entry.id === f.parent)?.uses[0]?.label,
        list.find((entry) => entry.id === f.child)?.uses[0]?.promptId,
      ],
      expected: ['sky email:new', f.parent],
    })
    const initial = await f.catalog.get(f.child)
    const saved = await f.catalog.save(f.child, initial.content.replace('Hi ', 'Hello '), initial.version)
    assert({
      given: 'a template customization',
      should: 'leave the source file intact and write the notebook override',
      actual: [
        (await readFile(path.join(f.sourceDir, f.child), 'utf8')).includes('Hi '),
        (await readFile(path.join(f.overrideDir, f.child), 'utf8')).includes('Hello '),
        saved.customized,
      ],
      expected: [true, true, true],
    })
    const values = { 'user.input': 'Ask for the Atlas brief.', 'recipient.firstName': 'Alex', 'thread.summary': '' }
    const preview = await f.catalog.preview(f.parent, f.original, values)
    const runtime = await new PromptCatalog(f.catalog.roots).expand(f.parent)
    const actual = Handlebars.compile(parsePromptFile(runtime, 'draft.prompt.md').body, { noEscape: true })({
      user: { input: values['user.input'] },
      recipient: { firstName: 'Alex' },
      thread: { summary: '' },
    })
    assert({
      given: 'a new runtime load and an unsent preview',
      should: 'use the same saved template and conditionals',
      actual: [preview.output, preview.output.includes('Hello Alex'), preview.output.includes('New conversation')],
      expected: [actual, true, true],
    })
    const restored = await f.catalog.restore(f.child, saved.version)
    assert({
      given: 'restore built-in',
      should: 'remove the override and return the original',
      actual: [restored.customized, restored.content],
      expected: [false, initial.content],
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('prompt catalog: conflicts serialize writers and failed validation preserves the saved version', async () => {
  const f = await fixture()
  try {
    const original = await f.catalog.get(f.parent)
    const results = await Promise.allSettled([
      f.catalog.save(f.parent, '# First', original.version),
      f.catalog.save(f.parent, '# Second', original.version),
    ])
    assert({
      given: 'two writes from the same version',
      should: 'save exactly one',
      actual: results.map((result) => result.status).sort(),
      expected: ['fulfilled', 'rejected'],
    })
    const current = await f.catalog.get(f.parent)
    const failures = await Promise.all([
      failure(() => f.catalog.save(f.parent, '{{#if user.input}}', current.version)),
      failure(() => f.catalog.save(f.parent, '{{> missing}}', current.version)),
      failure(() => f.catalog.save(f.parent, '{{> draft}}', current.version)),
      failure(() => f.catalog.save(f.parent, '---\nbad: [\n---\ntext', current.version)),
    ])
    assert({
      given: 'bad syntax, a missing template, a cycle, and invalid YAML',
      should: 'refuse each without changing the saved file',
      actual: [failures.every((error) => error !== 'succeeded'), (await f.catalog.get(f.parent)).version],
      expected: [true, current.version],
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('prompt catalog: traversal and symlinks cannot turn editing into arbitrary file access', async () => {
  const f = await fixture()
  try {
    const external = path.join(f.root, 'outside.prompt.md')
    await writeFile(external, 'Untouched')
    await symlink(external, path.join(f.sourceDir, 'linked.prompt.md'))
    await mkdir(f.overrideDir, { recursive: true })
    await symlink(path.join(f.root), path.join(f.overrideDir, 'custom'))
    const attempts = await Promise.all([
      failure(() => f.catalog.get('../outside.prompt.md')),
      failure(() => f.catalog.get(external)),
      failure(() => f.catalog.get('linked.prompt.md')),
      failure(() => f.catalog.create('outside')),
      failure(() => f.catalog.preview(f.parent, '{{> ../../../../../outside}}', {})),
    ])
    assert({
      given: 'paths outside the catalog and symlinked files/directories',
      should: 'refuse every operation',
      actual: [attempts.every((error) => error !== 'succeeded'), await readFile(external, 'utf8')],
      expected: [true, 'Untouched'],
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('prompt variables: booleans, empty context, JSON loops, metadata and plain text are simulated', async () => {
  const f = await fixture()
  try {
    const source =
      '---\ndescription: Sample metadata\n---\n{{prompt.description}}\n{{#if flag}}Yes{{else}}No{{/if}}\n{{#each items}}{{name}} {{../user.input}}{{/each}}\n{{{user.input}}}'
    const variables = inspectVariables(parsePromptFile(source, 'draft.prompt.md').body)
    assert({
      given: 'scoped loop members and root context',
      should: 'show the collection once and keep parent fields at the root',
      actual: variables.map((field) => field.name).sort(),
      expected: ['flag', 'items', 'prompt.description', 'user.input'],
    })
    const preview = await f.catalog.preview(f.parent, source, {
      flag: false,
      items: '[{"name":"Atlas"}]',
      'user.input': '<b>Plain & text</b>',
    })
    assert({
      given: 'sample JSON and a false conditional',
      should: 'render literal text and the false branch without reading a profile',
      actual: [
        preview.output.includes('Sample metadata'),
        preview.output.includes('No'),
        preview.output.includes('Atlas <b>Plain & text</b>'),
      ],
      expected: [true, true, true],
    })
    const custom = await f.catalog.create('email-template')
    assert({
      given: 'a new template',
      should: 'be a normal notebook prompt with no invented usage',
      actual: [custom.id, custom.custom, custom.uses],
      expected: ['custom/email-template.prompt.md', true, []],
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})
