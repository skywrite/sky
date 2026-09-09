import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { assert, test } from '#test'
import { WritingVoiceStore } from './store.ts'
import { failure, SAMPLE, voiceFixture } from './testHelpers.ts'

test('Writing voice seeds the shared rules from existing Outbox preferences and preserves hand edits', async () => {
  const f = await voiceFixture()
  try {
    await mkdir(path.join(f.root, 'outbox'))
    await writeFile(path.join(f.root, 'outbox', 'preferences.md'), '---\ncustom: keep\n---\nUse short paragraphs.\n')
    await f.store.initialize()
    const rules = await f.store.rules()
    await f.store.saveRules('Use readable paragraphs.\n', rules.revision)
    const doc = Document.fromMarkdown(await readFile(path.join(f.store.dir, 'rules.md'), 'utf8'))
    assert({
      given: 'existing preferences and a manual rule edit',
      should: 'keep one shared guide and preserve metadata',
      actual: [rules.text.trim(), doc.markdown.trim(), doc.yaml.custom],
      expected: ['Use short paragraphs.', 'Use readable paragraphs.', 'keep'],
    })
    assert({
      given: 'a stale settings tab',
      should: 'refuse to overwrite the newer rules',
      actual: (await failure(f.store.saveRules('Old text', rules.revision))).includes('changed'),
      expected: true,
    })
  } finally {
    await f.dispose()
  }
})

test('Writing examples preserve exact characters, survive reload, and deduplicate retries', async () => {
  const f = await voiceFixture()
  try {
    const input = {
      ...SAMPLE,
      original: '## Draft\n\n“Ready”—yes…\n---\n  keep spaces  ',
      revised: '## Revision\n\n"Ready" - yes.\n  keep spaces  ',
    }
    const first = (await f.store.capture(input))!
    const again = (await f.store.capture(input))!
    const reopened = new WritingVoiceStore(f.root, f.store.stateDir)
    const saved = (await reopened.get(first.id))!
    assert({
      given: 'headings, punctuation, whitespace, and a repeated capture',
      should: 'preserve the exact pair once in its own file',
      actual: [saved.original, saved.revised, again.id, (await f.store.list()).length],
      expected: [input.original, input.revised, first.id, 1],
    })
    assert({
      given: 'unchanged text',
      should: 'create no learning example',
      actual: await f.store.capture({ ...SAMPLE, revised: SAMPLE.original }),
      expected: null,
    })
  } finally {
    await f.dispose()
  }
})

test('Compaction preserves existing rules and all confirmed lessons before deleting processed examples', async () => {
  const f = await voiceFixture()
  try {
    const captured = (await f.voice.capture(SAMPLE))!
    const learned = await f.voice.answer(captured.id, captured.revision, { option: 0 })
    await f.voice.idle()
    const unanswered = (await f.store.capture({ ...SAMPLE, source: 'outbox:other' }))!
    const before = await f.store.rules()
    const result = await f.voice.compact()
    const rules = await f.store.rules()
    const resumed = new WritingVoiceStore(f.root, f.store.stateDir)
    assert({
      given: 'one learned example and one unanswered question',
      should: 'retain existing rules, add the lesson, and keep unanswered evidence',
      actual: [
        result.compacted,
        rules.text.startsWith(before.text.trimEnd()),
        rules.text.includes(learned.lesson!.text),
        (await resumed.list()).map((entry) => entry.id),
      ],
      expected: [1, true, true, [unanswered.id]],
    })
    assert({
      given: 'a retry after compaction',
      should: 'keep the example compacted without recreating its raw text',
      actual: [await resumed.capture(SAMPLE), (await readdir(path.join(f.store.dir, 'examples'))).length],
      expected: [null, 1],
    })
  } finally {
    await f.dispose()
  }
})

test('Compaction refuses invented coverage and concurrent rule changes without losing examples', async () => {
  const f = await voiceFixture()
  try {
    const example = (await f.voice.capture(SAMPLE))!
    const learned = await f.voice.answer(example.id, example.revision, { text: 'Use a direct opening in emails.' })
    await f.voice.idle()
    const rules = await f.store.rules()
    const invalid = await failure(
      f.store.compact(rules, [learned], {
        lessons: [],
        covered: [{ examples: [example.id], quote: 'An invented rule.' }],
      }),
    )
    await f.store.saveRules(`${rules.text}\nKeep my manual rule.\n`, rules.revision)
    const stale = await failure(
      f.store.compact(rules, [learned], { covered: [], lessons: [{ ...learned.lesson!, examples: [example.id] }] }),
    )
    assert({
      given: 'fabricated coverage and an editor racing compaction',
      should: 'refuse both plans and preserve the pair and manual rule',
      actual: [
        invalid.includes('cited'),
        stale.includes('changed'),
        Boolean(await f.store.get(example.id)),
        (await f.store.rules()).text.includes('Keep my manual rule.'),
      ],
      expected: [true, true, true, true],
    })
  } finally {
    await f.dispose()
  }
})

test('Compaction recovery finishes deletion only for durably recorded receipts', async () => {
  const f = await voiceFixture()
  try {
    const example = (await f.store.capture(SAMPLE))!
    const other = (await f.store.capture({ ...SAMPLE, source: 'chat:other' }))!
    const file = path.join(f.store.dir, 'rules.md')
    const doc = Document.fromMarkdown(await readFile(file, 'utf8'))
    await writeFile(
      file,
      new Document({ ...doc.yaml, compacted: [example.id] }, `${doc.markdown}\nPreserved lesson.\n`).toMarkdown(),
    )
    await f.store.finishCompaction()
    assert({
      given: 'a crash after saving rules and before pruning',
      should: 'finish the committed deletion while retaining unrelated examples',
      actual: [
        await f.store.get(example.id),
        Boolean(await f.store.get(other.id)),
        (await f.store.rules()).text.includes('Preserved lesson.'),
      ],
      expected: [null, true, true],
    })
  } finally {
    await f.dispose()
  }
})

test('Writing voice refuses traversals and symbolic links', async () => {
  const f = await voiceFixture()
  try {
    await mkdir(path.join(f.root, 'me'))
    await symlink(path.join(f.root, 'state'), path.join(f.root, 'me', 'voice'))
    assert({
      given: 'a traversal ID and a redirected voice directory',
      should: 'refuse access outside the canonical files',
      actual: [
        (await failure(f.store.get('../rules'))).includes('Invalid'),
        (await failure(f.store.rules())).includes('symbolic'),
      ],
      expected: [true, true],
    })
  } finally {
    await f.dispose()
  }
})
